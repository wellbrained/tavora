import { describe, expect, it } from "vitest";
import { catalogProblems, checkCatalogs } from "./testing";

const en = { hello: "Hello {name}", "left.one": "{count} left", "left.other": "{count} left (many)", bye: "Bye" };
const de = { hello: "Hallo {name}", "left.one": "{count} übrig", "left.other": "{count} übrig (viele)", bye: "Tschüss" };

describe("catalogProblems", () => {
  it("finds nothing in matching catalogs", () => {
    expect(catalogProblems(en, de)).toEqual([]);
  });

  it("names a key missing in either language", () => {
    const { bye, ...short } = de;
    expect(bye).toBeTruthy();
    expect(catalogProblems(en, short)).toEqual(['"bye" is missing in German']);
    expect(catalogProblems(short, de)).toEqual(['"bye" is missing in English']);
  });

  it("names a placeholder mismatch", () => {
    expect(catalogProblems(en, { ...de, hello: "Hallo {who}" })).toEqual(['"hello" has {who} in German but {name} in English']);
    expect(catalogProblems(en, { ...de, hello: "Hallo" })).toEqual(['"hello" has {} in German but {name} in English']);
  });

  it("names a plural form without its partner", () => {
    const { "left.other": _other, ...noOther } = de;
    const { "left.other": _enOther, ...enNoOther } = en;
    expect(_other && _enOther).toBeTruthy();
    expect(catalogProblems(enNoOther, noOther)).toEqual(['"left.one" has no .other form in English', '"left.one" has no .other form in German']);
    expect(catalogProblems(en, noOther)).toEqual(['"left.other" is missing in German', '"left.one" has no .other form in German']);
  });

  it("leaves a key alone that only looks like a plural form", () => {
    expect(catalogProblems({ ...en, "line.one": "One" }, { ...de, "line.one": "Eins" }, { notPlural: ["line.one"] })).toEqual([]);
  });

  it("names an empty text, unless allowed", () => {
    expect(catalogProblems(en, { ...de, bye: "  " })).toEqual(['"bye" is empty in German']);
    expect(catalogProblems(en, { ...de, bye: "" }, { allowEmpty: ["bye"] })).toEqual([]);
  });
});

describe("checkCatalogs", () => {
  checkCatalogs(en, de);
});
