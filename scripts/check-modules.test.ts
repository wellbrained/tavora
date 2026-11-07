import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BASELINE_FILE, RULES, checkFile, checkModule, compareBaseline, findModules, isCatalog, lexScript, main, parseAllow, updatedBaseline } from "./check-modules.mjs";

type Finding = { file: string; line: number; rule: string; message: string; text: string };

/** The rules a file breaks, as the one file of a module (so the module-wide window-keys check runs too). */
const rulesIn = (file: string, text: string) => (checkModule([{ file, text }]) as Finding[]).map((f) => f.rule);
const vue = (template: string, script = "", style = "") =>
  `<script setup lang="ts">\n${script}\n</script>\n\n<template>\n${template}\n</template>\n${style ? `\n<style scoped>\n${style}\n</style>\n` : ""}`;

/**
 * Per rule: lines that break it and lines that don't, each as [file, source]. Every hit is also checked with an allow
 * comment on the line before (or, where a line comment can't go, in the same line).
 */
const CASES: Record<string, { hit: [string, string][]; miss: [string, string][] }> = {
  color: {
    hit: [
      ["a.css", ".x { color: #1a1a1a; }"],
      ["a.css", ".x { background: rgb(0 0 0 / 0.5); }"],
      ["a.css", ".x { border-color: hsl(200 50% 50%); }"],
      ["a.css", ".x { color: oklch(0.7 0.1 200); }"],
      ["a.css", ".x { color: white; }"],
      ["a.css", ".x { border: 1px solid black; }"],
      ["a.ts", 'export const ink = "#fff";'],
      ["a.ts", 'ctx.fillStyle = "white";'],
      ["a.ts", 'const style = { color: "red" };'],
      ["a.vue", vue('<svg><path fill="#ff0000" /></svg>')],
      ["a.vue", vue('<svg><path stroke="black" /></svg>')],
      ["a.vue", vue('<div style="color: white">x</div>')],
      ["a.vue", vue('<div class="bg-[#1b1b1b]">x</div>')],
    ],
    miss: [
      ["a.css", ".x { color: var(--foreground); border: 1px solid var(--border); }"],
      ["a.css", ".x { background: color-mix(in oklab, var(--primary) 20%, transparent); }"],
      ["a.css", ".x { color: currentColor; fill: none; }"],
      ["a.ts", 'createApp(App).mount("#app");'],
      ["a.ts", "class A { #cache = 1; read() { return this.#cache; } }"],
      ["a.ts", "// was #fff before"],
      ["a.ts", 'const label = "White";'],
      ["a.vue", vue("<Table><template #default>x</template><template #add>y</template></Table>")],
      ["a.vue", vue('<a href="#top">Top</a>')],
    ],
  },
  "color-fallback": {
    hit: [
      ["a.css", ".x { color: var(--warning, #f5c518); }"],
      ["a.css", ".x { color: var(--fg, white); }"],
      ["a.css", ".x { color: var(--fg, var(--color, #fff)); }"],
      ["a.vue", vue('<p style="color: var(--warning, #f5c518)">x</p>')],
    ],
    miss: [
      ["a.css", ".x { color: var(--warning); }"],
      ["a.css", ".x { color: var(--fg, var(--foreground)); }"],
      ["a.css", ".x { padding: var(--gap, 8px); }"],
    ],
  },
  palette: {
    hit: [
      ["a.vue", vue('<div class="bg-neutral-800 p-2">x</div>')],
      ["a.vue", vue('<div class="text-white">x</div>')],
      ["a.vue", vue('<div :class="{ \'hover:bg-black/50\': open }">x</div>')],
      ["a.vue", vue('<div class="border-red-500">x</div>')],
      ["a.ts", 'const tone = "flex text-gray-500";'],
      ["a.ts", 'const tone = "text-[calc(10px+1px)] hover:text-red-500";'],
      ["a.vue", vue('<div class="@max-[279px]:hidden [&_input]:bg-background! bg-white">x</div>')],
      ["a.css", ".x { @apply bg-zinc-900; }"],
      ["a.css", ".x { color: var(--color-red-500); }"],
    ],
    miss: [
      ["a.vue", vue('<div class="bg-card text-muted-foreground border-border">x</div>')],
      ["a.vue", vue('<div class="bg-primary-fill text-primary-fill-foreground">x</div>')],
      ["a.ts", 'const text = "Pick black or white.";'],
    ],
  },
  "font-family": {
    hit: [
      ["a.css", '.x { font-family: "Inter Variable", system-ui, sans-serif; }'],
      ["a.css", ".x { font-family: monospace; }"],
      ["a.css", ".x { font: 600 13px Georgia, serif; }"],
      ["a.css", '.x { font: 12px/1 "Segoe UI", sans-serif; }'],
      ["a.css", '.x { font-family: var(--font, "Inter Variable"), sans-serif; }'],
      ["a.ts", 'const s = { fontFamily: "Arial" };'],
      ["a.ts", 'ctx.font = "12px Inter";'],
      ["a.vue", vue("<p class=\"font-['Inter']\">x</p>")],
    ],
    miss: [
      ["a.css", ".x { font-family: var(--font-sans); }"],
      ["a.css", ".x { font-family: var(--note-font, inherit); }"],
      ["a.css", ".x { font-family: var(--font-mono), ui-monospace, monospace; }"],
      ["a.css", ".x { font: 11px/1 sans-serif; } .y { font: 600 12px system-ui; } .z { font: 13px inherit; }"],
      ["a.ts", 'ctx.font = "12px monospace";'],
      ["a.css", "@font-face { font-family: 'Lora Variable'; src: url(x.woff2); }"],
      ["a.ts", "const el = { fontFamily: 2 };"],
      ["a.ts", "ctx.font = `${weight} ${size}px ${family}`;"],
      ["a.vue", vue('<p class="font-sans font-mono">x</p>')],
    ],
  },
  "font-size": {
    hit: [
      ["a.css", ".x { font-size: 11px; }"],
      ["a.css", ".x { font-size: 0.6875rem; }"],
      ["a.css", ".x { font-size: 15px; }"],
      ["a.css", ".x { font: 10px/1.2 var(--font-sans); }"],
      ["a.css", "@theme { --text-2xs: 10px; }"],
      ["a.vue", vue('<span class="text-[11px]">x</span>')],
      ["a.vue", vue('<span class="text-[0.7rem]">x</span>')],
      ["a.ts", 'const s = { fontSize: "10px" };'],
      ["a.ts", 'ctx.font = "9px sans-serif";'],
      ["a.css", ".x { font: 11px/1 sans-serif; }"],
    ],
    miss: [
      ["a.css", ".x { font-size: 12px; } .y { font-size: 0.875rem; } .z { font-size: 20px; } .w { font-size: 34px; }"],
      ["a.css", ".x { font-size: 1.2em; font-size: inherit; }"],
      ["a.vue", vue('<span class="text-xs text-sm text-[13px] text-[length:inherit]">x</span>')],
      ["a.ts", "const s = { fontSize: 11 };"],
    ],
  },
  "font-weight": {
    hit: [
      ["a.css", ".x { font-weight: 700; }"],
      ["a.css", ".x { font-weight: bold; }"],
      ["a.vue", vue('<b class="font-bold">x</b>')],
      ["a.vue", vue('<b class="font-[650]">x</b>')],
      ["a.ts", "const s = { fontWeight: 300 };"],
    ],
    miss: [
      ["a.css", ".x { font-weight: 600; } .y { font-weight: normal; }"],
      ["a.css", "@font-face { font-family: 'X'; font-weight: 400 700; }"],
      ["a.vue", vue('<b class="font-medium font-semibold font-normal">x</b>')],
    ],
  },
  radius: {
    hit: [
      ["a.css", ".x { border-radius: 6px; }"],
      ["a.css", ".x { border-top-left-radius: 0.5rem; }"],
      ["a.vue", vue('<div class="rounded-[6px]">x</div>')],
      ["a.ts", 'const s = { borderRadius: "4px" };'],
    ],
    miss: [
      ["a.css", ".x { border-radius: var(--radius-md); } .y { border-radius: 50%; } .z { border-radius: 0; } .p { border-radius: 9999px; }"],
      ["a.vue", vue('<div class="rounded-md rounded-full rounded-[var(--radius)]">x</div>')],
    ],
  },
  "kit-control": {
    hit: [
      ["a.vue", vue('<button type="button" @click="go">Go</button>')],
      ["a.vue", vue('<select v-model="x"><option>a</option></select>')],
      ["a.vue", vue("<table><tr><td>1</td></tr></table>")],
      ["a.vue", vue("<details><summary>More</summary></details>")],
      ["a.vue", vue('<input type="range" min="0" max="10" />')],
      ["a.vue", vue('<input type="checkbox" v-model="on" />')],
      ["a.vue", vue('<input v-model="query" type="search" @keydown.enter="a > b && go()" />')],
      ["a.vue", vue('<textarea v-model="body" />')],
      ["a.vue", vue('<Button variant="ghost" :aria-pressed="bold">B</Button>')],
    ],
    miss: [
      ["a.vue", vue('<Button variant="ghost" @click="go">Go</Button><Select v-model="x" /><Table /><Collapsible />')],
      ["a.vue", vue('<input type="file" hidden @change="pick" />')],
      ["a.vue", vue('<input ref="rename" v-model="draft" type="text" class="h-6 border-ring" />')],
      ["a.vue", vue('<input ref="title" v-model="title" />')],
      ["a.vue", vue('<input :type="kind" />')],
      ["a.vue", vue("<Toggle :pressed=\"bold\">B</Toggle>")],
      ["a.ts", 'const html = "a <button> in a string of a .ts file";'],
    ],
  },
  "dom-query": {
    hit: [
      ["a.vue", vue("<div />", "const focus = () => document.querySelector<HTMLElement>('.row')?.focus();")],
      ["a.vue", vue("<div />", 'const el = document.getElementById("search");')],
      ["use-thing.ts", 'import { ref } from "vue";\nexport const find = () => document.querySelectorAll(".item");'],
    ],
    miss: [
      ["a.vue", vue('<div ref="root" />', "const root = ref<HTMLElement>();\nroot.value?.querySelector('.row');")],
      ["overlay.ts", 'const root = document.getElementById("overlay")!;'],
      ["main.ts", 'import { createApp } from "vue";\ncreateApp(App).mount(document.querySelector("#app")!);'],
    ],
  },
  motion: {
    hit: [
      ["a.vue", vue('<div class="transition-all">x</div>')],
      ["a.vue", vue('<div class="transition-opacity duration-300">x</div>')],
      ["a.vue", vue('<div class="transition-transform ease-out">x</div>')],
      ["a.vue", vue('<div class="transition-colors">x</div>')],
      ["a.vue", vue('<div class="transition hover:opacity-80">x</div>')],
      ["a.vue", vue('<div class="transition-[width]">x</div>')],
      ["a.css", ".x { transition: opacity 150ms ease; }"],
      ["a.css", ".x { transition: background-color var(--duration-press) var(--ease-out-strong); }"],
      ["a.css", ".x { animation: spin 1s linear infinite; }"],
      ["a.css", ".x { transition-timing-function: cubic-bezier(0.2, 0, 0, 1); }"],
      ["a.css", ".x { transition: all var(--duration-menu) var(--ease-out-strong); }"],
    ],
    miss: [
      ["a.css", ".x { transition: opacity var(--duration-press) var(--ease-out-strong), transform var(--duration-press) var(--ease-out-strong); }"],
      ["a.css", ".x { transition: none; animation-name: pop; }"],
      ["a.vue", vue('<div class="transition-opacity transition-[opacity,translate] duration-[var(--duration-menu)]">x</div>')],
      ["a.ts", 'const text = "A smooth transition, easing in.";'],
    ],
  },
  "z-index": {
    hit: [
      ["a.css", ".x { z-index: 10; }"],
      ["a.vue", vue('<div class="absolute z-50">x</div>')],
      ["a.vue", vue('<div class="z-[2]">x</div>')],
      ["a.ts", "const s = { zIndex: 5 };"],
    ],
    miss: [
      ["a.css", ".x { z-index: auto; } .y { z-index: 0; }"],
      ["a.vue", vue('<div class="z-0 size-10">x</div>')],
    ],
  },
  shadow: {
    hit: [
      ["a.css", ".x { box-shadow: 0 2px 8px rgb(0 0 0 / 0.3); }"],
      ["a.css", ".x { box-shadow: inset 0 0 0 2px var(--primary); }"],
      ["a.vue", vue('<div class="shadow-lg">x</div>')],
      ["a.vue", vue('<div class="rounded-md shadow">x</div>')],
      ["a.vue", vue('<div class="shadow-[0_2px_0_0_var(--primary)]">x</div>')],
    ],
    miss: [
      ["a.css", ".x { box-shadow: none; } .y { box-shadow: var(--shadow-popover); }"],
      ["a.vue", vue('<div class="shadow-none">x</div>')],
      ["a.ts", 'const kind = "shadow";'],
    ],
  },
  "all-caps": {
    hit: [
      ["a.vue", vue('<h2 class="text-xs uppercase">x</h2>')],
      ["a.css", ".x { text-transform: uppercase; }"],
    ],
    miss: [
      ["a.css", ".x { text-transform: none; }"],
      ["a.ts", 'const hint = "Uppercase letters count too.";'],
    ],
  },
  "focus-ring": {
    hit: [
      ["a.vue", vue('<div tabindex="0" class="outline-none">x</div>')],
      ["a.vue", vue('<a class="focus-visible:ring-2 focus-visible:ring-ring">x</a>')],
      ["a.vue", vue('<a class="focus-visible:outline-ring">x</a>')],
      ["a.css", ".x:focus { outline: none; }"],
      ["a.css", ".x { outline: 0; }"],
    ],
    miss: [
      ["a.css", ".x { outline: 1px solid var(--ring); }"],
      ["a.vue", vue('<div class="ring-1 ring-border">x</div>')],
    ],
  },
  "menu-anchor": {
    hit: [
      ["a.vue", vue("<div />", "const open = (event: MouseEvent) => sdk.ui.showMenu({ x: event.clientX, y: event.clientY, items });")],
      ["a.ts", "void sdk.ui.showMenu({ items: [{ id: 'a', label: 'A' }] });"],
    ],
    miss: [
      ["a.ts", "void sdk.ui.showMenu({ anchor: event.currentTarget as HTMLElement, items });"],
      ["a.ts", "const showMenu = (request: MenuOptions) => sdk.value?.ui.showMenu(request);"],
    ],
  },
  "window-keys": {
    hit: [
      ["Board.vue", vue("<div />", 'onMounted(() => window.addEventListener("keydown", onKey));')],
      ["Board.vue", vue("<div />", "onMounted(() => addEventListener('keyup', onKey, true));")],
      ["Board.vue", vue("<div />", 'document.addEventListener("keydown", escape);')],
      ["use-keys.ts", 'import { onMounted } from "vue";\nonMounted(() => window.addEventListener("keypress", onKey));'],
      ["Board.vue", vue("<div />", 'useEventListener(window, "keydown", onKey);')],
      ["Board.vue", vue("<div />", 'onKeyStroke("Escape", close);')],
    ],
    miss: [
      ["Board.vue", vue('<div ref="root" @keydown="onKey" />', 'root.value?.addEventListener("keydown", onKey);')],
      ["Board.vue", vue("<div />", 'window.addEventListener("resize", onResize);')],
      ["Board.vue", vue("<div />", 'onKeyStroke("Escape", close, { target: root });')],
      ["overlay.ts", 'addEventListener("keydown", onKey);'],
      ["main.ts", 'import { createApp } from "vue";\ncreateApp(App).mount("#app");\naddEventListener("keydown", onKey);'],
    ],
  },
  "file-save": {
    hit: [
      ["a.ts", "const a = document.createElement('a');\na.href = url;\na.download = 'board.png';\na.click();"],
      ["a.vue", vue('<a :href="url" download="notes.json">Save</a>')],
    ],
    miss: [
      ["a.ts", "await sdk.files.saveJson({ name: 'board.json', data });"],
      ["a.ts", "if (item.download === true) start();"],
    ],
  },
};

