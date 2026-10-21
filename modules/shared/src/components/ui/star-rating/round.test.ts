import { describe, expect, it } from "vitest"
import { roundToHalf } from "./round"

describe("star rounding", () => {
  it("shows a rating to the nearest half star", () => {
    expect([4.7, 4.8, 4.2, 4.25, 4.74, 1, 0].map(roundToHalf)).toEqual([4.5, 5, 4, 4.5, 4.5, 1, 0])
    expect([-1, 7, Number.NaN].map(roundToHalf)).toEqual([0, 5, 0])
  })
})
