import { describe, expect, it } from "vitest"
import { cell, extendTo, fillPlan, fillShortcut, jump, moveByKey, rangeOf, selectAll, single, type GridSelection, type MoveContext } from "./selection"

const ctx = (extra: Partial<MoveContext> = {}): MoveContext => ({ rows: 100, cols: 26, ...extra })
const at = (row: number, col: number) => single(cell(row, col))
const key = (sel: GridSelection, name: string, mods: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}, extra?: Partial<MoveContext>) =>
  moveByKey(sel, { key: name, ...mods }, ctx(extra))

describe("arrows", () => {
  it("move one cell and stop at the edges", () => {
    expect(key(at(5, 5), "ArrowDown")?.active).toEqual(cell(6, 5))
    expect(key(at(5, 5), "ArrowLeft")?.active).toEqual(cell(5, 4))
    expect(key(at(0, 0), "ArrowUp")?.active).toEqual(cell(0, 0))
    expect(key(at(0, 0), "ArrowLeft")?.active).toEqual(cell(0, 0))
    expect(key(at(99, 25), "ArrowDown")?.active).toEqual(cell(99, 25))
    expect(key(at(99, 25), "ArrowRight")?.active).toEqual(cell(99, 25))
  })

  it("skip hidden rows", () => {
    const hidden = new Set([3, 4])
    expect(key(at(2, 0), "ArrowDown", {}, { rowShown: (r) => !hidden.has(r) })?.active).toEqual(cell(5, 0))
    expect(key(at(5, 0), "ArrowUp", {}, { rowShown: (r) => !hidden.has(r) })?.active).toEqual(cell(2, 0))
  })

  it("with Shift grow the range from the anchor and keep the active cell", () => {
    let sel: GridSelection = at(2, 2)
    sel = key(sel, "ArrowDown", { shift: true })!
    sel = key(sel, "ArrowRight", { shift: true })!
    expect(rangeOf(sel)).toEqual({ top: 2, left: 2, bottom: 3, right: 3 })
    expect(sel.active).toEqual(cell(2, 2))
    sel = key(sel, "ArrowUp", { shift: true })!
    sel = key(sel, "ArrowUp", { shift: true })!
    expect(rangeOf(sel)).toEqual({ top: 1, left: 2, bottom: 2, right: 3 })
  })

  it("leave Alt+arrows to others (a dropdown opens on Alt+↓)", () => {
    expect(key(at(1, 1), "ArrowDown", { alt: true })).toBeNull()
  })
})

describe("Ctrl+arrows", () => {
  // Column A: rows 0-3 filled, 4-6 empty, 7-8 filled.
  const filledRows = new Set([0, 1, 2, 3, 7, 8])
  const filled = (row: number, col: number) => col === 0 && filledRows.has(row)

  it("run to the end of a filled block", () => {
    expect(jump(cell(0, 0), 1, 0, ctx({ filled }))).toEqual(cell(3, 0))
  })

  it("jump over empty cells to the next filled one", () => {
    expect(jump(cell(3, 0), 1, 0, ctx({ filled }))).toEqual(cell(7, 0))
    expect(jump(cell(5, 0), 1, 0, ctx({ filled }))).toEqual(cell(7, 0))
    expect(jump(cell(7, 0), -1, 0, ctx({ filled }))).toEqual(cell(3, 0))
  })

  it("go to the edge when nothing is filled ahead", () => {
    expect(jump(cell(8, 0), 1, 0, ctx({ filled }))).toEqual(cell(99, 0))
    expect(jump(cell(0, 3), 0, 1, ctx({ filled }))).toEqual(cell(0, 25))
    expect(jump(cell(0, 0), -1, 0, ctx({ filled }))).toEqual(cell(0, 0))
  })

  it("with Shift grow the range to there", () => {
    const sel = key(at(0, 0), "ArrowDown", { ctrl: true, shift: true }, { filled })!
    expect(rangeOf(sel)).toEqual({ top: 0, left: 0, bottom: 3, right: 0 })
  })
})

describe("Tab and Enter", () => {
  it("move right and down from one cell, back with Shift", () => {
    expect(key(at(1, 1), "Tab")?.active).toEqual(cell(1, 2))
    expect(key(at(1, 1), "Tab", { shift: true })?.active).toEqual(cell(1, 0))
    expect(key(at(1, 1), "Enter")?.active).toEqual(cell(2, 1))
    expect(key(at(1, 1), "Enter", { shift: true })?.active).toEqual(cell(0, 1))
  })

  it("walk through a range and wrap, keeping it", () => {
    let sel: GridSelection = { active: cell(0, 0), anchor: cell(0, 0), focus: cell(1, 1) }
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      sel = key(sel, "Tab")!
      seen.push(`${sel.active.row},${sel.active.col}`)
    }
    expect(seen).toEqual(["0,1", "1,0", "1,1", "0,0", "0,1"])
    expect(rangeOf(sel)).toEqual({ top: 0, left: 0, bottom: 1, right: 1 })
    sel = { active: cell(0, 0), anchor: cell(0, 0), focus: cell(1, 1) }
    sel = key(sel, "Enter")!
    expect(sel.active).toEqual(cell(1, 0))
    sel = key(sel, "Enter")!
    expect(sel.active).toEqual(cell(0, 1))
    sel = key(sel, "Enter", { shift: true })!
    expect(sel.active).toEqual(cell(1, 0))
  })
})

