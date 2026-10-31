import { describe, expect, it } from "vitest"
import { groupFace, groupPins, groupsInView, type MapPin, pinsArea, tileLevel, type TileSource, viewArea, visibleTiles } from "./geometry"

const source: TileSource = { size: 8192, tileSize: 512, maxLevel: 4, url: (z, x, y) => `${z}/${x}-${y}` }
const pane = { width: 800, height: 600 }

describe("tileLevel", () => {
  it("picks the least detailed level that is still sharp", () => {
    expect(tileLevel(512 / 8192, source)).toBe(0)
    expect(tileLevel(0.125, source)).toBe(1)
    expect(tileLevel(0.13, source)).toBe(1) // just past the step: the slack keeps level 1
    expect(tileLevel(0.15, source)).toBe(2)
    expect(tileLevel(1, source)).toBe(4)
  })
  it("loads sharper tiles on a high-density screen", () => {
    expect(tileLevel(0.125, source, 2)).toBe(2)
  })
  it("stays within the levels there are", () => {
    expect(tileLevel(8, source)).toBe(4)
    expect(tileLevel(0.001, { ...source, minLevel: 1 })).toBe(1)
  })
})

describe("visibleTiles", () => {
  it("covers the pane plus a tile around it", () => {
    // Level 2: 4 x 4 tiles of 2048 world pixels. The pane shows x 0..3200, y 0..2400 at zoom 0.25.
    const tiles = visibleTiles({ x: 0, y: 0, zoom: 0.25 }, pane, source, 2)
    expect(tiles.map((tile) => tile.key)).toEqual(["2/0/0", "2/1/0", "2/2/0", "2/0/1", "2/1/1", "2/2/1", "2/0/2", "2/1/2", "2/2/2"])
    expect(tiles[4]).toMatchObject({ left: 2048, top: 2048, size: 2048 })
  })
  it("draws nothing when the world is out of sight", () => {
    expect(visibleTiles({ x: 2000, y: 0, zoom: 0.1 }, pane, source, 1)).toEqual([])
  })
  it("knows the area in view", () => {
    expect(viewArea({ x: -100, y: -50, zoom: 0.5 }, pane)).toEqual({ left: 200, top: 100, right: 1800, bottom: 1300 })
  })
})

const pin = (id: string, x: number, y: number, extra: Partial<MapPin> = {}): MapPin => ({ id, x, y, label: id, ...extra })

describe("groupPins", () => {
  const pins = [pin("a", 10, 10), pin("b", 30, 20), pin("c", 500, 500), pin("d", 12, 12, { kind: "dot" })]

  it("merges pins in the same cell, but never pins with dots", () => {
    const groups = groupPins(pins, 1, { cell: 48 })
    expect(groups.map((group) => group.pins.map((p) => p.id))).toEqual([["a", "b"], ["c"], ["d"]])
    expect(groups[0]).toMatchObject({ x: 20, y: 15, kind: "pin" })
    expect(groups[1]!.id).toBe("pin:c")
  })
  it("merges more when zoomed out", () => {
    expect(groupPins(pins, 0.05, { cell: 48 }).map((group) => group.pins.length)).toEqual([3, 1])
  })
  it("keeps the selected pin and highlighted pins apart", () => {
    const groups = groupPins(pins, 1, { cell: 48, apart: new Set(["a"]) })
    expect(groups.map((group) => group.pins.map((p) => p.id))).toEqual([["a"], ["b"], ["c"], ["d"]])
    const lit = groupPins(pins, 0.05, { cell: 48, highlight: new Set(["c"]) })
    expect(lit.find((group) => group.highlighted)?.pins.map((p) => p.id)).toEqual(["c"])
  })
  it("merges nothing when merging is off", () => {
    expect(groupPins(pins, 0.05, { cell: 48, merge: false })).toHaveLength(4)
  })
  it("keeps groups on screen, and a little outside", () => {
    const groups = groupPins([pin("in", 100, 100), pin("near", 820, 100), pin("far", 2000, 100)], 1, { cell: 48 })
    expect(groupsInView(groups, { x: 0, y: 0, zoom: 1 }, pane).map((group) => group.pins[0]!.id)).toEqual(["in", "near"])
  })
})

describe("groupFace", () => {
  it("shows the picture most pins in the group share", () => {
    const [group] = groupPins([pin("a", 0, 0, { icon: "tower" }), pin("b", 1, 1, { icon: "egg" }), pin("c", 2, 2, { icon: "egg" })], 1, { cell: 48 })
    expect(groupFace(group!).id).toBe("b")
  })
})

describe("pinsArea", () => {
  it("spans the pins, at least the given size", () => {
    expect(pinsArea([pin("a", 100, 100), pin("b", 900, 300)], 100)).toEqual({ x: 100, y: 100, width: 800, height: 200 })
    expect(pinsArea([pin("a", 500, 500)], 200)).toEqual({ x: 400, y: 400, width: 200, height: 200 })
  })
})