/** The line of a case's first hit, for putting an allow comment before it. */
function withAllow(file: string, source: string, rule: string): string {
  const hits = checkModule([{ file, text: source }]) as Finding[];
  const line = hits.find((h) => h.rule === rule)!.line;
  const lines = source.split("\n");
  const inTemplate = file.endsWith(".vue") && lines.slice(0, line - 1).some((l) => l.startsWith("<template>")) && !lines.slice(0, line - 1).some((l) => l.startsWith("</template>"));
  const inStyle = file.endsWith(".css") || (file.endsWith(".vue") && lines.slice(0, line - 1).some((l) => l.startsWith("<style")));
  const comment = inTemplate ? `<!-- rules-allow: ${rule} game art -->` : inStyle ? `/* rules-allow: ${rule} game art */` : `// rules-allow: ${rule} game art`;
  lines.splice(line - 1, 0, comment);
  return lines.join("\n");
}

describe("check-modules rules", () => {
  it("has a case for every per-file rule", () => {
    const moduleRules = ["suspend-flush", "view-flush", "panel-state-read", "catalogs"];
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(RULES).filter((rule) => !moduleRules.includes(rule)).sort());
  });

  for (const [rule, { hit, miss }] of Object.entries(CASES)) {
    describe(rule, () => {
      it.each(hit)("flags %s: %s", (file, source) => {
        expect(rulesIn(file, source)).toContain(rule);
      });
      it.each(miss)("passes %s: %s", (file, source) => {
        expect(rulesIn(file, source)).not.toContain(rule);
      });
      it.each(hit)("takes an allow comment in %s: %s", (file, source) => {
        const allowed = withAllow(file, source, rule);
        expect(rulesIn(file, allowed).filter((r) => r === rule).length).toBeLessThan(rulesIn(file, source).filter((r) => r === rule).length);
        expect(rulesIn(file, allowed)).not.toContain("rules-allow");
      });
    });
  }

  it("ignores what is in comments", () => {
    expect(rulesIn("a.ts", "/* color: #fff; was text-white */\n// <button> font-family: Arial")).toEqual([]);
    expect(rulesIn("a.css", "/* .x { color: #fff; font-size: 10px } */")).toEqual([]);
    expect(rulesIn("a.vue", vue("<!-- <button class='text-white'> -->"))).toEqual([]);
  });

  it("knows a short tag start by the lines after it", () => {
    const [f] = checkFile("a.vue", vue('<Button\n  variant="ghost"\n  :aria-pressed="on"\n>B</Button>')) as Finding[];
    expect(f.text).toBe('<Button variant="ghost" :aria-pressed="on"');
  });

  it("reports file, line, rule and the line's text", () => {
    const [f] = checkFile("modules/x/src/a.css", ".x {\n  color: #123456;\n}") as Finding[];
    expect(f).toEqual({ file: "modules/x/src/a.css", line: 2, rule: "color", message: "#123456", text: "color: #123456;" });
  });
});