describe("Home, End, Page Up/Down, Ctrl+A", () => {
  const filled = (row: number, col: number) => row === 4 && col <= 6

  it("Home goes to the first column, Ctrl+Home to A1", () => {
    expect(key(at(4, 9), "Home")?.active).toEqual(cell(4, 0))
    expect(key(at(40, 9), "Home", { ctrl: true })?.active).toEqual(cell(0, 0))
  })

  it("End goes to the row's last filled cell, Ctrl+End to the last used cell", () => {
    expect(key(at(4, 0), "End", {}, { filled })?.active).toEqual(cell(4, 6))
    expect(key(at(5, 0), "End", {}, { filled })?.active).toEqual(cell(5, 25))
    expect(key(at(0, 0), "End", { ctrl: true }, { usedBottom: 12, usedRight: 3 })?.active).toEqual(cell(12, 3))
  })

  it("Page Down moves a page of rows, Shift grows the range", () => {
    expect(key(at(0, 2), "PageDown", {}, { pageRows: 20 })?.active).toEqual(cell(20, 2))
    expect(key(at(95, 2), "PageDown", {}, { pageRows: 20 })?.active).toEqual(cell(99, 2))
    expect(key(at(30, 2), "PageUp", {}, { pageRows: 20 })?.active).toEqual(cell(10, 2))
    expect(rangeOf(key(at(0, 2), "PageDown", { shift: true }, { pageRows: 5 })!)).toEqual({ top: 0, left: 2, bottom: 5, right: 2 })
  })

  it("Ctrl+A selects everything and keeps the active cell", () => {
    const sel = key(at(3, 3), "a", { ctrl: true })!
    expect(rangeOf(sel)).toEqual({ top: 0, left: 0, bottom: 99, right: 25 })
    expect(sel.active).toEqual(cell(3, 3))
    expect(selectAll(0, 0).focus).toEqual(cell(0, 0))
  })

  it("other keys are left alone", () => {
    expect(key(at(0, 0), "x")).toBeNull()
    expect(key(at(0, 0), "Enter", { ctrl: true })).toBeNull()
  })
})

describe("extendTo", () => {
  it("keeps anchor and active", () => {
    const sel = extendTo(at(2, 2), cell(0, 5))
    expect(rangeOf(sel)).toEqual({ top: 0, left: 2, bottom: 2, right: 5 })
    expect(sel.active).toEqual(cell(2, 2))
  })
})

describe("fill handle", () => {
  const source = { top: 2, left: 1, bottom: 3, right: 2 }

  it("fills nothing while inside the source", () => {
    expect(fillPlan(source, cell(3, 2))).toBeNull()
    expect(fillPlan(source, cell(2, 1))).toBeNull()
  })

  it("grows down, up, right or left", () => {
    expect(fillPlan(source, cell(9, 2))).toEqual({ source, target: { top: 4, left: 1, bottom: 9, right: 2 }, direction: "down" })
    expect(fillPlan(source, cell(0, 1))).toEqual({ source, target: { top: 0, left: 1, bottom: 1, right: 2 }, direction: "up" })
    expect(fillPlan(source, cell(3, 6))).toEqual({ source, target: { top: 2, left: 3, bottom: 3, right: 6 }, direction: "right" })
    expect(fillPlan(source, cell(2, 0))).toEqual({ source, target: { top: 2, left: 0, bottom: 3, right: 0 }, direction: "left" })
  })

  it("follows the axis the pointer went further on", () => {
    expect(fillPlan(source, cell(5, 3))?.direction).toBe("down")
    expect(fillPlan(source, cell(4, 6))?.direction).toBe("right")
  })
})

describe("Ctrl+D and Ctrl+R", () => {
  it("fill from the first row or column of a range", () => {
    expect(fillShortcut({ top: 1, left: 0, bottom: 4, right: 1 }, "down")).toEqual({
      source: { top: 1, left: 0, bottom: 1, right: 1 },
      target: { top: 2, left: 0, bottom: 4, right: 1 },
      direction: "down",
    })
    expect(fillShortcut({ top: 1, left: 2, bottom: 1, right: 5 }, "right")?.target).toEqual({ top: 1, left: 3, bottom: 1, right: 5 })
  })

  it("take the cell above (left of) a single row (column)", () => {
    expect(fillShortcut({ top: 3, left: 2, bottom: 3, right: 2 }, "down")).toEqual({
      source: { top: 2, left: 2, bottom: 2, right: 2 },
      target: { top: 3, left: 2, bottom: 3, right: 2 },
      direction: "down",
    })
    expect(fillShortcut({ top: 0, left: 0, bottom: 0, right: 0 }, "down")).toBeNull()
    expect(fillShortcut({ top: 0, left: 0, bottom: 0, right: 0 }, "right")).toBeNull()
  })
})
