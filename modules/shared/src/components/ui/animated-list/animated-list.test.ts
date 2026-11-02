import { describe, expect, it } from "vitest"
import { MAX_MOVING_ROWS, movesNow, movesRows } from "./AnimatedList"

describe("movesRows", () => {
  it("moves for a row the user adds or removes", () => {
    expect(movesRows(["a", "b", "c"], ["a", "b", "c", "d"])).toBe(true)
    expect(movesRows(["a", "b", "c"], ["a", "c"])).toBe(true)
    expect(movesRows(["a"], ["a", "b"])).toBe(true)
    expect(movesRows(["a"], [])).toBe(true)
  })

  it("moves for a row added to an empty list", () => {
    expect(movesRows([], ["a"])).toBe(true)
  })

  it("stays still on the first render and when nothing came or went", () => {
    expect(movesRows(null, ["a", "b"])).toBe(false)
    expect(movesRows(["a", "b"], ["b", "a"])).toBe(false)
    expect(movesRows(["a", "b"], ["a", "b"])).toBe(false)
  })

  it("stays still when a list fills up from nothing (first load)", () => {
    expect(movesRows([], ["a", "b"])).toBe(false)
    expect(movesRows([], ["a", "b", "c", "d"])).toBe(false)
  })

  it("stays still when many rows come or go at once", () => {
    const many = Array.from({ length: MAX_MOVING_ROWS + 1 }, (_, i) => `x${i}`)
    expect(movesRows(["a", ...many], ["a"])).toBe(false)
    expect(movesRows(["a"], ["a", ...many])).toBe(false)
  })

  it("stays still when the whole list is replaced", () => {
    expect(movesRows(["a", "b"], ["c", "d"])).toBe(false)
    expect(movesRows(["a"], ["b"])).toBe(false)
  })
})

describe("movesNow", () => {
  it("follows movesRows while the switch stays on", () => {
    expect(movesNow(true, true, ["a", "b"], ["a"])).toBe(true)
  })

  it("stays still while the switch is off (a filter is typed)", () => {
    expect(movesNow(false, true, ["a", "b", "c"], ["a"])).toBe(false)
    expect(movesNow(false, false, ["a", "b", "c"], ["a"])).toBe(false)
  })

  it("stays still on the render that turns the switch back on (the filter is cleared)", () => {
    expect(movesNow(true, false, ["a"], ["a", "b"])).toBe(false)
    expect(movesNow(true, false, ["a", "b"], ["a"])).toBe(false)
  })
})