describe("allow comments", () => {
  it("cover their own line, and the next one when they stand alone", () => {
    expect(rulesIn("a.css", ".x { color: #fff; } /* rules-allow: color paper of a PDF page */")).toEqual([]);
    expect(rulesIn("a.css", "/* rules-allow: color paper of a PDF page */\n.x { color: #fff; }")).toEqual([]);
    expect(rulesIn("a.css", ".y { color: #000; } /* rules-allow: color paper */\n.x { color: #fff; }")).toEqual(["color"]);
    expect(rulesIn("a.css", "/* rules-allow: color paper */\n\n.x { color: #fff; }")).toEqual(["color"]);
  });

  it("only allow the rules they name", () => {
    expect(rulesIn("a.css", "/* rules-allow: color game art */\n.x { color: #fff; font-size: 10px; }")).toEqual(["font-size"]);
    expect(rulesIn("a.css", "/* rules-allow: color, font-size game art */\n.x { color: #fff; font-size: 10px; }")).toEqual([]);
  });

  it("need a reason and a known rule", () => {
    expect(checkFile("a.css", "/* rules-allow: color */\n.x { color: #fff; }").map((f: Finding) => [f.rule, f.message])).toEqual([
      ["color", "#fff"],
      ["rules-allow", "say why: rules-allow: color <reason>"],
    ]);
    expect(rulesIn("a.ts", "// rules-allow: colour game art\nconst a = 1;")).toEqual(["rules-allow"]);
  });

  it("rules-allow-file covers the whole file for the rules it names", () => {
    const palette = '// rules-allow-file: color rarity colours from the game\nexport const RARITY = { epic: "#b67cff", legendary: "#ff8000" };\nconst size = { fontSize: "10px" };';
    expect(rulesIn("rarity.ts", palette)).toEqual(["font-size"]);
    expect(rulesIn("Page.vue", vue('<div class="bg-white">x</div>\n<p class="text-black">y</p>', "", "/* rules-allow-file: palette the paper of a PDF page */"))).toEqual([]);
  });

  it("rules-allow-file needs a reason and can't be faked by a string", () => {
    expect(checkFile("a.ts", '// rules-allow-file: color\nconst a = "#fff";').map((f: Finding) => [f.rule, f.message])).toEqual([
      ["color", "#fff"],
      ["rules-allow", "say why: rules-allow-file: color <reason>"],
    ]);
    expect(rulesIn("a.ts", 'const fake = "// rules-allow-file: color nope";\nconst a = "#fff";')).toEqual(["color"]);
    expect(rulesIn("a.ts", 'const fake = `/* rules-allow-file: color nope */`;\nconst a = "#fff";')).toEqual(["color"]);
  });

  it("rules-allow-file also covers the module rules anchored in that file", () => {
    const delayed = { file: "m/src/App.vue", text: vue("<div />", "// rules-allow-file: suspend-flush the store flushes it\nsetTimeout(save, 500);") };
    expect(checkModule([delayed])).toEqual([]);
  });

  it("are read in every comment form", () => {
    expect(parseAllow("// rules-allow: color game art")).toEqual({ rules: ["color"], reason: "game art", file: false });
    expect(parseAllow("/* rules-allow: color, radius canvas drawing */")).toEqual({ rules: ["color", "radius"], reason: "canvas drawing", file: false });
    expect(parseAllow("<!-- rules-allow: kit-control the kit has no tree yet -->")).toEqual({ rules: ["kit-control"], reason: "the kit has no tree yet", file: false });
    expect(parseAllow("// a plain comment")).toBeNull();
    expect(parseAllow("/* rules-allow-file: color, palette rarity colours */")).toEqual({ rules: ["color", "palette"], reason: "rarity colours", file: true });
  });
});

