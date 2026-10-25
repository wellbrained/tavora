import { describe, expect, it } from "vitest"
import { sparkPoints } from "./points"

describe("sparkPoints", () => {
  it("draws nothing with fewer than two values or no room", () => {
    expect(sparkPoints([], 100, 40, 0, 100)).toEqual([])
    expect(sparkPoints([50], 100, 40, 0, 100)).toEqual([])
    expect(sparkPoints([1, 2], 0, 40, 0, 100)).toEqual([])
  })
  it("spreads values across the width, high values near the top", () => {
    expect(sparkPoints([0, 50, 100], 100, 42, 0, 100, 1)).toEqual([[0, 41], [50, 21], [100, 1]])
  })
  it("keeps values inside the range", () => {
    expect(sparkPoints([-20, 300], 10, 12, 0, 100, 1)).toEqual([[0, 11], [10, 1]])
  })
})
