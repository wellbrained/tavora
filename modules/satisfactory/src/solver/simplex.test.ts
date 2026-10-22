import { describe, expect, it } from "vitest";
import { minimise } from "./simplex";

describe("minimise", () => {
  it("finds the cheapest point", () => {
    // x + y = 4, x − z = 1 (z ≥ 0 so x ≥ 1); cheapest at x = 4 since x costs less than y.
    expect(minimise([1, 2, 0], [
      { terms: [[0, 1], [1, 1]], rhs: 4 },
      { terms: [[0, 1], [2, -1]], rhs: 1 },
    ])).toEqual([4, 0, 3]);
  });

  it("copes with repeated and negative rows", () => {
    const x = minimise([1, 0], [
      { terms: [[0, 1], [1, 1]], rhs: 2 },
      { terms: [[0, -1], [1, -1]], rhs: -2 },
    ]);
    expect(x).toEqual([0, 2]);
  });

  it("says when nothing fits", () => {
    expect(minimise([1, 1], [
      { terms: [[0, 1], [1, 1]], rhs: 2 },
      { terms: [[0, 1], [1, 1]], rhs: 3 },
    ])).toBeNull();
  });
});
