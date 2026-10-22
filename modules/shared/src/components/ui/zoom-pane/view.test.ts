import { describe, expect, it } from "vitest"
import { clampPan, FIT_PADDING, fitView, zoomAt } from "./view"

const limits = { min: 0.25, max: 2 }
const pane = { width: 400, height: 300 }

describe("fitView", () => {
  it("centres small content at 100 %, never enlarging it", () => {
    expect(fitView(pane, { width: 200, height: 100 }, limits, 0.25, "end")).toEqual({ x: 100, y: 100, zoom: 1 })
  })

  it("shrinks big content until it fits inside the padding", () => {
    const view = fitView(pane, { width: 736, height: 100 }, limits, 0.25, "end")
    expect(view.zoom).toBeCloseTo(0.5)
    expect(view.x).toBeCloseTo(FIT_PADDING)
  })

  it("stops at the floor and starts at the side align names", () => {
    const content = { width: 3000, height: 200 }
    const end = fitView(pane, content, limits, 0.6, "end")
    expect(end.zoom).toBe(0.6)
    // The right edge of the content sits at the right padding.
    expect(end.x + content.width * end.zoom).toBeCloseTo(pane.width - FIT_PADDING)
    expect(fitView(pane, content, limits, 0.6, "start").x).toBe(FIT_PADDING)
    expect(fitView(pane, content, limits, 0.6, "center").x).toBeCloseTo((400 - 1800) / 2)
  })

  it("keeps within the zoom limits", () => {
    expect(fitView(pane, { width: 100000, height: 100 }, limits, 0, "center").zoom).toBe(0.25)
  })

  it("shows empty content at 100 %", () => {
    expect(fitView(pane, { width: 0, height: 0 }, limits, 0.6, "end")).toEqual({ x: FIT_PADDING, y: FIT_PADDING, zoom: 1 })
  })
})

describe("zoomAt", () => {
  it("keeps the point under the pointer in place", () => {
    const content = { width: 1000, height: 1000 }
    const view = zoomAt({ x: 0, y: 0, zoom: 1 }, 2, { x: 100, y: 50 }, limits, pane, content)
    expect(view.zoom).toBe(2)
    // Content point (100, 50) still shows at (100, 50).
    expect(view.x + 100 * view.zoom).toBeCloseTo(100)
    expect(view.y + 50 * view.zoom).toBeCloseTo(50)
  })

  it("does not go past the limits", () => {
    const content = { width: 100, height: 100 }
    expect(zoomAt({ x: 0, y: 0, zoom: 1.8 }, 2, { x: 0, y: 0 }, limits, pane, content).zoom).toBe(2)
    expect(zoomAt({ x: 0, y: 0, zoom: 0.3 }, 0.5, { x: 0, y: 0 }, limits, pane, content).zoom).toBe(0.25)
  })
})

describe("clampPan", () => {
  it("lets an edge move at most to the middle of the pane", () => {
    const content = { width: 1000, height: 100 }
    expect(clampPan({ x: 500, y: 0, zoom: 1 }, pane, content).x).toBe(200)
    expect(clampPan({ x: -5000, y: 0, zoom: 1 }, pane, content).x).toBe(200 - 1000)
    expect(clampPan({ x: 0, y: -500, zoom: 1 }, pane, content).y).toBe(150 - 100)
  })
})
