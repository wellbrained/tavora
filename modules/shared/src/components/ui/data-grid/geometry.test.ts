import { describe, expect, it } from "vitest"
import { columnIndex, columnName, hitIndex, makeAxis, scrollToShow, visibleRange } from "./geometry"

describe("makeAxis", () => {
  it("adds up the default and the own sizes", () => {
    const axis = makeAxis(5, 20, { 1: 50, 3: 10 })
    expect([0, 1, 2, 3, 4, 5].map((i) => axis.start(i))).toEqual([0, 20, 70, 90, 100, 120])
    expect(axis.total).toBe(120)
    expect(axis.size(1)).toBe(50)
    expect(axis.size(9)).toBe(0)
  })

  it("reads sizes from a map too, and ignores broken ones", () => {
    const axis = makeAxis(3, 10, new Map([[0, 30], [1, Number.NaN], [2, -5]]))
    expect(axis.total).toBe(50)
  })

  it("finds the item at a position", () => {
    const axis = makeAxis(4, 20)
    expect(axis.indexAt(-5)).toBe(0)
    expect(axis.indexAt(0)).toBe(0)
    expect(axis.indexAt(19.9)).toBe(0)
    expect(axis.indexAt(20)).toBe(1)
    expect(axis.indexAt(79)).toBe(3)
    expect(axis.indexAt(500)).toBe(3)
  })

  it("never lands on a hidden item", () => {
    const axis = makeAxis(6, 20, undefined, new Set([1, 2, 5]))
    expect(axis.total).toBe(60)
    expect(axis.size(1)).toBe(0)
    expect(axis.indexAt(20)).toBe(3)
    expect(axis.indexAt(19)).toBe(0)
    expect(axis.indexAt(1000)).toBe(4)
    const first = makeAxis(3, 20, undefined, new Set([0]))
    expect(first.indexAt(0)).toBe(1)
  })

  it("copes with an empty axis", () => {
    const axis = makeAxis(0, 20)
    expect(axis.total).toBe(0)
    expect(axis.indexAt(10)).toBe(0)
  })

  it("is quick for 20,000 rows", () => {
    const sizes: Record<number, number> = {}
    for (let i = 0; i < 20_000; i += 7) sizes[i] = 40
    const started = performance.now()
    const axis = makeAxis(20_000, 28, sizes)
    for (let i = 0; i < 10_000; i++) axis.indexAt(i * 57)
    expect(performance.now() - started).toBeLessThan(100)
  })
})

describe("visibleRange", () => {
  const axis = makeAxis(1000, 20)

  it("covers the viewport plus the overscan", () => {
    expect(visibleRange(axis, 0, 0, 100, 2)).toEqual([0, 6])
    expect(visibleRange(axis, 0, 400, 100, 2)).toEqual([18, 26])
  })

  it("starts after the frozen items, which are drawn on their own", () => {
    // Two frozen rows take 40; scrolled by 200, the first unfrozen row in view starts at 240.
    expect(visibleRange(axis, 2, 200, 100, 0)).toEqual([12, 14])
    expect(visibleRange(axis, 2, 0, 100, 0)).toEqual([2, 4])
  })

  it("stops at the end", () => {
    expect(visibleRange(axis, 0, 19_950, 100, 3)).toEqual([994, 999])
  })

  it("is empty when everything is frozen or there is no room", () => {
    expect(visibleRange(makeAxis(2, 20), 2, 0, 100)).toEqual([2, 1])
    expect(visibleRange(axis, 0, 0, 0)).toEqual([0, -1])
  })
})

describe("scrollToShow", () => {
  const axis = makeAxis(100, 20)

  it("scrolls down just far enough", () => {
    expect(scrollToShow(axis, 0, 0, 100, 4)).toBe(0)
    expect(scrollToShow(axis, 0, 0, 100, 5)).toBe(20)
    expect(scrollToShow(axis, 0, 0, 100, 50)).toBe(920)
  })

  it("scrolls back up past the frozen part", () => {
    expect(scrollToShow(axis, 2, 300, 100, 10)).toBe(160)
    expect(scrollToShow(axis, 2, 300, 100, 1)).toBe(300)
  })
})

describe("hitIndex", () => {
  const axis = makeAxis(100, 20)
  it("reads the frozen part without the scroll", () => {
    expect(hitIndex(axis, 2, 500, 10)).toBe(0)
    expect(hitIndex(axis, 2, 500, 39)).toBe(1)
    expect(hitIndex(axis, 2, 500, 40)).toBe(27)
  })
})

describe("column names", () => {
  it("goes A … Z, AA … AZ, BA …", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"])
  })

  it("reads them back", () => {
    for (const index of [0, 5, 25, 26, 199, 701, 702]) expect(columnIndex(columnName(index))).toBe(index)
    expect(columnIndex("gs")).toBe(200)
    expect(columnIndex("A1")).toBe(-1)
    expect(columnIndex("")).toBe(-1)
  })
})
