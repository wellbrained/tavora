import { describe, expect, it } from "vitest";
import { functionWord, insertFunction, suggest } from "./autocomplete";

describe("function autocomplete", () => {
  it("finds the function name being typed", () => {
    expect(functionWord("=SU", 3)).toEqual({ start: 1, prefix: "SU" });
    expect(functionWord("=A1+ro", 6)).toEqual({ start: 4, prefix: "ro" });
    expect(functionWord("=IF(A1;co", 9)).toEqual({ start: 7, prefix: "co" });
  });

  it("stays quiet outside a formula, in quotes and inside a cell name", () => {
    expect(functionWord("SU", 2)).toBeNull();
    expect(functionWord('="su', 4)).toBeNull();
    expect(functionWord("=A1", 3)).toBeNull();
    expect(functionWord("=SUM(", 5)).toBeNull();
  });

  it("suggests matching functions and puts one in with its bracket", () => {
    expect(suggest("su")).toEqual(["SUM", "SUMIF"]);
    expect(suggest("xl")).toEqual(["XLOOKUP"]);
    expect(insertFunction("=ro+1", { start: 1, prefix: "ro" }, 3, "ROUND")).toEqual({ text: "=ROUND(+1", caret: 7 });
  });
});