describe("text catalogs", () => {
  it("are told by their name, their folder or their en and de exports", () => {
    expect(["m/src/locales.ts", "m/src/builds/locales.ts", "m/src/i18n.ts", "m/src/texts/index.ts", "m/src/i18n/de.ts", "m/src/texts.ts"].every((f) => isCatalog(f))).toBe(true);
    expect(isCatalog("m/src/strings.ts", "export const en = {};\nexport const de = {};")).toBe(true);
    expect(isCatalog("m/src/text.ts", "export function line() {}")).toBe(false);
    expect(isCatalog("m/src/App.vue")).toBe(false);
  });

  it("skip the colour and motion rules, whose patterns a sentence can look like", () => {
    const texts = 'export const en = {\n  pick: "Pick a color like #ff8800",\n  items: "Items #123",\n  hint: "Use var(--warning, #f5c518) and ease-in.",\n};';
    expect(rulesIn("m/src/locales.ts", texts)).toEqual([]);
    expect(rulesIn("m/src/labels.ts", texts)).toContain("color");
  });
});

describe("lexScript", () => {
  it("reads a class list with an arbitrary value in it as a class list", () => {
    const hits = checkFile("a.ts", 'const c = "text-[calc(10px+1px)] hover:text-red-500 dark:bg-slate-900";') as Finding[];
    expect(hits.map((h) => h.message)).toEqual(["hover:text-red-500".slice(6), "dark:bg-slate-900".slice(5)]);
    expect(checkFile("a.ts", 'const c = "Pick text-red-500 if you like.";')).toEqual([]);
  });

  it("tells comments from strings, template literals and regular expressions", () => {
    const src = 'const a = "// not a comment"; const r = /\\/\\/[a-z]/g; const t = `x ${"/*"} y`; // real\n/* block */';
    const { comments } = lexScript(src);
    expect(comments.map(({ start, end }: { start: number; end: number }) => src.slice(start, end))).toEqual(["// real", "/* block */"]);
  });
});

