import { describe, expect, it } from "vitest";
import { catalogProblems } from "../testing.js";

describe("catalogProblems", () => {
  it("is empty for matching catalogs", () => {
    expect(catalogProblems({ hi: "Hi {name}", "n.one": "One", "n.other": "{count} items" }, { hi: "Hallo {name}", "n.one": "Eins", "n.other": "{count} Dinge" })).toEqual([]);
  });

  it("names each problem by its key", () => {
    expect(catalogProblems({ a: "A {x}", b: "", "c.one": "C" }, { a: "A", d: "D", b: "", "c.one": "C" })).toEqual([
      '"d" is missing in English',
      '"b" is empty in English',
      '"c.one" has no .other form in English',
      '"b" is empty in German',
      '"c.one" has no .other form in German',
      '"a" has {} in German but {x} in English',
    ]);
    expect(catalogProblems({ b: "" }, { b: "" }, { allowEmpty: ["b"] })).toEqual([]);
  });
});
