import { describe, expect, it } from "vitest";
import { de, en } from "./locales";
import { GROUPS, OLD_TABS, PAGES, isPageId, keys, matches, searchText } from "./pages";
import { shownSource } from "./shown-source";

// The example files on disk, by "<page>/<Name>", and their sources.
const files = Object.keys(import.meta.glob("./examples/*/*.vue")).map((path) => path.slice("./examples/".length, -".vue".length));
const sources = import.meta.glob<string>("./examples/*/*.vue", { eager: true, query: "?raw", import: "default" });
const listed = PAGES.flatMap((page) => page.examples.map((name) => `${page.id}/${name}`));
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

  it("show their own file, less only the disabled prop line and one blank line", () => {
    const PROP = "defineProps<{ disabled?: boolean }>();";
    for (const [path, source] of Object.entries(sources)) {
      const file = source.replace(/\r\n/g, "\n").trim().split("\n");
      const shown = shownSource(source).replace(/\r\n/g, "\n").split("\n");
      expect(shown.join("\n"), path).not.toContain("defineProps");
      if (!file.includes(PROP)) {
        expect(shown, path).toEqual(file);
        continue;
      }
      // Take the shown lines out of the file in order; what is left over is the prop line and one blank line.
      const left: string[] = [];
      let at = 0;
      for (const line of file) {
        if (at < shown.length && shown[at] === line) at++;
        else left.push(line);
      }
      expect(at, path).toBe(shown.length);
      expect([...left].sort(), path).toEqual(["", PROP].sort());
    }
  });

  it("take Show disabled as an optional prop named disabled", () => {
    for (const [path, source] of Object.entries(sources)) {
      const props = source.match(/defineProps<([^>]*)>/)?.[1];
      if (props) expect(props, path).toBe("{ disabled?: boolean }");
    }
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
