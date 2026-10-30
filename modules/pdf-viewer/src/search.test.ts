import { describe, expect, it } from "vitest";
import { buildPageText, findMatches, findRanges, firstMatchFrom, segmentsFor, stepMatch } from "./search";

describe("findRanges", () => {
  it("finds every place, ignoring case, without overlaps", () => {
    expect(findRanges("Dragon, dragon and DRAGON", "dragon")).toEqual([
      { start: 0, end: 6 },
      { start: 8, end: 14 },
      { start: 19, end: 25 },
    ]);
    expect(findRanges("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("finds nothing for an empty or blank query", () => {
    expect(findRanges("text", "")).toEqual([]);
    expect(findRanges("text", "   ")).toEqual([]);
  });
});

describe("buildPageText", () => {
  it("joins the items, with a space at a line break, and notes where each starts", () => {
    const page = buildPageText([{ str: "Hello", hasEOL: true }, { str: "wor" }, { str: "ld" }]);
    expect(page.text).toBe("Hello world");
    expect(page.starts).toEqual([0, 6, 9]);
  });
});

describe("findMatches", () => {
  it("lists matches page by page in reading order", () => {
    const matches = findMatches(["one two", "none", "two two"], "two");
    expect(matches.map((match) => [match.page, match.start])).toEqual([
      [1, 4],
      [3, 0],
      [3, 4],
    ]);
  });
});

describe("stepMatch", () => {
  it("wraps around in both directions", () => {
    expect(stepMatch(0, 3, 1)).toBe(1);
    expect(stepMatch(2, 3, 1)).toBe(0);
    expect(stepMatch(0, 3, -1)).toBe(2);
    expect(stepMatch(1, 3, -1)).toBe(0);
  });

  it("starts at an end when nothing is current, and has nothing when there are no matches", () => {
    expect(stepMatch(-1, 3, 1)).toBe(0);
    expect(stepMatch(-1, 3, -1)).toBe(2);
    expect(stepMatch(0, 0, 1)).toBe(-1);
    expect(stepMatch(0, 1, 1)).toBe(0);
  });
});

describe("firstMatchFrom", () => {
  const matches = findMatches(["x", "x", "", "x"], "x");
  it("starts at the page the reader is on, else the first", () => {
    expect(firstMatchFrom(matches, 2)).toBe(1);
    expect(firstMatchFrom(matches, 3)).toBe(2);
    expect(firstMatchFrom(matches, 9)).toBe(0);
    expect(firstMatchFrom([], 1)).toBe(-1);
  });
});

describe("segmentsFor", () => {
  const page = buildPageText([{ str: "red " }, { str: "dragon fire" }]);
  const matches = findRanges(page.text, "dragon fire");

  it("leaves an item without a match whole", () => {
    expect(segmentsFor("red ", page.starts[0]!, matches, null)).toEqual([{ text: "red " }]);
  });

  it("marks the part of an item inside a match and tells the current one", () => {
    expect(segmentsFor("dragon fire", page.starts[1]!, matches, null)).toEqual([{ text: "dragon fire", mark: "match" }]);
    expect(segmentsFor("dragon fire", page.starts[1]!, matches, matches[0]!)).toEqual([{ text: "dragon fire", mark: "current" }]);
  });

  it("cuts an item where a match begins and ends, also when the match spans items", () => {
    const spanning = findRanges("red dragon fire", "d dra");
    expect(segmentsFor("red ", 0, spanning, null)).toEqual([{ text: "re" }, { text: "d ", mark: "match" }]);
    expect(segmentsFor("dragon fire", 4, spanning, null)).toEqual([{ text: "dra", mark: "match" }, { text: "gon fire" }]);
  });
});
