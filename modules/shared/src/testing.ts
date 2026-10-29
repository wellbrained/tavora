// Test helpers for modules built on the kit. Import from "@tavora/official-ui/testing" in `*.test.ts` files only:
// this entry needs vitest and is never part of a module's or the app's bundle.

import { describe, expect, it } from "vitest";

export interface CheckCatalogsOptions {
  /** Title of the test group. Default: "locales". */
  name?: string;
  /** Keys that may be an empty string. */
  allowEmpty?: readonly string[];
  /** Keys that end in `.one` or `.other` but are not plural forms. */
  notPlural?: readonly string[];
}

const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string))].sort();

/** What is wrong with a pair of catalogs, one sentence each, naming the key. Empty when they match. */
export function catalogProblems(en: Readonly<Record<string, string>>, de: Readonly<Record<string, string>>, options: CheckCatalogsOptions = {}): string[] {
  const problems: string[] = [];
  const allowEmpty = new Set(options.allowEmpty);
  const notPlural = new Set(options.notPlural);
  for (const key of Object.keys(en)) if (!(key in de)) problems.push(`"${key}" is missing in German`);
  for (const key of Object.keys(de)) if (!(key in en)) problems.push(`"${key}" is missing in English`);
  for (const [language, catalog] of [["English", en], ["German", de]] as const) {
    for (const [key, text] of Object.entries(catalog)) {
      if (text.trim() === "" && !allowEmpty.has(key)) problems.push(`"${key}" is empty in ${language}`);
      if (!notPlural.has(key) && key.endsWith(".one") && !(key.replace(/\.one$/, ".other") in catalog)) problems.push(`"${key}" has no .other form in ${language}`);
      if (!notPlural.has(key) && key.endsWith(".other") && !(key.replace(/\.other$/, ".one") in catalog)) problems.push(`"${key}" has no .one form in ${language}`);
    }
  }
  for (const key of Object.keys(en)) {
    const other = de[key];
    if (other === undefined) continue;
    const wanted = placeholders(en[key] as string);
    const found = placeholders(other);
    if (wanted.join() !== found.join()) problems.push(`"${key}" has {${found.join("}, {")}} in German but {${wanted.join("}, {")}} in English`);
  }
  return problems;
}

/**
 * Registers a vitest group that checks a module's English and German texts: the same keys, the same `{placeholders}`,
 * `.one` and `.other` together, and no empty text. Each failure names its key. A module's whole locale test is
 * `checkCatalogs(en, de)`.
 */
export function checkCatalogs(en: Readonly<Record<string, string>>, de: Readonly<Record<string, string>>, options: CheckCatalogsOptions = {}): void {
  describe(options.name ?? "locales", () => {
    it("English and German match", () => {
      expect(catalogProblems(en, de, options), "texts that differ between English and German").toEqual([]);
    });
  });
}
