import { describe, expect, it } from "vitest"
import { continueAt, fadeWidth, offsetAt, planOverlayText, sameTiming, SCROLL_GAP, scrollTiming, type PlanOptions } from "./plan"

const grow = (scaleBy: PlanOptions["scaleBy"]): PlanOptions => ({ box: "grow", scaleBy, tooLong: "scroll", reducedMotion: false })
const fixed = (tooLong: PlanOptions["tooLong"], reducedMotion = false): PlanOptions => ({ box: "fixed", scaleBy: "fill", tooLong, reducedMotion })

describe("planOverlayText: a box that grows with the text", () => {
  it("fills its box when nobody keeps the box at the text's size (OBS, an older Tavora)", () => {
    expect(planOverlayText({ width: 100, height: 50 }, { width: 400, height: 100 }, grow("fill"))).toEqual({ scale: 2, mode: "static" })
    expect(planOverlayText({ width: 100, height: 50 }, { width: 150, height: 100 }, grow("fill"))).toEqual({ scale: 1.5, mode: "static" })
  })

  it("takes the scale from the height in a frame that follows the text, so a longer text keeps its size until the frame catches up", () => {
    // A counter went from 9 to 10: the text is wider than the frame for a moment, and still drawn at the frame's scale.
    expect(planOverlayText({ width: 130, height: 50 }, { width: 200, height: 100 }, grow("height"))).toEqual({ scale: 2, mode: "static" })
  })

  it("never draws a preview bigger than 100 %", () => {
    expect(planOverlayText({ width: 100, height: 50 }, { width: 400, height: 400 }, grow("down")).scale).toBe(1)
    expect(planOverlayText({ width: 200, height: 50 }, { width: 100, height: 400 }, grow("down")).scale).toBe(0.5)
  })

  it("keeps 100 % for nothing to measure or no room, instead of NaN or 0", () => {
    expect(planOverlayText({ width: 0, height: 0 }, { width: 100, height: 100 }, grow("fill"))).toEqual({ scale: 1, mode: "static" })
    expect(planOverlayText({ width: 10, height: 10 }, { width: -5, height: 0 }, grow("fill")).scale).toBe(1)
  })
})

describe("planOverlayText: a fixed box", () => {
  const short = { width: 40, height: 50 }
  const long = { width: 900, height: 50 }
  const box = { width: 484, height: 34 }

  it("keeps a short text at its size, never made bigger to fill the box", () => {
    for (const tooLong of ["scroll", "shrink", "cut"] as const) expect(planOverlayText(short, { width: 484, height: 84 }, fixed(tooLong))).toEqual({ scale: 1, mode: "static" })
  })

  it("scrolls only a text that does not fit", () => {
    expect(planOverlayText({ width: 484.4, height: 30 }, box, fixed("scroll"))).toEqual({ scale: 1, mode: "static" })
    expect(planOverlayText(long, box, fixed("scroll"))).toEqual({ scale: 1, mode: "scroll" })
  })

  it("shrinks a long text until it fits, in width and height, and never above its size", () => {
    expect(planOverlayText(long, { width: 450, height: 100 }, fixed("shrink"))).toEqual({ scale: 0.5, mode: "static" })
    expect(planOverlayText({ width: 100, height: 100 }, { width: 400, height: 25 }, fixed("shrink")).scale).toBe(0.25)
  })

  it("cuts a long text off", () => {
    expect(planOverlayText(long, box, fixed("cut"))).toEqual({ scale: 1, mode: "cut" })
  })

  it("cuts off instead of scrolling with reduced motion", () => {
    expect(planOverlayText(long, box, fixed("scroll", true))).toEqual({ scale: 1, mode: "cut" })
    expect(planOverlayText(short, box, fixed("scroll", true)).mode).toBe("static")
  })
})

describe("scroll rounds", () => {
  // A 300 px text at 40 px, normal speed (2 font sizes a second: 80 px/s), with a 2 s pause.
  const timing = scrollTiming(300, 40, "normal", 2)

  it("runs the text and the gap through at the chosen speed, after the pause", () => {
    expect(timing.distance).toBe(300 + SCROLL_GAP * 40)
    expect(timing.velocity).toBeCloseTo(0.08)
    expect(timing.pauseMs).toBe(2000)
    expect(timing.duration).toBeCloseTo(2000 + 380 / 0.08)
    expect(scrollTiming(300, 40, "slow", 0).duration).toBeGreaterThan(scrollTiming(300, 40, "normal", 0).duration)
    expect(scrollTiming(300, 40, "fast", 0).duration).toBeLessThan(scrollTiming(300, 40, "normal", 0).duration)
  })

  it("stands still in the pause, then moves, round after round", () => {
    expect(offsetAt(0, timing)).toBe(0)
    expect(offsetAt(1999, timing)).toBe(0)
    expect(offsetAt(3000, timing)).toBeCloseTo(80)
    expect(offsetAt(timing.duration + 3000, timing)).toBeCloseTo(80)
  })

  it("goes on at the same place when the text changes but is the same thing (a counter that ticks)", () => {
    // 20 → 100: the text gets 20 px wider while it has moved 80 px; it stays at 80 px.
    const wider = scrollTiming(320, 40, "normal", 2)
    const at = continueAt(3000, timing, wider)
    expect(offsetAt(at, wider)).toBeCloseTo(80)
    // In the pause it stays in the pause, at the same moment.
    expect(continueAt(1500, timing, wider)).toBe(1500)
  })

  it("starts the next run when the shorter text has already gone by", () => {
    const shorter = scrollTiming(10, 40, "normal", 2)
    expect(continueAt(2000 + 300 / 0.08, timing, shorter)).toBe(0)
  })

  it("knows a round that did not change", () => {
    expect(sameTiming(timing, scrollTiming(300.2, 40, "normal", 2))).toBe(true)
    expect(sameTiming(timing, scrollTiming(300, 40, "fast", 2))).toBe(false)
    expect(sameTiming(timing, scrollTiming(300, 40, "normal", 0))).toBe(false)
  })

  it("keeps the soft edge to the font size, and narrow in a narrow box", () => {
    expect(fadeWidth(40, 1000)).toBe(40)
    expect(fadeWidth(40, 100)).toBeCloseTo(12)
  })
})
