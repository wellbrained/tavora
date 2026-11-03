// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mountOverlayText, type OverlayTextOptions } from "./overlay-text"
import { offsetAt, scrollTiming } from "./plan"

/** A Web Animation as far as the box uses it: where it is, and whether it runs. */
class FakeAnimation {
  currentTime: number | null = 0
  playing = true
  cancelled = false
  constructor(
    readonly frames: Keyframe[],
    readonly timing: KeyframeAnimationOptions,
  ) {}
  play() {
    this.playing = true
  }
  pause() {
    this.playing = false
  }
  cancel() {
    this.cancelled = true
  }
}

let animations: FakeAnimation[] = []
let reduced = false
let motionListeners: (() => void)[] = []

beforeEach(() => {
  animations = []
  reduced = false
  motionListeners = []
  HTMLElement.prototype.animate = function (frames: Keyframe[], timing: KeyframeAnimationOptions) {
    const animation = new FakeAnimation(frames, timing)
    animations.push(animation)
    return animation as unknown as Animation
  } as HTMLElement["animate"]
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced }, addEventListener: (_: string, fn: () => void) => motionListeners.push(fn), removeEventListener: () => {} }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  // @ts-expect-error put back what jsdom has: no animate
  delete HTMLElement.prototype.animate
  document.body.replaceChildren()
})

/** A box whose size and whose text's size (at 100 %) the test sets. */
function mount(options: Partial<OverlayTextOptions>) {
  const host = document.createElement("div")
  document.body.append(host)
  const sizes = { box: { width: 500, height: 50 }, text: { width: 100, height: 40 } }
  const view = mountOverlayText(host, { fontSize: 40, ...options }, { box: () => sizes.box, content: () => sizes.text })
  const line = (text: string) => Object.assign(document.createElement("div"), { textContent: text })
  const fontPx = () => parseFloat((host.querySelector(".tv-otext__track") as HTMLElement).style.fontSize)
  const live = () => animations.filter((one) => !one.cancelled)
  return { host, view, sizes, line, fontPx, live }
}

describe("OverlayText: grows with the text", () => {
  it("draws the text at its size times the box's scale, by setting the font size (never a stretched picture)", () => {
    const { view, sizes, line, fontPx, host } = mount({ box: "grow", scaleBy: "height" })
    sizes.box = { width: 220, height: 80 }
    view.set([line("Deaths 7")], "deaths")
    expect(view.layout).toEqual({ scale: 2, mode: "static" })
    expect(fontPx()).toBe(80)
    expect(host.querySelector(".tv-otext__track")!.getAttribute("style")).not.toContain("scale")
    expect(host.dataset.mode).toBe("static")
  })

  it("keeps a growing text's scale in a following frame while the text gets longer, and picks the frame up when it grows", () => {
    const { view, sizes, line, fontPx } = mount({ box: "grow", scaleBy: "height" })
    sizes.box = { width: 200, height: 80 }
    view.set([line("9")], "count")
    sizes.text = { width: 130, height: 40 }
    view.set([line("10")], "count")
    expect(fontPx()).toBe(80)
    sizes.box = { width: 260, height: 80 }
    view.fit()
    expect(fontPx()).toBe(80)
  })

  it("changes size with the step and keeps the scale (the frame follows)", () => {
    const { view, sizes, fontPx } = mount({ box: "grow", scaleBy: "height", fontSize: 40 })
    sizes.box = { width: 200, height: 60 }
    view.refresh("x")
    expect(fontPx()).toBe(60)
    // A bigger step: the text is 25 % bigger and the frame, keeping its 1.5 scale, too.
    view.configure({ fontSize: 50 })
    sizes.box = { width: 250, height: 75 }
    sizes.text = { width: 125, height: 50 }
    view.fit()
    expect(view.layout.scale).toBeCloseTo(1.5)
    expect(fontPx()).toBeCloseTo(75)
  })
})

