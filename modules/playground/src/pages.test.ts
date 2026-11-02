import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "./locales";
import { exampleCode, findPages, GROUPS, groupKey, OLD_TABS, pageById, pageKey, PAGES } from "./pages";

const here = path.dirname(fileURLToPath(import.meta.url));
const exampleFiles = readdirSync(path.join(here, "examples"), { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".vue"))
  .map((file) => file.replace(/\\/g, "/").replace(/\.vue$/, ""))
  .sort();

const title = (page: (typeof PAGES)[number]) => en[pageKey(page.id)];
const group = (page: (typeof PAGES)[number]) => en[groupKey(page.group)];

describe("pages", () => {
  it("shows every example file exactly once, and only files that exist", () => {
    const used = PAGES.flatMap((page) => page.examples.map((example) => example.file)).sort();
    expect(used).toEqual(exampleFiles);
  });

  it("keeps each example in its page's folder", () => {
    for (const page of PAGES) for (const example of page.examples) expect(example.file.startsWith(`${page.id}/`), example.file).toBe(true);
  });

  it("has unique page ids, a title for each and only known groups, in menu order", () => {
    expect(new Set(PAGES.map((page) => page.id)).size).toBe(PAGES.length);
    for (const page of PAGES) expect(en[pageKey(page.id)], page.id).toBeTruthy();
    const order = PAGES.map((page) => GROUPS.indexOf(page.group));
    expect(order.every((at, index) => at >= 0 && (index === 0 || at >= order[index - 1]!))).toBe(true);
  });

  it("opens an old saved tab on a page that exists", () => {
    for (const id of Object.values(OLD_TABS)) expect(pageById(id), id).toBeDefined();
  });

  it("an empty page says it comes later", () => {
    for (const page of PAGES.filter((entry) => !entry.examples.length)) expect(page.coming, page.id).toBe(true);
  });
});

describe("findPages", () => {
  it("finds every page with no query", () => {
    expect(findPages("  ", title, group)).toEqual(PAGES);
  });

  it("finds a page by a keyword, its title, its group or several words", () => {
    expect(findPages("slider", title, group).map((page) => page.id)).toEqual(["numbers"]);
    expect(findPages("Tooltips", title, group).map((page) => page.id)).toEqual(["tooltips"]);
    expect(findPages("canvas", title, group).map((page) => page.id)).toEqual(["pan-zoom", "tile-map"]);
    expect(findPages("select empty", title, group).map((page) => page.id)).toEqual(["pick-one"]);
  });

  it("finds nothing for words no page has", () => {
    expect(findPages("spaceship", title, group)).toEqual([]);
  });
});

describe("exampleCode", () => {
  it("leaves out the playground's Show disabled wiring", () => {
    const source = [
      '<script setup lang="ts">',
      'import { Button } from "@tavora/official-ui/components/ui/button";',
      'import { useOff } from "../../dev";',
      "",
      "const off = useOff();",
      "</script>",
      "",
      "<template>",
      '  <Button :disabled="off">Save</Button>',
      '  <Button :disabled="off || !ready">Send</Button>',
      "</template>",
      "",
    ].join("\n");
    expect(exampleCode(source)).toBe(
      [
        '<script setup lang="ts">',
        'import { Button } from "@tavora/official-ui/components/ui/button";',
        "</script>",
        "",
        "<template>",
        "  <Button>Save</Button>",
        '  <Button :disabled="!ready">Send</Button>',
        "</template>",
        "",
      ].join("\n"),
    );
  });

  it("drops a script that only held the wiring", () => {
    const source = '<script setup lang="ts">\nimport { useOff } from "../../dev";\n\nconst off = useOff();\n</script>\n\n<template>\n  <p :disabled="off">Hi</p>\n</template>\n';
    expect(exampleCode(source)).toBe("<template>\n  <p>Hi</p>\n</template>\n");
  });

  it("keeps the rest of a script as it is", () => {
    const source = '<script setup lang="ts">\nimport { ref } from "vue";\nimport { useOff } from "../../dev";\n\nconst off = useOff();\nconst open = ref(false);\n</script>\n';
    expect(exampleCode(source)).toBe('<script setup lang="ts">\nimport { ref } from "vue";\n\nconst open = ref(false);\n</script>\n');
  });

  it("leaves no trace of the wiring in any example", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of exampleFiles) {
      const code = exampleCode(readFileSync(path.join(here, "examples", `${file}.vue`), "utf8"));
      expect(code, file).not.toMatch(/useOff|="off"|="off \|\||[^.]\boff\.value/);
    }
  });
});
