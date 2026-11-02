import { motionDuration, motionEase, reducedMotion } from "../motion/tokens"

// How a row of a vertical list arrives and leaves: it grows in from nothing, or folds to nothing, so the rows around it
// glide instead of jumping. Played with the Web Animations API from the tokens in motion.css; nothing is left on the
// element afterwards, so the resting look is the one the row always had. The height is animated on purpose: the rows
// below have to follow, which is what makes the list move as one.

/** How far a new row drops into place. */
const DROP = 4
/** How far a leaving row shrinks. */
const SHRINK = 0.97

const EDGES = ["paddingTop", "paddingBottom", "marginTop", "marginBottom", "borderTopWidth", "borderBottomWidth"] as const

interface Box {
  height: number
  edges: Record<(typeof EDGES)[number], string>
  minHeight: string
  /** The space the list puts between its rows, which goes with the row. */
  gap: number
}

function measure(element: HTMLElement): Box {
  const style = getComputedStyle(element)
  const rect = element.getBoundingClientRect()
  const parent = element.parentElement && getComputedStyle(element.parentElement)
  const stacked = parent && (parent.display.includes("grid") || (parent.display.includes("flex") && parent.flexDirection.startsWith("column")))
  const gap = stacked ? Number.parseFloat(parent.rowGap) || 0 : 0
  const edges = Object.fromEntries(EDGES.map((edge) => [edge, style[edge]])) as Box["edges"]
  const inner = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0) + (Number.parseFloat(style.borderTopWidth) || 0) + (Number.parseFloat(style.borderBottomWidth) || 0)
  return { height: style.boxSizing === "border-box" ? rect.height : Math.max(0, rect.height - inner), edges, minHeight: style.minHeight, gap }
}

/** The row with nothing left of it: no height, no padding, no border, no margin, and the gap that came with it cancelled. */
function folded(box: Box): Keyframe {
  return {
    height: "0px",
    minHeight: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    marginTop: "0px",
    marginBottom: `${-box.gap}px`,
    borderTopWidth: "0px",
    borderBottomWidth: "0px",
  }
}

function whole(box: Box): Keyframe {
  return { height: `${box.height}px`, minHeight: box.minHeight, ...box.edges }
}

// While a row moves it is cut off above and below its own box (the height it is folding to), but not at its sides, so
// what hangs out of a row to the side (the rail's active pill, a header band with a negative margin) stays whole.
const CLIP = "inset(0 -9999px)"

function run(element: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions, done: () => void) {
  const restore = element.style.clipPath
  element.style.clipPath = CLIP
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    element.style.clipPath = restore
    done()
  }
  const animation = element.animate(frames, options)
  animation.addEventListener("finish", end)
  animation.addEventListener("cancel", end)
}

/** A row on its way out is no longer there for the pointer, the keyboard or a screen reader: a second press cannot reach it. */
function gone(element: HTMLElement) {
  element.style.pointerEvents = "none"
  element.setAttribute("aria-hidden", "true")
  element.inert = true
}

/** A row the user added: grows from nothing, fading in and dropping 4px into place. */
export function enterRow(node: Element, done: () => void): void {
  const element = node as HTMLElement
  if (typeof element.animate !== "function") return done()
  if (reducedMotion()) {
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100 })
    return done()
  }
  const box = measure(element)
  run(
    element,
    [
      { ...folded(box), opacity: 0, transform: `translateY(${-DROP}px)` },
      { ...whole(box), opacity: 1, transform: "none" },
    ],
    { duration: motionDuration("--duration-panel", 250), easing: motionEase("--ease-out-strong", "cubic-bezier(0.23, 1, 0.32, 1)") },
    done,
  )
}

/** A row the user removed: fades, shrinks a little and folds to nothing, so the rows below slide up. */
export function leaveRow(node: Element, done: () => void): void {
  const element = node as HTMLElement
  if (typeof element.animate !== "function") return done()
  gone(element)
  if (reducedMotion()) {
    const fade = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: "forwards" })
    fade.addEventListener("finish", done)
    fade.addEventListener("cancel", done)
    return
  }
  const box = measure(element)
  run(
    element,
    [
      { ...whole(box), opacity: 1, transform: "none" },
      { ...folded(box), opacity: 0, transform: `scale(${SHRINK})` },
    ],
    { duration: motionDuration("--duration-panel", 250), easing: motionEase("--ease-out-strong", "cubic-bezier(0.23, 1, 0.32, 1)"), fill: "forwards" },
    done,
  )
}