describe("OverlayText: a fixed box", () => {
  it("keeps a short text at its size and alignment, and does not scroll it", () => {
    const { view, line, fontPx, host, live } = mount({ box: "fixed", align: "left" })
    view.set([line("Hi")], "a")
    expect(view.layout).toEqual({ scale: 1, mode: "static" })
    expect(fontPx()).toBe(40)
    expect(host.dataset).toMatchObject({ box: "fixed", align: "left", mode: "static" })
    expect(live()).toHaveLength(0)
  })

  it("scrolls a long text in a loop, with a copy after a gap, a pause at the start of each round and soft edges", () => {
    const { view, sizes, line, host, live } = mount({ box: "fixed", tooLong: "scroll", pause: 2, speed: "normal" })
    sizes.text = { width: 900, height: 40 }
    view.set([line("A very long song title by a band with a long name")], "song-1")
    expect(view.layout.mode).toBe("scroll")
    expect(host.dataset.soft).toBe("true")
    expect(host.querySelector(".tv-otext__copy")!.textContent).toBe("A very long song title by a band with a long name")
    expect(host.querySelector(".tv-otext__copy")!.getAttribute("aria-hidden")).toBe("true")
    const [animation] = live()
    const timing = scrollTiming(900, 40, "normal", 2)
    expect(animation!.timing).toMatchObject({ duration: timing.duration, iterations: Infinity, easing: "linear" })
    // Only the transform moves: the compositor runs it, with no layout per frame.
    expect(animation!.frames.every((frame) => Object.keys(frame).every((key) => key === "transform" || key === "offset"))).toBe(true)
    expect(animation!.frames[1]).toMatchObject({ transform: "translateX(0)", offset: 2000 / timing.duration })
    expect(animation!.frames.at(-1)!.transform).toBe(`translateX(${-timing.distance}px)`)
  })

  it("has hard edges and no pause when they are off", () => {
    const { view, sizes, host, live } = mount({ box: "fixed", softEdges: false, pause: 0 })
    sizes.text = { width: 900, height: 40 }
    view.refresh("x")
    expect(host.dataset.soft).toBe("false")
    expect(live()[0]!.frames).toHaveLength(2)
  })

  it("goes on where it is when a counter ticks, and starts the round again for a new song", () => {
    const { view, sizes, line, live } = mount({ box: "fixed" })
    sizes.text = { width: 900, height: 40 }
    view.set([line("Deaths 99 …")], "deaths")
    live()[0]!.currentTime = 5000
    const moved = offsetAt(5000, scrollTiming(900, 40, "normal", 2))
    // 99 → 100: a little wider, the same thing.
    sizes.text = { width: 920, height: 40 }
    view.set([line("Deaths 100 …")], "deaths")
    const ticked = live()
    expect(ticked).toHaveLength(1)
    expect(offsetAt(ticked[0]!.currentTime!, scrollTiming(920, 40, "normal", 2))).toBeCloseTo(moved)
    // The same width: the animation is left alone.
    view.set([line("Deaths 101 …")], "deaths")
    expect(live()[0]).toBe(ticked[0])
    // A new song: from the start, pause first.
    view.set([line("Another long song title that does not fit")], "song-2")
    expect(live()[0]!.currentTime).toBe(0)
  })

  it("stops cleanly when the text fits again, and starts again from the start when it gets too long", () => {
    const { view, sizes, line, host, live } = mount({ box: "fixed" })
    sizes.text = { width: 900, height: 40 }
    view.set([line("long")], "a")
    expect(live()).toHaveLength(1)
    sizes.text = { width: 100, height: 40 }
    view.set([line("short")], "a")
    expect(live()).toHaveLength(0)
    expect(host.querySelector(".tv-otext__copy")!.childNodes).toHaveLength(0)
    expect(host.dataset).toMatchObject({ mode: "static", soft: "false" })
    sizes.text = { width: 900, height: 40 }
    view.set([line("long again")], "a")
    expect(live()).toHaveLength(1)
    expect(live()[0]!.currentTime).toBe(0)
  })

  it("keeps scrolling at the same place while the box is resized, and stops once the box is big enough", () => {
    const { view, sizes, live } = mount({ box: "fixed" })
    sizes.text = { width: 900, height: 40 }
    view.refresh("a")
    const running = live()[0]!
    running.currentTime = 4000
    sizes.box = { width: 700, height: 50 }
    view.fit()
    expect(live()[0]).toBe(running)
    expect(running.currentTime).toBe(4000)
    sizes.box = { width: 1000, height: 50 }
    view.fit()
    expect(live()).toHaveLength(0)
    expect(view.layout.mode).toBe("static")
  })

  it("shrinks a long text until it fits, never above its size", () => {
    const { view, sizes, fontPx } = mount({ box: "fixed", tooLong: "shrink" })
    sizes.text = { width: 1000, height: 40 }
    view.refresh("a")
    expect(fontPx()).toBe(20)
    sizes.text = { width: 50, height: 40 }
    view.refresh("a")
    expect(fontPx()).toBe(40)
  })

  it("cuts a long text off", () => {
    const { view, sizes, host, live } = mount({ box: "fixed", tooLong: "cut" })
    sizes.text = { width: 900, height: 40 }
    view.refresh("a")
    expect(host.dataset.mode).toBe("cut")
    expect(live()).toHaveLength(0)
  })

  it("cuts off instead of scrolling with reduced motion, and follows the setting when it changes", () => {
    reduced = true
    const { view, sizes, host, live } = mount({ box: "fixed", tooLong: "scroll" })
    sizes.text = { width: 900, height: 40 }
    view.refresh("a")
    expect(host.dataset.mode).toBe("cut")
    expect(live()).toHaveLength(0)
    reduced = false
    motionListeners.forEach((fn) => fn())
    expect(host.dataset.mode).toBe("scroll")
    expect(live()).toHaveLength(1)
  })

  it("stands still while the overlay is hidden or the page is not visible", () => {
    const { view, sizes, live } = mount({ box: "fixed" })
    sizes.text = { width: 900, height: 40 }
    view.refresh("a")
    const animation = live()[0]!
    view.setActive(false)
    expect(animation.playing).toBe(false)
    view.setActive(true)
    expect(animation.playing).toBe(true)
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(animation.playing).toBe(false)
    hidden.mockReturnValue("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(animation.playing).toBe(true)
    // A scroll that starts while hidden waits too.
    view.setActive(false)
    view.set([document.createElement("div")], "b")
    expect(live()[0]!.playing).toBe(false)
  })

  it("lets words and a number at different sizes share one line, measured together", () => {
    const { view, sizes, host } = mount({ box: "fixed" })
    const lineElement = document.createElement("div")
    const words = Object.assign(document.createElement("span"), { textContent: "Deaths " })
    words.style.fontSize = "0.857em"
    const number = Object.assign(document.createElement("span"), { textContent: "7" })
    number.style.fontSize = "1.429em"
    lineElement.append(words, number)
    sizes.text = { width: 900, height: 60 }
    view.set([lineElement], "a")
    const copy = host.querySelector(".tv-otext__copy")!
    expect([...copy.querySelectorAll("span")].map((span) => (span as HTMLElement).style.fontSize)).toEqual(["0.857em", "1.429em"])
  })

  it("forgets its animation and listeners when it is taken down", () => {
    const { view, sizes, live } = mount({ box: "fixed" })
    sizes.text = { width: 900, height: 40 }
    view.refresh("a")
    view.destroy()
    expect(live()).toHaveLength(0)
  })
})
