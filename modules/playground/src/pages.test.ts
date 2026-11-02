import { readFileSync } from "node:fs";
import { THEME_TOKENS } from "@tavora/sdk";
import { describe, expect, it } from "vitest";
import { de, en } from "./locales";
import { GROUPS, OLD_TABS, PAGES, isPageId, keys, matches, searchText } from "./pages";
import { shownSource } from "./shown-source";

// The example files on disk, by "<page>/<Name>", and their sources.
const files = Object.keys(import.meta.glob("./examples/*/*.vue")).map((path) => path.slice("./examples/".length, -".vue".length));
const sources = import.meta.glob<string>("./examples/*/*.vue", { eager: true, query: "?raw", import: "default" });
const listed = PAGES.flatMap((page) => page.examples.map((name) => `${page.id}/${name}`));
// The kit's own stylesheets, which the Foundations examples describe (read as text; a CSS import would be processed).
const kitCss = (name: string) => readFileSync(new URL(`../../shared/src/${name}.css`, import.meta.url), "utf8");
const themeCss = kitCss("theme");
const motionCss = kitCss("motion");
const lookup = (catalog: Record<string, string>) => (key: string) => catalog[key];

describe("pages", () => {
  it("list every example file once, and only files that exist", () => {
    expect([...listed].sort()).toEqual([...files].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("have a title and an intro, and their groups a name, in both languages", () => {
    for (const catalog of [en, de] as Record<string, string>[]) {
      for (const page of PAGES) {
        expect(catalog[keys.page(page.id)], page.id).toBeTruthy();
        expect(catalog[keys.intro(page.id)], page.id).toBeTruthy();
      }
      for (const group of GROUPS) expect(catalog[keys.group(group)], group).toBeTruthy();
    }
  });

  it("give every example a title, and no text belongs to an example that isn't there", () => {
    for (const page of PAGES) for (const name of page.examples) expect(en[keys.example(page.id, name) as keyof typeof en], `${page.id}/${name}`).toBeTruthy();
    const known = new Set(PAGES.flatMap((page) => page.examples.flatMap((name) => [keys.example(page.id, name), keys.note(page.id, name), keys.rule(page.id, name)])));
    expect(Object.keys(en).filter((key) => key.startsWith("ex.") && !known.has(key))).toEqual([]);
  });

  it("put every group to use, in the menu's order", () => {
    expect([...new Set(PAGES.map((page) => page.group))]).toEqual([...GROUPS]);
  });

  it("send a panel saved with the old tabs to a page that exists", () => {
    for (const page of Object.values(OLD_TABS)) expect(isPageId(page)).toBe(true);
  });
});

describe("examples", () => {
  it("are small files with a template", () => {
    for (const [path, source] of Object.entries(sources)) expect(source, path).toContain("<template>");
  });

  it("show their own file, exactly, with plain line ends and no empty lines at its ends", () => {
    for (const [path, source] of Object.entries(sources)) {
      expect(shownSource(source), path).toBe(source.replace(/\r\n/g, "\n").trim());
      expect(shownSource(source), path).not.toContain("\r");
    }
  });

  it("know nothing about Show disabled: no props, no disabled binding to a prop", () => {
    for (const [path, source] of Object.entries(sources)) {
      expect(source, path).not.toContain("defineProps");
      expect(source, path).not.toMatch(/:disabled="disabled\b/);
    }
  });
});

describe("foundations", () => {
  const source = (file: string) => sources[`./examples/${file}.vue`] ?? "";

  it("fill every page of the group, so none says it is coming", () => {
    for (const page of PAGES.filter((entry) => entry.group === "foundations")) expect(page.examples.length, page.id).toBeGreaterThan(0);
  });

  it("show every theme token on the Colours page, once", () => {
    for (const token of THEME_TOKENS) expect(source("colours/Tokens").split(`["${token}", `).length - 1, token).toBe(1);
  });

  it("keep the labels inside examples in both languages, and leave none unused", () => {
    const used = new Set<string>();
    for (const code of Object.values(sources)) for (const match of code.matchAll(/"(demo\.[\w.]+)"/g)) used.add(match[1]!);
    for (const catalog of [en, de] as Record<string, string>[]) for (const key of used) expect(catalog[key], key).toBeTruthy();
    expect([...used].sort()).toEqual(Object.keys(en).filter((key) => key.startsWith("demo.")).sort());
  });

  it("list text sizes that the theme has", () => {
    const sizes = [...source("text/TypeScale").matchAll(/cls: "text-(\w+)[^"]*", size: "(\d+) \/ (\d+) px"/g)];
    expect(sizes.map((match) => match[1])).toEqual(["xl", "lg", "base", "sm", "xs"]);
    for (const [, name, size, line] of sizes) {
      expect(themeCss, name).toContain(`--text-${name}: ${size}px;`);
      expect(themeCss, name).toContain(`--text-${name}--line-height: ${line}px;`);
    }
  });

  it("list spacing steps that sit on the 4 px grid", () => {
    const steps = [...source("spacing/Scale").matchAll(/px: (\d+), box: "size-(\d+)", tailwind: "(\d+)"/g)];
    expect(steps.map((match) => Number(match[1]))).toEqual([4, 8, 12, 16, 24, 32]);
    for (const [, px, size, tailwind] of steps) {
      expect(Number(size), px).toBe(Number(tailwind));
      expect(Number(px), px).toBe(Number(tailwind) * 4);
    }
  });

  it("only demo curves and times that motion.css defines", () => {
    for (const token of [...source("motion/Curves").matchAll(/"(--ease-[\w-]+)"/g), ...source("motion/Durations").matchAll(/"(--(?:ease|duration)-[\w-]+)"/g)]) expect(motionCss, token[1]).toContain(`${token[1]}:`);
  });
});

describe("search", () => {
  const find = (query: string, catalog: Record<string, string> = en) => PAGES.filter((page) => matches(searchText(page, lookup(catalog)), query)).map((page) => page.id);

  it("finds a page by its title, a keyword or an example's name", () => {
    expect(find("slider")).toContain("numbers");
    expect(find("Buttons")).toContain("buttons");
    expect(find("combobox")).toEqual(["pick"]);
    expect(find("skeleton")).toEqual(["loading"]);
  });

  it("finds a page by its German title when German is shown", () => {
    expect(find("regler", de)).toContain("numbers");
    expect(find("kachelkarte", de)).toEqual(["map"]);
  });

  it("needs every word, in any order", () => {
    expect(find("zoom pins")).toEqual(["map"]);
    expect(find("nothing like this")).toEqual([]);
    expect(find("   ")).toHaveLength(PAGES.length);
  });
});
