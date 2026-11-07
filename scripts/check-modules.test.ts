import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE_FILE, RULES, checkModuleFiles, compareBaseline, main, maskComments, toBaseline } from "./check-modules.mjs";

const vue = (template: string, style = "", script = "") =>
  `<script setup lang="ts">\n${script}\n</script>\n\n<template>\n${template}\n</template>\n\n<style scoped>\n${style}\n</style>\n`;

/** The rules hit in one file. */
function rules(file: string, text: string): string[] {
  return checkModuleFiles({ [`m/src/${file}`]: text }).map((f: { rule: string }) => f.rule);
}

// One hit and one miss per line rule; the miss is the right way to write the same thing.
const LINE_RULES: Array<{ rule: string; file: string; hit: string; miss: string }> = [
  { rule: "color-literal", file: "a.css", hit: ".a { color: #1a2b3c; }", miss: ".a { color: var(--foreground); }" },
  { rule: "color-literal", file: "a.ts", hit: 'const c = "rgb(0 0 0 / 0.5)";', miss: 'const id = "#app";' },
  { rule: "color-fallback", file: "a.css", hit: ".a { color: var(--warning, #f5c518); }", miss: ".a { color: var(--warning); }" },
  { rule: "named-color", file: "a.css", hit: ".a { background: white; }", miss: ".a { background: transparent; }" },
  { rule: "palette-color", file: "A.vue", hit: vue('<div class="bg-neutral-800 text-white" />'), miss: vue('<div class="bg-card text-foreground" />') },
  { rule: "font-family", file: "a.css", hit: '.a { font-family: "Inter Variable", sans-serif; }', miss: ".a { font-family: var(--font-sans); }" },
  { rule: "font-family", file: "a.ts", hit: 'ctx.font = "13px \'Inter\'";', miss: 'ctx.font = "13px sans";' },
  { rule: "text-size", file: "A.vue", hit: vue('<p class="text-[11px]" />'), miss: vue('<p class="text-xs" />') },
  { rule: "text-size", file: "a.css", hit: ".a { font-size: 0.6875rem; }", miss: ".a { font-size: 12px; }" },
  { rule: "text-scale", file: "a.css", hit: ".a { font-size: 15px; }", miss: ".a { font-size: 16px; }" },
  { rule: "font-weight", file: "A.vue", hit: vue('<b class="font-bold" />'), miss: vue('<b class="font-semibold" />') },
  { rule: "font-weight", file: "a.css", hit: ".a { font-weight: 700; }", miss: "@font-face { font-family: 'X'; font-weight: 300; }" },
  { rule: "radius-px", file: "a.css", hit: ".a { border-radius: 6px; }", miss: ".a { border-radius: var(--radius-md); }" },
  { rule: "radius-px", file: "A.vue", hit: vue('<div class="rounded-[6px]" />'), miss: vue('<div class="rounded-md" />') },
  { rule: "z-index", file: "A.vue", hit: vue('<div class="z-10" />'), miss: vue('<div class="size-10" />') },
  { rule: "motion-token", file: "a.css", hit: ".a { transition: opacity 150ms ease-out; }", miss: ".a { transition: opacity var(--duration-menu) var(--ease-out-strong); }" },
  { rule: "motion-token", file: "A.vue", hit: vue('<div class="transition-all" />'), miss: vue('<div class="transition-opacity" />') },
  { rule: "spacing", file: "A.vue", hit: vue('<div class="gap-1.5 p-5" />'), miss: vue('<div class="gap-2 p-4" />') },
  { rule: "spacing", file: "a.css", hit: ".a { padding: 6px 8px; }", miss: ".a { padding: 4px 8px; }" },
  { rule: "shadow", file: "A.vue", hit: vue('<div class="shadow-lg" />'), miss: vue('<div class="border border-border" />') },
  { rule: "focus-ring", file: "a.css", hit: ".a { outline: none; }", miss: ".a { outline-offset: 2px; }" },
  { rule: "raw-control", file: "A.vue", hit: vue("<button>Go</button>"), miss: vue("<Button>Go</Button>") },
  { rule: "raw-control", file: "B.vue", hit: vue('<input\n  type="checkbox"\n/>'), miss: vue('<input type="text" />') },
  { rule: "raw-control", file: "C.vue", hit: vue("<details><summary>More</summary></details>"), miss: vue("<Collapsible />") },
  { rule: "dom-query", file: "A.vue", hit: vue("<div />", "", 'document.querySelector(".row")?.focus();'), miss: vue("<div />", "", "row.value?.focus();") },
  { rule: "window-keys", file: "a.ts", hit: 'import { ref } from "vue";\nwindow.addEventListener("keydown", onKey);', miss: 'el.addEventListener("keydown", onKey);' },
  { rule: "menu-anchor", file: "a.ts", hit: "sdk.ui.showMenu({ x: event.clientX, y: event.clientY, items });", miss: "sdk.ui.showMenu({ anchor: event.currentTarget, items });" },
  { rule: "file-save", file: "a.ts", hit: "link.download = name;\nlink.click();", miss: "await sdk.files.saveJson({ name, data });" },
  { rule: "glued-text", file: "A.vue", hit: vue("<p>{{ count }} · {{ size }}</p>"), miss: vue('<p>{{ t("summary", { count, size }) }}</p>') },
];