describe("module rules", () => {
  const file = (name: string, text: string) => ({ file: `m/src/${name}`, text });
  const rules = (files: { file: string; text: string }[]) => (checkModule(files) as Finding[]).map((f) => `${f.rule}@${f.file.slice(6)}:${f.line}`);

  it("suspend-flush: a delayed save needs onSuspend and onDispose", () => {
    const delayed = file("App.vue", vue("<div />", "let timer = 0;\nfunction later() {\n  timer = setTimeout(saveView, 500);\n}"));
    expect(rules([delayed])).toEqual(["suspend-flush@App.vue:4"]);
    expect(checkModule([delayed])[0].message).toContain("no onSuspend and onDispose");
    const flushed = file("main.ts", "sdk.lifecycle.onSuspend(flush);\nsdk.lifecycle.onDispose(flush);");
    expect(rules([delayed, flushed])).toEqual([]);
    expect(checkModule([delayed, file("main.ts", "sdk.lifecycle.onSuspend(flush);")])[0].message).toContain("no onDispose");
    // A timer that saves nothing, and an onSuspend only in a comment.
    expect(rules([file("a.ts", "setTimeout(() => (saved.value = false), 2000);\n// lifecycle.onSuspend(flush)")])).toEqual([]);
    const allowed = file("App.vue", vue("<div />", "// rules-allow: suspend-flush the store flushes this one\nsetTimeout(save, 500);"));
    expect(rules([allowed])).toEqual([]);
  });

  it("view-flush: a remembered ZoomPane view needs flushViewMemory", () => {
    const pane = file("Map.vue", vue('<ZoomPane persist-key="map" />'));
    expect(rules([pane])).toEqual(["view-flush@Map.vue:6"]);
    expect(rules([pane, file("main.ts", "sdk.lifecycle.onSuspend(() => void flushViewMemory());")])).toEqual([]);
    expect(rules([file("locales.ts", 'export const en = { hint: "Give it a persist-key." };')])).toEqual([]);
  });

  it("panel-state-read: panel state that is written is read back", () => {
    const write = file("App.vue", vue("<div />", "void sdk.panel.setState({ tab: tab.value });"));
    expect(rules([write])).toEqual(["panel-state-read@App.vue:2"]);
    expect(rules([write, file("main.ts", "const state = await sdk.panel.getState<State>();")])).toEqual([]);
    expect(rules([write, file("session.ts", "await openItems<Header>(sdk, { restore: async (launch, saved) => pick(saved) });")])).toEqual([]);
  });

  it("catalogs: a module with texts has a checkCatalogs test", () => {
    const connect = file("main.ts", 'import { de, en } from "./locales";\nconnectModule({ texts: { en, de } });');
    expect(rules([connect])).toEqual(["catalogs@main.ts:2"]);
    expect(rules([connect, file("locales.test.ts", "it('matches', () => checkCatalogs(en, de));")])).toEqual([]);
  });

  it("font-size: the module's own text tokens under 12 px count where they are used", () => {
    const theme = file("style.css", "@theme {\n  --text-tiny: 10px;\n  --text-tiny--line-height: 14px;\n  --text-big: 24px;\n}");
    const use = file("Row.vue", vue('<span class="text-tiny">x</span>\n<span class="text-big text-tinyish">y</span>', 'const c = "flex text-tiny";'));
    expect(rules([theme, use])).toEqual(["font-size@Row.vue:2", "font-size@Row.vue:6", "font-size@style.css:2"]);
    expect(checkModule([theme, use]).find((f: Finding) => f.file.endsWith("Row.vue"))!.message).toBe("text-tiny: 10 px is under 12 px");
    expect(rules([file("Row.vue", vue('<span class="text-tiny">x</span>'))])).toEqual([]);
  });

  it("window-keys: the page's entry script and the component it mounts may listen on the window", () => {
    const main = file("main.ts", 'import { createApp } from "vue";\nimport App from "./App.vue";\ncreateApp(App).mount("#app");');
    const root = file("App.vue", vue("<div />", "function onKey(event: KeyboardEvent) {\n  if (handleUndoKey(event)) return;\n}\nonMounted(() => addEventListener(\"keydown\", onKey));"));
    const board = file("ui/Board.vue", vue("<div />", 'onMounted(() => window.addEventListener("keydown", keydown));'));
    expect(rules([main, root, board])).toEqual(["window-keys@ui/Board.vue:2"]);
    const rendered = file("overlay.ts", 'import { createApp, h } from "vue";\nimport Card from "./ui/Board.vue";\ncreateApp({ render: () => h(Card) }).mount("#app");');
    expect(rules([rendered, board])).toEqual([]);
    expect(rules([root])).toEqual(["window-keys@App.vue:5"]);
  });

  it("window-keys: with pages, every script but their entries counts, Vue or not", () => {
    const pages = [file("index.html", '<script type="module" src="./main.ts"></script>'), file("overlay.html", '<script type="module" src="/overlay.ts"></script>')];
    const main = file("main.ts", 'import { createApp } from "vue";\nimport App from "./App.vue";\ncreateApp(App).mount("#app");');
    const overlay = file("overlay.ts", 'addEventListener("keydown", onKey);');
    const session = file("boardSession.ts", 'import { exportToBlob } from "@excalidraw/excalidraw";\naddEventListener("keydown", copyKey, true);');
    expect(rules([...pages, main, overlay, session])).toEqual(["window-keys@boardSession.ts:2"]);
  });

  it("leaves tests out of the per-file rules", () => {
    expect(rules([file("a.test.ts", 'const ink = "#fff";')])).toEqual([]);
  });
});

