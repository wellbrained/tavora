// The text of an overlay, in its box: one piece for every text shown over a game or on stream (Clock & Counter first).
// It sizes the text the two ways plan.ts describes (the box grows with the text, or the box is fixed and a long text
// scrolls, shrinks or is cut off), and draws it again at the real size, never a stretched picture, so it stays sharp.
//
// Plain DOM and no framework, so an overlay page that OBS loads as a Browser Source can use it as it is; OverlayText.vue
// wraps it for Vue. The caller owns the lines (block elements, sizes in `em`: the box sets the font size, 100 % being
// `fontSize`) and their look (colour, font, outline); this owns the box around them.
//
// The scroll is one Web Animation of `transform`, so it runs on the compositor: no layout and no script per frame. It
// stands still while the page is hidden or the caller says it is not shown (`setActive`), and with reduced motion a text
// that would scroll is cut off instead. It runs for as long as the text is too long: it is content, like the text of a
// news ticker, not motion of the interface.
import "./overlay-text.css"
import {
  continueAt,
  DEFAULT_PAUSE,
  fadeWidth,
  planOverlayText,
  sameTiming,
  scrollTiming,
  type OverlayTextBox,
  type OverlayTextLayout,
  type OverlayTextScaleBy,
  type OverlayTextSpeed,
  type OverlayTextTooLong,
  type ScrollTiming,
  type Size,
} from "./plan"

export type OverlayTextAlign = "left" | "center" | "right"

export type OverlayTextOptions = {
  box: OverlayTextBox
  /** How a growing text finds its scale (plan.ts). */
  scaleBy: OverlayTextScaleBy
  tooLong: OverlayTextTooLong
  speed: OverlayTextSpeed
  /** Seconds at the start of each round; 0 for none. */
  pause: number
  /** A scrolling text fades out at the sides. */
  softEdges: boolean
  align: OverlayTextAlign
  /** The room kept around the text on every side, in pixels (an outline and its shadow are drawn there). */
  padding: number
  /** The font size at 100 %, in pixels. */
  fontSize: number
}

export const DEFAULT_OVERLAY_TEXT: OverlayTextOptions = {
  box: "grow",
  scaleBy: "fill",
  tooLong: "scroll",
  speed: "normal",
  pause: DEFAULT_PAUSE,
  softEdges: true,
  align: "center",
  padding: 0,
  fontSize: 16,
}

export type OverlayTextMeasure = {
  /** The box: the host's inner size. */
  box(host: HTMLElement): Size
  /** The lines at 100 %. */
  content(content: HTMLElement): Size
}

const domMeasure: OverlayTextMeasure = {
  box: (host) => ({ width: host.clientWidth, height: host.clientHeight }),
  content: (content) => {
    const rect = content.getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  },
}

export type OverlayText = {
  /** The element the caller puts its lines in (or changes them in), then calls `refresh`. */
  readonly content: HTMLElement
  /** What it shows now. */
  readonly layout: OverlayTextLayout
  /** Puts in new lines; see `refresh` for `key`. */
  set(lines: Node[], key?: string): void
  /**
   * The lines changed: measures them again. `key` names what they show. The same key keeps a running scroll where it is
   * (a counter that ticks, a clock), another one starts the round again (a new song). Left out, the key stays.
   */
  refresh(key?: string): void
  /** Changes options and fits again. */
  configure(options: Partial<OverlayTextOptions>): void
  /** Fits again, after the box or the fonts changed. */
  fit(): void
  /** While false the scroll stands still (the overlay is hidden). */
  setActive(active: boolean): void
  destroy(): void
}