describe("check-modules line rules", () => {
  for (const { rule, file, hit, miss } of LINE_RULES) {
    it(`${rule}: hit and miss (${file})`, () => {
      expect(rules(file, hit)).toContain(rule);
      expect(rules(file, miss)).not.toContain(rule);
    });
  }

  it("has a hit test for every rule", () => {
    const tested = new Set([...LINE_RULES.map((r) => r.rule), "catalog-check", "suspend-flush", "view-memory-flush", "panel-state-read", "allow-comment"]);
    expect(Object.keys(RULES).filter((rule) => !tested.has(rule))).toEqual([]);
  });

  it("ignores comments but not strings that look like them", () => {
    expect(rules("a.css", "/* was #ffffff */ .a { color: var(--card); }")).toEqual([]);
    expect(rules("a.ts", "// #ffffff\nconst url = 'https://x.dev/#ffffff';")).toEqual(["color-literal"]);
    expect(rules("A.vue", vue("<!-- <button> -->\n<Button />"))).toEqual([]);
    expect(maskComments("a /* b */ c", "css")).toBe("a         c");
  });

  it("reports the line of the break", () => {
    const [finding] = checkModuleFiles({ "m/src/a.css": ".a {\n  gap: 8px;\n  color: #000;\n}" });
    expect(finding).toMatchObject({ file: "m/src/a.css", line: 3, rule: "color-literal", text: "color: #000;" });
  });

  it("finds Tailwind classes in CSS only in @apply", () => {
    expect(rules("a.css", ".a { @apply bg-white; }")).toContain("palette-color");
    expect(rules("a.css", ".a { transition: opacity var(--duration-menu) var(--ease-out-strong); }")).toEqual([]);
  });

  it("flags a size class the module defines under 12 px", () => {
    const found = checkModuleFiles({ "m/src/theme.css": "@theme { --text-tiny: 10px; }", "m/src/A.vue": vue('<p class="text-tiny" />') });
    expect(found.map((f: { file: string; rule: string }) => `${f.file}:${f.rule}`)).toEqual(["m/src/A.vue:text-size", "m/src/theme.css:text-size"]);
  });

  it("leaves text catalogs alone", () => {
    expect(rules("locales.ts", 'export const en = { hint: "Uses ease-in, see #123" };')).toEqual(["catalog-check"]);
  });

  it("lets a plain page without Vue find its own elements", () => {
    expect(rules("overlay.ts", 'const box = document.getElementById("box");')).toEqual([]);
  });
});

describe("check-modules allow comments", () => {
  it("allows a break with a reason on the line or the line before, in every comment form", () => {
    expect(rules("a.css", ".a { color: #b8860b; } /* rules-allow: color-literal rarity colour of the game */")).toEqual([]);
    expect(rules("a.ts", "// rules-allow: color-literal canvas drawing\nctx.fillStyle = '#000';")).toEqual([]);
    expect(rules("A.vue", vue("<!-- rules-allow: raw-control the board cell is game art -->\n<button />"))).toEqual([]);
  });

  it("allows only the named rule, and only nearby", () => {
    expect(rules("a.css", "/* rules-allow: spacing reason here */\n.a { color: #000; }")).toEqual(["color-literal"]);
    expect(rules("a.css", "/* rules-allow: color-literal paper of the page */\n\n.a { color: #000; }")).toEqual(["color-literal"]);
  });

  it("takes several rules and a file-wide allow", () => {
    expect(rules("a.css", ".a { color: #000; padding: 6px; } /* rules-allow: color-literal, spacing PDF paper */")).toEqual([]);
    expect(rules("rarity.ts", "// rules-allow-file: color-literal the game's rarity colours\nexport const gold = '#b8860b';\nexport const blue = '#3050f8';")).toEqual([]);
  });

  it("needs a reason and a known rule, and a broken allow allows nothing", () => {
    expect(rules("a.css", ".a { color: #000; } /* rules-allow: color-literal */")).toEqual(["allow-comment", "color-literal"]);
    expect(rules("a.css", ".a { color: #000; } /* rules-allow: colour because */")).toEqual(["allow-comment", "color-literal"]);
  });
});