describe("baseline", () => {
  const f = (file: string, line: number, rule: string, text: string) => ({ file, line, rule, message: "", text });
  const known = [f("modules/a/src/A.vue", 10, "color", "color: #fff;"), f("modules/a/src/A.vue", 20, "kit-control", "<button>")];
  const baseline = updatedBaseline(null, known, ["modules/a"]);

  it("keeps breaks by file, rule and line text, counted", () => {
    expect(baseline.files).toEqual({ "modules/a/src/A.vue": { color: { "color: #fff;": 1 }, "kit-control": { "<button>": 1 } } });
  });

  it("still knows a break whose line moved", () => {
    const moved = [f("modules/a/src/A.vue", 14, "color", "color: #fff;"), f("modules/a/src/A.vue", 31, "kit-control", "<button>")];
    expect(compareBaseline(moved, baseline, ["modules/a"]).fresh).toEqual([]);
  });

  it("does not hide a new break on a line that moved to a known break's place", () => {
    const now = [f("modules/a/src/A.vue", 10, "color", "background: #000;"), f("modules/a/src/A.vue", 14, "color", "color: #fff;")];
    const { fresh, known: old } = compareBaseline(now, baseline, ["modules/a"]);
    expect(fresh.map((x: Finding) => x.text)).toEqual(["background: #000;"]);
    expect(old.map((x: Finding) => x.text)).toEqual(["color: #fff;"]);
  });

  it("counts the same line twice as two breaks", () => {
    const twice = [f("modules/a/src/A.vue", 10, "color", "color: #fff;"), f("modules/a/src/A.vue", 40, "color", "color: #fff;")];
    expect(compareBaseline(twice, baseline, ["modules/a"]).fresh.map((x: Finding) => x.line)).toEqual([40]);
  });

  it("does not let a known break pass in another file or under another rule", () => {
    const elsewhere = [f("modules/a/src/B.vue", 10, "color", "color: #fff;"), f("modules/a/src/A.vue", 10, "palette", "color: #fff;")];
    expect(compareBaseline(elsewhere, baseline, ["modules/a"]).fresh).toHaveLength(2);
  });

  it("counts fixed breaks of the checked modules only", () => {
    expect(compareBaseline([], baseline, ["modules/a"]).gone).toBe(2);
    expect(compareBaseline([], baseline, ["modules/b"]).gone).toBe(0);
  });

  it("never keeps an allow-comment problem, and leaves other modules' entries when updating some", () => {
    const other = updatedBaseline(baseline, [f("modules/b/src/B.vue", 1, "color", "x"), f("modules/b/src/B.vue", 2, "rules-allow", "y")], ["modules/b"]);
    expect(Object.keys(other.files)).toEqual(["modules/a/src/A.vue", "modules/b/src/B.vue"]);
    expect(other.files["modules/b/src/B.vue"]).toEqual({ color: { x: 1 } });
    expect(compareBaseline([f("modules/b/src/B.vue", 2, "rules-allow", "y")], other, ["modules/b"]).fresh).toHaveLength(1);
  });
});

