import { describe, expect, it } from "vitest"
import { placeAt, placeNextTo, slideOffsets, type Slot } from "./slide"

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

describe("placeAt", () => {
  // Middles of the others: a 10, b 39, c 63, d 82.
  it("puts the item before the first other one whose middle the pointer has not passed, or last", () => {
    expect(placeAt(rows, "a", 30)).toBeNull(); // before b's middle: a stays first
    expect(placeAt(rows, "a", 45)).toEqual({ id: "c", after: false });
    expect(placeAt(rows, "a", 200)).toEqual({ id: "d", after: true });
    expect(placeAt(rows, "d", 5)).toEqual({ id: "a", after: false });
  })
  it("is null where the order would not change, and for an unknown item or a list of one", () => {
    expect(placeAt(rows, "d", 200)).toBeNull();
    expect(placeAt(rows, "x", 10)).toBeNull();
    expect(placeAt([rows[0]!], "a", 10)).toBeNull();
  })
  it("does not swap back and forth: the answer depends on the pointer alone, however the rows have slid", () => {
    // Countdown (a) dragged down past Stopwatch (b): the same pointer gives the same place whatever the order of the calls.
    const places = [41, 41, 41, 41].map((y) => placeAt(rows, "a", y));
    expect(new Set(places.map((place) => JSON.stringify(place))).size).toBe(1);
    // And a walk down then up crosses each middle once, at the same pointer both ways.
    const down = [20, 30, 40, 50, 60, 70, 80, 90].map((y) => placeAt(rows, "a", y)?.id ?? "-");
    const up = [90, 80, 70, 60, 50, 40, 30, 20].map((y) => placeAt(rows, "a", y)?.id ?? "-").reverse();
    expect(up).toEqual(down);
  })
  it("only counts the places it is given", () => {
    expect(placeAt(rows, "a", 200, ["a", "b", "c"])).toEqual({ id: "c", after: true });
    expect(placeAt(rows, "a", 200, ["a"])).toBeNull();
  })
})
