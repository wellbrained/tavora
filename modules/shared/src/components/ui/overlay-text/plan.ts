// The sums behind OverlayText, without the page: how big the text is drawn in its box, whether it scrolls, and where a
// scroll is at any moment. Plain functions of numbers, so every case is tested without a browser.

/**
 * How the box is sized, as in OBS. `grow`: the box is as big as the text, times a scale (in Tavora's frames the host keeps
 * it so while the user drags a corner). `fixed`: the user sets the box; the text keeps its size and `tooLong` says what
 * happens when it doesn't fit.
 */
export const OVERLAY_TEXT_BOXES = ["grow", "fixed"] as const
export type OverlayTextBox = (typeof OVERLAY_TEXT_BOXES)[number]

/** What a text too long for a fixed box does: runs through in a loop, gets smaller until it fits, or ends with "…". */
export const OVERLAY_TEXT_TOO_LONG = ["scroll", "shrink", "cut"] as const
export type OverlayTextTooLong = (typeof OVERLAY_TEXT_TOO_LONG)[number]

export const OVERLAY_TEXT_SPEEDS = ["slow", "normal", "fast"] as const
export type OverlayTextSpeed = (typeof OVERLAY_TEXT_SPEEDS)[number]

/**
 * How a growing text finds its scale from its box. `fill`: the whole text fits the box (OBS, an older Tavora, any box
 * nobody keeps at the text's size). `height`: from the height alone, so a text that gets longer keeps its size while
 * the frame catches up (a Tavora frame that follows the text). `down`: like fill, but never bigger than 100 % (a preview).
 */
export type OverlayTextScaleBy = "fill" | "height" | "down"

/** How fast a text scrolls, in its own font size per second. */
export const SCROLL_SPEED: Record<OverlayTextSpeed, number> = { slow: 1, normal: 2, fast: 3.5 }

/** The pause at the start of each round, in seconds: 0 for none, or 0.5 to 5 in half seconds. */
export const OVERLAY_TEXT_PAUSES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const
export const DEFAULT_PAUSE = 2

/** The room between the end of a scrolling text and its start coming round again, in its font size. */
export const SCROLL_GAP = 2

/** How far over the room a text may be and still count as fitting, in pixels (rounding of the layout). */
const SLACK = 0.5

export type Size = { width: number; height: number }

/** What the box shows: the text at `scale` times its size, standing still, scrolling, or cut off with "…". */
export type OverlayTextLayout = { scale: number; mode: "static" | "scroll" | "cut" }

export type PlanOptions = {
  box: OverlayTextBox
  scaleBy: OverlayTextScaleBy
  tooLong: OverlayTextTooLong
  /** The user asked for less motion: a text that would scroll is cut off instead. */
  reducedMotion: boolean
}

const finite = (value: number, fallback: number) => (Number.isFinite(value) && value > 0 ? value : fallback)

/** How the text at its `natural` size (100 %) is shown in `room` (the box less the room kept around the text). */
export function planOverlayText(natural: Size, room: Size, options: PlanOptions): OverlayTextLayout {
  if (!(natural.width > 0) || !(natural.height > 0)) return { scale: 1, mode: "static" }
  const width = Math.max(room.width, 0)
  const height = Math.max(room.height, 0)
  const fill = Math.min(width / natural.width, height / natural.height)
  if (options.box === "grow") {
    if (options.scaleBy === "height") return { scale: finite(height / natural.height, 1), mode: "static" }
    if (options.scaleBy === "down") return { scale: finite(Math.min(1, fill), 1), mode: "static" }
    return { scale: finite(fill, 1), mode: "static" }
  }
  if (options.tooLong === "shrink") return { scale: finite(Math.min(1, fill), 1), mode: "static" }
  if (natural.width <= width + SLACK) return { scale: 1, mode: "static" }
  return { scale: 1, mode: options.tooLong === "scroll" && !options.reducedMotion ? "scroll" : "cut" }
}

/** One round of a scroll: the pause, then the text moves by `distance` pixels until its copy stands where it started. */
export type ScrollTiming = {
  /** Pixels per round: the text's width and the gap. */
  distance: number
  /** Pixels per millisecond. */
  velocity: number
  pauseMs: number
  /** The whole round, pause included, in milliseconds. */
  duration: number
}

/** The round of a text `width` pixels wide drawn at `fontPx`. */
export function scrollTiming(width: number, fontPx: number, speed: OverlayTextSpeed, pause: number): ScrollTiming {
  const distance = Math.max(width, 1) + SCROLL_GAP * fontPx
  const velocity = (SCROLL_SPEED[speed] * fontPx) / 1000
  const pauseMs = Math.max(0, pause) * 1000
  return { distance, velocity, pauseMs, duration: pauseMs + distance / velocity }
}

/** How far the text has moved `time` milliseconds after a round began (any number of rounds). */
export function offsetAt(time: number, timing: ScrollTiming): number {
  const into = ((time % timing.duration) + timing.duration) % timing.duration
  return into <= timing.pauseMs ? 0 : Math.min(timing.distance, (into - timing.pauseMs) * timing.velocity)
}

/**
 * Where a scroll goes on when its text changes but is the same thing (a counter that ticks, a clock): the time in the
 * new round that shows the text moved as far as it was, so nothing jumps back to the start. Still in the pause, it
 * stays in the pause; moved past the new end, it goes on from the start of the next run.
 */
export function continueAt(time: number, before: ScrollTiming, after: ScrollTiming): number {
  const into = ((time % before.duration) + before.duration) % before.duration
  if (into <= before.pauseMs) return Math.min(into, after.pauseMs)
  const offset = offsetAt(time, before)
  if (offset >= after.distance) return 0
  return after.pauseMs + offset / after.velocity
}

/** Whether two rounds are the same, so a running scroll needs nothing new. */
export const sameTiming = (a: ScrollTiming, b: ScrollTiming): boolean =>
  Math.abs(a.distance - b.distance) < 0.5 && Math.abs(a.velocity - b.velocity) < 1e-9 && a.pauseMs === b.pauseMs

/** The soft edge of a scrolling text, in pixels: its font size, but at most 12 % of the room, so a narrow box still shows text. */
export const fadeWidth = (fontPx: number, roomWidth: number): number => Math.max(0, Math.min(fontPx, roomWidth * 0.12))