const element = (className: string) => Object.assign(document.createElement("div"), { className })
const prefersLessMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** Turns `host` into an overlay text box. The host is the box: give it its size (a frame's window, a preview). */
export function mountOverlayText(host: HTMLElement, initial: Partial<OverlayTextOptions> = {}, measure: OverlayTextMeasure = domMeasure): OverlayText {
  let options: OverlayTextOptions = { ...DEFAULT_OVERLAY_TEXT, ...initial }
  host.classList.add("tv-otext")
  const clip = element("tv-otext__clip")
  const track = element("tv-otext__track")
  const content = element("tv-otext__content")
  // The second copy follows the first while it scrolls, so the loop has no hole; it is never read out.
  const copy = element("tv-otext__copy")
  copy.setAttribute("aria-hidden", "true")
  track.append(content, copy)
  clip.append(track)
  host.replaceChildren(clip)

  let layout: OverlayTextLayout = { scale: 1, mode: "static" }
  let key = ""
  let active = true
  let animation: Animation | null = null
  let timing: ScrollTiming | null = null

  const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null
  const onMotion = () => fit()
  media?.addEventListener?.("change", onMotion)
  const onVisibility = () => play()
  document.addEventListener("visibilitychange", onVisibility)

  const running = () => active && document.visibilityState !== "hidden"

  function play(): void {
    if (!animation) return
    if (running()) animation.play()
    else animation.pause()
  }

  function stopScroll(): void {
    animation?.cancel()
    animation = null
    timing = null
    copy.replaceChildren()
  }

  /** Starts the round, or keeps a running one going at the same place when only the text changed (`restart` false). */
  function scroll(width: number, fontPx: number, restart: boolean): void {
    copy.replaceChildren(...Array.from(content.childNodes, (node) => node.cloneNode(true)))
    const next = scrollTiming(width, fontPx, options.speed, options.pause)
    if (animation && timing && !restart && sameTiming(timing, next)) return
    const at = animation && timing && !restart ? continueAt(Number(animation.currentTime ?? 0), timing, next) : 0
    animation?.cancel()
    timing = next
    animation = null
    if (typeof track.animate !== "function") return
    const away = `translateX(${-next.distance}px)`
    const frames: Keyframe[] = next.pauseMs > 0 ? [{ transform: "translateX(0)" }, { transform: "translateX(0)", offset: next.pauseMs / next.duration }, { transform: away }] : [{ transform: "translateX(0)" }, { transform: away }]
    animation = track.animate(frames, { duration: next.duration, iterations: Infinity, easing: "linear" })
    animation.currentTime = at
    play()
  }

  function fit(restart = false): void {
    // Measured at 100 % and with nothing cut off: the lines' own size.
    host.dataset.mode = "measure"
    track.style.fontSize = `${options.fontSize}px`
    const natural = measure.content(content)
    const box = measure.box(host)
    const room = { width: box.width - 2 * options.padding, height: box.height - 2 * options.padding }
    layout = planOverlayText(natural, room, { box: options.box, scaleBy: options.scaleBy, tooLong: options.tooLong, reducedMotion: prefersLessMotion() })
    const fontPx = options.fontSize * layout.scale
    track.style.fontSize = `${fontPx}px`
    host.dataset.mode = layout.mode
    const fade = options.softEdges && layout.mode === "scroll" ? fadeWidth(fontPx, room.width) : 0
    host.dataset.soft = String(fade > 0)
    host.style.setProperty("--tv-otext-fade", `${fade}px`)
    if (layout.mode === "scroll") scroll(natural.width * layout.scale, fontPx, restart)
    else stopScroll()
  }

  function refresh(next?: string): void {
    const restart = next !== undefined && next !== key
    if (next !== undefined) key = next
    fit(restart)
  }

  function configure(change: Partial<OverlayTextOptions>): void {
    options = { ...options, ...change }
    host.dataset.box = options.box
    host.dataset.align = options.align
    host.style.setProperty("--tv-otext-pad", `${options.padding}px`)
    fit()
  }

  configure({})

  return {
    content,
    get layout() {
      return layout
    },
    set(lines, next) {
      content.replaceChildren(...lines)
      refresh(next)
    },
    refresh,
    configure,
    fit: () => fit(),
    setActive(next) {
      active = next
      play()
    },
    destroy() {
      stopScroll()
      media?.removeEventListener?.("change", onMotion)
      document.removeEventListener("visibilitychange", onVisibility)
    },
  }
}
