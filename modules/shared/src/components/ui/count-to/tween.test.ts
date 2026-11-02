import { describe, expect, it } from "vitest"
import { countAt, easeOut, formatCount, roundTo, stepDecimals } from "./tween"

describe("easeOut", () => {
  it("starts at 0, ends at 1 and is ahead of a straight line on the way", () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(1)).toBe(1)
    expect(easeOut(0.5)).toBeGreaterThan(0.5)
    expect(easeOut(-1)).toBe(0)
    expect(easeOut(2)).toBe(1)
  })
})

describe("countAt", () => {
  it("lands exactly on the target", () => {
    expect(countAt(3, 8, 1)).toBe(8)
    expect(countAt(0.1, 0.35, 1, 2)).toBe(0.35)
  })
  it("stays on whole steps in between, up or down", () => {
    const up = countAt(0, 10, 0.3)
    expect(Number.isInteger(up)).toBe(true)
    expect(up).toBeGreaterThan(0)
    expect(up).toBeLessThan(10)
    const down = countAt(10, 0, 0.3)
    expect(Number.isInteger(down)).toBe(true)
    expect(down).toBeLessThan(10)
  })
  it("keeps decimals when asked", () => {
    expect(countAt(0, 1, 0.4, 1)).toBe(roundTo(easeOut(0.4), 1))
  })
})

describe("formatCount", () => {
  it("follows the locale", () => {
    expect(formatCount(1234, "integer", "en-GB")).toBe("1,234")
    expect(formatCount(1234, "integer", "de-DE")).toBe("1.234")
    expect(formatCount(4.5, "decimal", "de-DE")).toBe("4,5")
    expect(formatCount(4, "decimal", "en-GB")).toBe("4.0")
  })
  it("takes a percent as a fraction", () => {
    expect(formatCount(0.25, "percent", "en-GB")).toBe("25%")
    expect(formatCount(0.256, "percent", "en-GB", 1)).toBe("25.6%")
  })
})

describe("stepDecimals", () => {
  it("counts a percent in steps of its own decimals", () => {
    expect(stepDecimals("integer")).toBe(0)
    expect(stepDecimals("decimal")).toBe(1)
    expect(stepDecimals("decimal", 2)).toBe(2)
    expect(stepDecimals("percent")).toBe(2)
    expect(stepDecimals("percent", 1)).toBe(3)
  })
})
