// Test helpers for modules built on the kit. Import from "@tavora/official-ui/testing" in `*.test.ts` files only:
// this entry needs vitest and is never part of a module's or the app's bundle.

import { describe, expect, it } from "vitest";

export { ariaProblems, danglingReferences, extraTabStops, focusLostAfter } from "./aria-patterns";

export { catalogProblems, type CheckCatalogsOptions } from "@tavora/sdk/testing";
import { catalogProblems, type CheckCatalogsOptions } from "@tavora/sdk/testing";

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