describe("pnpm check:modules", () => {
  function repo(layout: "tavora" | "modules") {
    const root = mkdtempSync(path.join(tmpdir(), "check-modules-"));
    const dir = layout === "tavora" ? path.join(root, "modules", "dice") : path.join(root, "dice");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(path.join(dir, "tavora.module.json"), "{}");
    writeFileSync(path.join(dir, "src", "style.css"), ".tray {\n  color: #fff;\n}\n");
    if (layout === "tavora") mkdirSync(path.join(root, "modules", "shared", "src"), { recursive: true });
    return { root, dir };
  }
  const run = (argv: string[], cwd: string) => {
    const out: string[] = [];
    const code = main(argv, { cwd, log: (line: string) => out.push(line) });
    return { code, out: out.join("\n") };
  };

  it("finds the modules of either repo layout", () => {
    expect(findModules(repo("tavora").root)).toEqual(["modules/dice"]);
    expect(findModules(repo("modules").root)).toEqual(["dice"]);
    expect(findModules(repo("tavora").root, ["modules/dice"])).toEqual(["modules/dice"]);
  });

  it("fails on a new break, passes once it is in the baseline, and fails again on the next one", () => {
    const { root, dir } = repo("modules");
    const first = run([], root);
    expect(first.code).toBe(1);
    expect(first.out).toContain("dice/src/style.css:2  color  #fff.");
    expect(run(["--update-baseline"], root).code).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, BASELINE_FILE), "utf8")).files).toEqual({ "dice/src/style.css": { color: { "color: #fff;": 1 } } });
    // The known break moves down two lines: still known.
    writeFileSync(path.join(dir, "src", "style.css"), "/* tray */\n\n.tray {\n  color: #fff;\n}\n");
    expect(run([], root)).toMatchObject({ code: 0 });
    writeFileSync(path.join(dir, "src", "style.css"), ".tray {\n  color: #fff;\n  font-size: 10px;\n}\n");
    const next = run([], root);
    expect(next.code).toBe(1);
    expect(next.out).toContain("dice/src/style.css:3  font-size");
    expect(next.out).not.toContain("style.css:2");
  });

  it("says when known breaks are fixed", () => {
    const { root, dir } = repo("tavora");
    run(["--update-baseline"], root);
    writeFileSync(path.join(dir, "src", "style.css"), ".tray {\n  color: var(--foreground);\n}\n");
    const { code, out } = run([], root);
    expect(code).toBe(0);
    expect(out).toContain("1 known break is fixed");
  });

  it("counts per rule and per module", () => {
    const { out } = run(["--summary"], repo("tavora").root);
    expect(out).toMatch(/color\s+1/);
    expect(out).toMatch(/modules\/dice\s+1/);
  });

  it("refuses unknown options and folders without modules", () => {
    const { root } = repo("tavora");
    expect(run(["--fix"], root).code).toBe(2);
    expect(run(["nowhere"], root).code).toBe(2);
  });
});
