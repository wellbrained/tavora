// The glide of a jump (Whole map, showing an area, a saved view put back): the view moves there in a moment instead of
// cutting. It keeps the middle of the pane and the zoom moving evenly, so a long way across zooms out and in again
// smoothly. Reduced motion, and any new input, ends it at once.
import { motionDuration, motionEase, reducedMotion } from "../motion/tokens"
import type { Size, ZoomView } from "./view"

/** No glide takes longer than this, whatever the token says. */
export const GLIDE_MAX_MS = 300

/** The view `progress` (0 to 1, already eased) of the way from `from` to `to`: middle point straight, zoom by ratio. */
export function glideAt(from: ZoomView, to: ZoomView, pane: Size, progress: number): ZoomView {
  if (progress >= 1) return to
  if (progress <= 0) return from
  const middle = (view: ZoomView) => ({ x: (pane.width / 2 - view.x) / view.zoom, y: (pane.height / 2 - view.y) / view.zoom })
  const a = middle(from)
  const b = middle(to)
  const zoom = from.zoom * (to.zoom / from.zoom) ** progress
  const x = a.x + (b.x - a.x) * progress
  const y = a.y + (b.y - a.y) * progress
  return { zoom, x: pane.width / 2 - x * zoom, y: pane.height / 2 - y * zoom }
}

/** The easing of a CSS `cubic-bezier(x1, y1, x2, y2)` curve, as a function of progress. Null if `text` is not one. */
export function parseEase(text: string): ((progress: number) => number) | null {
  const match = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(text.trim())
  if (!match) return null
  const [x1, y1, x2, y2] = match.slice(1).map(Number) as [number, number, number, number]
  const axis = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3
  return (progress) => {
    if (progress <= 0) return 0
    if (progress >= 1) return 1
    // Find the curve parameter whose x is `progress` (x rises with it), then read y there.
    let low = 0
    let high = 1
    for (let step = 0; step < 24; step++) {
      const mid = (low + high) / 2
      if (axis(x1, x2, mid) < progress) low = mid
      else high = mid
    }
    return axis(y1, y2, (low + high) / 2)
  }
}

/** Used when the token cannot be read (no styles loaded): a plain ease in and out. */
const smooth = (progress: number) => progress * progress * (3 - 2 * progress)

export interface Glide {
  /** Moves from `from` to `to` over a moment, calling `frame` with each view; the last one is exactly `to`. */
  start(from: ZoomView, to: ZoomView, pane: Size): void
  /** Stops where it is; the next input takes over. */
  cancel(): void
  readonly running: boolean
}

export function createGlide(frame: (view: ZoomView) => void): Glide {
  let handle = 0
  let running = false
  function cancel() {
    if (handle) cancelAnimationFrame(handle)
    handle = 0
    running = false
  }
  function start(from: ZoomView, to: ZoomView, pane: Size) {
    cancel()
    const duration = Math.min(GLIDE_MAX_MS, motionDuration("--duration-move", GLIDE_MAX_MS))
    const same = Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5 && Math.abs(from.zoom - to.zoom) < 1e-4
    if (reducedMotion() || duration <= 0 || same || typeof requestAnimationFrame !== "function") {
      frame(to)
      return
    }
    const ease = parseEase(motionEase("--ease-in-out-strong", "")) ?? smooth
    // Time is the frame's own, so the glide starts at its first frame and never runs ahead of what is drawn.
    let began = -1
    running = true
    const tick = (now: number) => {
      if (began < 0) began = now
      const progress = Math.min(1, Math.max(0, (now - began) / duration))
      frame(glideAt(from, to, pane, ease(progress)))
      if (progress < 1) handle = requestAnimationFrame(tick)
      else cancel()
    }
    handle = requestAnimationFrame(tick)
  }
  return {
    start,
    cancel,
    get running() {
      return running
    },
  }
}
