// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createGlide, GLIDE_MAX_MS, glideAt, parseEase } from "./glide"
import type { ZoomView } from "./view"

const pane = { width: 400, height: 300 }
const from: ZoomView = { x: 0, y: 0, zoom: 1 }
const to: ZoomView = { x: -800, y: -300, zoom: 2 }

describe("glideAt", () => {
  it("starts at the start and ends exactly at the end", () => {
    expect(glideAt(from, to, pane, 0)).toEqual(from)
    expect(glideAt(from, to, pane, 1)).toEqual(to)
  })

  it("moves the middle of the pane straight and the zoom by ratio", () => {
    const halfway = glideAt(from, to, pane, 0.5)
    expect(halfway.zoom).toBeCloseTo(Math.sqrt(2))
    // The middle point goes from (200, 150) to (500, 225): halfway is (350, 187.5).
    expect((pane.width / 2 - halfway.x) / halfway.zoom).toBeCloseTo(350)
    expect((pane.height / 2 - halfway.y) / halfway.zoom).toBeCloseTo(187.5)
  })
})

describe("parseEase", () => {
  it("reads a cubic-bezier token into a curve from 0 to 1", () => {
    const ease = parseEase("cubic-bezier(0.77, 0, 0.175, 1)")!
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    // Ease in and out: slow at the start, even in the middle, quick to settle.
    expect(ease(0.1)).toBeLessThan(0.1)
    expect(ease(0.5)).toBeGreaterThan(0.45)
    expect(ease(0.5)).toBeLessThan(0.75)
    expect(ease(0.9)).toBeGreaterThan(0.9)
  })

  it("gives up on anything else", () => {
    expect(parseEase("")).toBeNull()
    expect(parseEase("ease-in-out")).toBeNull()
  })
})

describe("createGlide", () => {
  let reduced = false
  beforeEach(() => {
    vi.useFakeTimers()
    reduced = false
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("moves over a moment of no more than 300 ms and ends exactly on the target", () => {
    const frames: ZoomView[] = []
    const glide = createGlide((view) => frames.push(view))
    glide.start(from, to, pane)
    expect(glide.running).toBe(true)
    expect(frames).toEqual([])
    vi.advanceTimersByTime(GLIDE_MAX_MS / 2)
    expect(frames.length).toBeGreaterThan(0)
    expect(frames.at(-1)!.zoom).toBeGreaterThan(1)
    expect(frames.at(-1)!.zoom).toBeLessThan(2)
    vi.advanceTimersByTime(GLIDE_MAX_MS)
    expect(frames.at(-1)).toEqual(to)
    expect(glide.running).toBe(false)
  })

  it("jumps at once under reduced motion", () => {
    reduced = true
    const frames: ZoomView[] = []
    const glide = createGlide((view) => frames.push(view))
    glide.start(from, to, pane)
    expect(frames).toEqual([to])
    expect(glide.running).toBe(false)
  })

  it("stops where it is when cancelled", () => {
    const frames: ZoomView[] = []
    const glide = createGlide((view) => frames.push(view))
    glide.start(from, to, pane)
    vi.advanceTimersByTime(60)
    glide.cancel()
    const count = frames.length
    vi.advanceTimersByTime(GLIDE_MAX_MS * 2)
    expect(frames.length).toBe(count)
    expect(frames.at(-1)).not.toEqual(to)
  })
})