describe("check-modules module rules", () => {
  const LOCALES = 'export const en = { a: "A" };\nexport const de = { a: "A" };';

  it("catalog-check: catalogs need a checkCatalogs test", () => {
    expect(checkModuleFiles({ "m/src/locales.ts": LOCALES }).map((f: { rule: string }) => f.rule)).toEqual(["catalog-check"]);
    expect(checkModuleFiles({ "m/src/locales.ts": LOCALES }, { "m/src/locales.test.ts": "checkCatalogs(en, de);" })).toEqual([]);
  });

  it("suspend-flush: a save behind a timer needs onSuspend and onDispose", () => {
    const save = 'import { ref } from "vue";\nlet timer;\nfunction later() {\n  timer = setTimeout(() => void save(), 400);\n}';
    expect(checkModuleFiles({ "m/src/a.ts": save })).toMatchObject([{ rule: "suspend-flush", line: 4, message: expect.stringContaining("onSuspend and onDispose") }]);
    expect(checkModuleFiles({ "m/src/a.ts": save, "m/src/main.ts": "lifecycle.onSuspend(flush);\nlifecycle.onDispose(flush);" })).toEqual([]);
    // A timer that saves nothing, and panel state written at once, need no flush.
    expect(checkModuleFiles({ "m/src/a.ts": "setTimeout(() => (open.value = false), 400);\npanel.getState();\npanel.setState(view);" })).toEqual([]);
  });

  it("view-memory-flush: a saved map view needs flushViewMemory", () => {
    const map = vue('<ZoomPane persist-key="map" />');
    expect(checkModuleFiles({ "m/src/Map.vue": map }).map((f: { rule: string }) => f.rule)).toEqual(["view-memory-flush"]);
    expect(checkModuleFiles({ "m/src/Map.vue": map, "m/src/main.ts": "lifecycle.onSuspend(() => flushViewMemory());" })).toEqual([]);
  });

  it("panel-state-read: panel state written is read back", () => {
    expect(checkModuleFiles({ "m/src/a.ts": "void panel.setState({ tab });" }).map((f: { rule: string }) => f.rule)).toEqual(["panel-state-read"]);
    expect(checkModuleFiles({ "m/src/a.ts": "const s = await panel.getState();\nvoid panel.setState({ tab });" })).toEqual([]);
  });

  it("module rules take an allow comment on their line", () => {
    expect(checkModuleFiles({ "m/src/a.ts": "// rules-allow: panel-state-read the host restores it\nvoid panel.setState({ tab });" })).toEqual([]);
  });
});

describe("check-modules baseline", () => {
  const before = ".a {\n  color: #000;\n}\n";

  it("knows a break that moved to another line", () => {
    const baseline = toBaseline(checkModuleFiles({ "m/src/a.css": before }));
    const moved = checkModuleFiles({ "m/src/a.css": "\n\n/* new rule above */\n" + before });
    expect(compareBaseline(moved, baseline)).toMatchObject({ fresh: [], known: [{ line: 5 }], fixed: 0 });
  });

  it("does not hide a new break on the line an old one moved away from", () => {
    const baseline = toBaseline(checkModuleFiles({ "m/src/a.css": before }));
    const after = checkModuleFiles({ "m/src/a.css": ".a {\n  background: #fff;\n  color: #000;\n}\n" });
    expect(compareBaseline(after, baseline).fresh).toMatchObject([{ line: 2, text: "background: #fff;" }]);
  });

  it("counts identical lines, so a copy of a known break is new", () => {
    const baseline = toBaseline(checkModuleFiles({ "m/src/a.css": before }));
    const twice = checkModuleFiles({ "m/src/a.css": ".a {\n  color: #000;\n}\n.b {\n  color: #000;\n}\n" });
    expect(compareBaseline(twice, baseline).fresh).toHaveLength(1);
  });

  it("counts fixed breaks", () => {
    const baseline = toBaseline(checkModuleFiles({ "m/src/a.css": before }));
    expect(compareBaseline([], baseline)).toMatchObject({ fresh: [], fixed: 1 });
  });

  it("runs end to end: fails on new breaks, passes after --update-baseline, keeps other modules' entries", () => {
    const root = mkdtempSync(path.join(tmpdir(), "check-modules-"));
    for (const name of ["one", "two"]) {
      mkdirSync(path.join(root, name, "src"), { recursive: true });
      writeFileSync(path.join(root, name, "tavora.module.json"), "{}");
      writeFileSync(path.join(root, name, "src", "style.css"), before);
    }
    const out: string[] = [];
    const log = (line: string) => out.push(line);
    expect(main([], root, log)).toBe(1);
    expect(out[0]).toMatch(/^one\/src\/style\.css:2 {2}color-literal {2}/);
    expect(main(["--update-baseline"], root, log)).toBe(0);
    expect(main([], root, log)).toBe(0);

    writeFileSync(path.join(root, "one", "src", "style.css"), before + ".b { padding: 6px; }\n");
    expect(main(["--update-baseline", "one"], root, log)).toBe(0);
    const saved = JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8"));
    expect(saved.findings.map((e: { file: string; rule: string }) => `${e.file} ${e.rule}`)).toEqual([
      "one/src/style.css color-literal",
      "one/src/style.css spacing",
      "two/src/style.css color-literal",
    ]);
    expect(main([], root, log)).toBe(0);
  });
});
