import { describe, expect, it } from "vitest"
import { placeNextTo, slideOffsets, type Slot } from "./slide"

const rows: Slot[] = [
  { id: "a", start: 0, size: 20 },
  { id: "b", start: 24, size: 30 },
  { id: "c", start: 58, size: 10 },
  { id: "d", start: 72, size: 20 },
]

describe("placeNextTo", () => {
  it("puts an item before or after another", () => {
    expect(placeNextTo(["a", "b", "c"], "a", "c", true)).toEqual(["b", "c", "a"])
    expect(placeNextTo(["a", "b", "c"], "c", "a", false)).toEqual(["c", "a", "b"])
  })
  it("leaves the order alone for itself or an unknown id", () => {
    expect(placeNextTo(["a", "b"], "a", "a", true)).toEqual(["a", "b"])
    expect(placeNextTo(["a", "b"], "x", "a", true)).toEqual(["a", "b"])
  })
})

describe("slideOffsets", () => {
  it("moves nothing when the item would stay where it is", () => {
    const offsets = slideOffsets(rows, "b", "a", true)
    expect([...offsets.values()].every((offset) => offset === 0)).toBe(true)
  })
  it("slides the items in between by the dragged item's room and puts the dragged one in the gap", () => {
    // a goes after c: b and c move up by a's size plus the gap; a lands below them, d stays.
    const offsets = slideOffsets(rows, "a", "c", true)
    expect(offsets.get("b")).toBe(-24)
    expect(offsets.get("c")).toBe(-24)
    expect(offsets.get("a")).toBe(48)
    expect(offsets.get("d")).toBe(0)
  })
  it("moves an item up past taller ones", () => {
    const offsets = slideOffsets(rows, "d", "a", false)
    // d (20) first, then a, b, c: each of those moves down by 20 + the first gap (4).
    expect(offsets.get("d")).toBe(-72)
    expect(offsets.get("a")).toBe(24)
    expect(offsets.get("b")).toBe(24)
    expect(offsets.get("c")).toBe(24)
  })
})
