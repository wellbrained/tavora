// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue"
import { SAVE_DELAY_MS, setViewMemoryStore, type ViewStore } from "./view-memory"
import { TOOLTIP_GAP } from "../../tooltip"
import { ZoomPane, ZoomTip, useZoomTip } from "."
import type { Size, ZoomView } from "./view"

// The pane measures itself with a ResizeObserver and the sizes of its elements; jsdom has neither, so both are made up:
// a pane of 400 x 300 and (for a pane that moves its content) content of 1000 x 1000.
const PANE: Size = { width: 400, height: 300 }
/** The size the pane has right now; a test changes it and calls resize(). */
const box: Size = { ...PANE }
const observers = new Set<() => void>()
/** Gives the pane a new box (0 x 0 = display: none) and lets its ResizeObserver fire. */
function resize(width: number, height: number) {
  box.width = width
  box.height = height
  for (const callback of observers) callback()
}
const WORLD: Size = { width: 1000, height: 1000 }

let app: App | undefined
let reduced = false
/** The clock the pane reads for "just moved": a double-click soon after the view moved is not a zoom. */
let clock = 1e9
const later = (ms = 1000) => void (clock += ms)
beforeEach(() => {
  clock = 1e9
  vi.spyOn(performance, "now").mockImplementation(() => clock)
  // Not the clock itself: Vue ignores a click whose time is before its handler was attached, and a faked clock says so.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] })
  reduced = false
  box.width = PANE.width
  box.height = PANE.height
  observers.clear()
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }))
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe() {
      observers.add(this.callback)
      this.callback()
    }
    disconnect() {}
  })
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => box.width })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => box.height })
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => WORLD.width })
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => WORLD.height })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  setViewMemoryStore(undefined)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

type PaneApi = {
  view: ZoomView
  zoom: number
  percent: number
  fit: (options?: { glide?: boolean }) => void
  setView: (view: ZoomView, options?: { glide?: boolean }) => void
  showArea: (area: { x: number, y: number, width: number, height: number }, options?: { glide?: boolean }) => void
}

function mount(props: Record<string, unknown> = {}, slots: Record<string, (props: any) => unknown> = {}) {
  const views: Array<{ view: ZoomView, pane: Size }> = []
  let api!: PaneApi
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({
    render: () => h(ZoomPane, {
      ref: (instance: unknown) => (api = instance as PaneApi),
      viewOnly: true,
      world: WORLD,
      minZoom: 0.1,
      maxZoom: 4,
      onViewChange: (view: ZoomView, pane: Size) => views.push({ view, pane }),
      ...props,
    }, slots),
  }))
  app.mount(root)
  const pane = root.querySelector("[data-slot=zoom-pane]") as HTMLElement
  const button = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement
  return { root, pane, views, api: () => api, button, last: () => views.at(-1)! }
}

const flush = async () => {
  for (let step = 0; step < 5; step++) await nextTick()
}

describe("ZoomPane in view-only mode", () => {
  it("does everything but moves nothing: the content is not transformed, the view is sent out", async () => {
    const { root, last } = mount({}, { default: () => h("canvas", { "data-testid": "canvas" }) })
    await flush()
    expect(root.querySelector("[data-testid=canvas]")).not.toBeNull()
    const content = root.querySelector("[data-slot=zoom-pane-content]") as HTMLElement
    expect(content.style.transform).toBe("")
    expect(last().pane).toEqual(PANE)
    // Fitted: the whole 1000 x 1000 world in 400 x 300, as big as it goes without leaving the pane.
    expect(last().view.zoom).toBeCloseTo(0.268, 2)
  })

  it("gives the content the view and the pane's size to draw with", async () => {
    let seen: { view: ZoomView, pane: Size } | undefined
    mount({}, { default: (props: { view: ZoomView, pane: Size }) => ((seen = props), h("span")) })
    await flush()
    expect(seen?.pane).toEqual(PANE)
    expect(seen?.view.zoom).toBeGreaterThan(0)
  })

  it("sends the new view when the user pans, zooms and the pane takes a key", async () => {
    const { pane, views, api } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    const before = views.length
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    await flush()
    expect(views.length).toBeGreaterThan(before)
    expect(views.at(-1)!.view.x).toBe(48)
  })
})

describe("100 %", () => {
  it("counts the % and the steps from `hundred`", async () => {
    const { button, api } = mount({ hundred: 0.5 })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 0.5 })
    await flush()
    expect(button("zoom-percent").textContent?.trim()).toBe("100%")
    button("zoom-in").click()
    await flush()
    expect(api().zoom).toBeCloseTo(0.625)
    expect(button("zoom-percent").textContent?.trim()).toBe("125%")
    button("zoom-out").click()
    button("zoom-out").click()
    await flush()
    expect(api().zoom).toBeCloseTo(0.4)
    expect(button("zoom-percent").textContent?.trim()).toBe("80%")
  })

  it("goes back to 100 % on a click on the %", async () => {
    const { button, api } = mount({ hundred: 0.5 })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 2 })
    await flush()
    expect(button("zoom-percent").textContent?.trim()).toBe("400%")
    button("zoom-percent").click()
    await flush()
    expect(api().zoom).toBeCloseTo(0.5)
    expect(button("zoom-percent").textContent?.trim()).toBe("100%")
  })
})

describe("controls", () => {
  it("are one group: out, %, in, a divider, whole map, then the game's own buttons", async () => {
    const { root } = mount({}, { extras: () => h("button", { "data-testid": "fit-build" }, "Fit build") })
    await flush()
    const group = root.querySelector("[data-slot=zoom-controls]")!
    const order = [...group.children].map((child) => child.getAttribute("data-testid") ?? child.getAttribute("data-slot"))
    expect(order).toEqual(["zoom-out", "zoom-percent", "zoom-in", "separator", "zoom-whole", "fit-build"])
  })

  it("say what the whole map button does, in the caller's words if given", async () => {
    expect(mount().button("zoom-whole").getAttribute("aria-label")).toBe("Show the whole map")
    app?.unmount()
    document.body.innerHTML = ""
    expect(mount({ wholeLabel: "Show the whole tree" }).button("zoom-whole").getAttribute("aria-label")).toBe("Show the whole tree")
  })
})

describe("double-click", () => {
  const dblclick = (target: Element, at: { x: number, y: number }) =>
    target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: at.x, clientY: at.y }))

  it("zooms one step in toward the point, keeping it under the pointer", async () => {
    const { pane, api } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    later()
    dblclick(pane, { x: 100, y: 50 })
    await flush()
    expect(api().zoom).toBeCloseTo(1.25)
    // The content point that was under (100, 50) still is.
    expect(api().view.x + 100 * 1.25).toBeCloseTo(100)
    expect(api().view.y + 50 * 1.25).toBeCloseTo(50)
  })

  it("does nothing when switched off, or on a button", async () => {
    const off = mount({ doubleClick: "off" })
    await flush()
    off.api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    later()
    dblclick(off.pane, { x: 100, y: 50 })
    expect(off.api().zoom).toBe(1)
    app?.unmount()
    document.body.innerHTML = ""

    const on = mount({}, { default: () => h("button", { "data-testid": "node" }, "Node") })
    await flush()
    on.api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    later()
    dblclick(on.root.querySelector("[data-testid=node]")!, { x: 100, y: 50 })
    expect(on.api().zoom).toBe(1)
  })
})

describe("gliding", () => {
  const area = { x: 600, y: 600, width: 100, height: 100 }

  it("moves over a moment, then ends exactly on the view", async () => {
    const { api } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    api().showArea(area)
    // Not there yet: it glides.
    expect(api().zoom).toBe(1)
    vi.advanceTimersByTime(150)
    await flush()
    expect(api().zoom).not.toBe(1)
    vi.advanceTimersByTime(300)
    await flush()
    // 100 x 100 with 24 px around it in 400 x 300 fills the height: 252 / 100 = 2.52.
    expect(api().zoom).toBeCloseTo(2.52)
  })

  it("jumps at once under reduced motion", async () => {
    reduced = true
    const { api } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    api().showArea(area)
    expect(api().zoom).toBeCloseTo(2.52)
  })

  it("is what the whole map button does, but not the call from code or the 0 key", async () => {
    const { api, button, pane } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 2 })
    await flush()
    button("zoom-whole").click()
    expect(api().zoom).toBe(2)
    vi.advanceTimersByTime(400)
    await flush()
    expect(api().zoom).toBeCloseTo(0.268, 2)

    api().setView({ x: 0, y: 0, zoom: 2 })
    await flush()
    api().fit()
    expect(api().zoom).toBeCloseTo(0.268, 2)
    api().setView({ x: 0, y: 0, zoom: 2 })
    await flush()
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }))
    expect(api().zoom).toBeCloseTo(0.268, 2)
  })

  it("does not glide to a view that comes back from storage", async () => {
    setViewMemoryStore(fakeStore({ x: 500, y: 400, zoom: 2 }).store)
    const { api } = mount({ persistKey: "map" })
    await flush()
    // At once, with no time passed.
    expect(api().zoom).toBe(2)
  })

  it("is stopped by the user taking over", async () => {
    const { api, pane } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    api().showArea(area)
    vi.advanceTimersByTime(100)
    await flush()
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    const stopped = api().zoom
    vi.advanceTimersByTime(500)
    await flush()
    expect(api().zoom).toBe(stopped)
  })
})

function fakeStore(initial?: unknown) {
  const store: ViewStore & { get: ReturnType<typeof vi.fn>, set: ReturnType<typeof vi.fn> } = {
    get: vi.fn(async () => initial ?? null),
    set: vi.fn(async () => undefined),
  }
  return { store }
}

describe("persistKey", () => {
  it("opens on the saved view, keeping the content hidden until it is in", async () => {
    const { store } = fakeStore({ x: 500, y: 400, zoom: 2 })
    setViewMemoryStore(store)
    const { api, root } = mount({ persistKey: "map" })
    const content = root.querySelector("[data-slot=zoom-pane-content]") as HTMLElement
    expect(content.classList.contains("invisible")).toBe(true)
    await flush()
    expect(content.classList.contains("invisible")).toBe(false)
    expect(store.get).toHaveBeenCalledWith("zoom-view:map")
    expect(api().zoom).toBe(2)
    // Its middle point is the one that was saved: (500, 400) at the middle of the 400 x 300 pane.
    expect(api().view.x).toBeCloseTo(200 - 500 * 2)
    expect(api().view.y).toBeCloseTo(150 - 400 * 2)
  })

  it("opens on the whole content when nothing is saved, and does not save that", async () => {
    const { store } = fakeStore()
    setViewMemoryStore(store)
    const { api } = mount({ persistKey: "map" })
    await flush()
    expect(api().zoom).toBeCloseTo(0.268, 2)
    vi.advanceTimersByTime(SAVE_DELAY_MS * 2)
    expect(store.set).not.toHaveBeenCalled()
  })

  it("does not wait for a store that does not answer", async () => {
    setViewMemoryStore({ get: () => new Promise(() => undefined), set: async () => undefined })
    const { root } = mount({ persistKey: "map" })
    vi.advanceTimersByTime(2000)
    await flush()
    const content = root.querySelector("[data-slot=zoom-pane-content]") as HTMLElement
    expect(content.classList.contains("invisible")).toBe(false)
  })

  it("saves the middle point and the zoom after the view has been still, one write for a run of moves", async () => {
    const { store } = fakeStore()
    setViewMemoryStore(store)
    const { api, pane } = mount({ persistKey: "map" })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    store.set.mockClear()
    for (let press = 0; press < 3; press++) pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    vi.advanceTimersByTime(SAVE_DELAY_MS - 50)
    expect(store.set).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(store.set).toHaveBeenCalledTimes(1)
    // Three presses of 48 px to the right of where it was: the middle point is at (200 - 144, 150) at zoom 1.
    expect(store.set).toHaveBeenCalledWith("zoom-view:map", { x: 200 - 144, y: 150, zoom: 1 })
  })

  it("writes a waiting view when the pane goes away", async () => {
    const { store } = fakeStore()
    setViewMemoryStore(store)
    const { api, pane } = mount({ persistKey: "map" })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    store.set.mockClear()
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    app?.unmount()
    app = undefined
    await flush()
    expect(store.set).toHaveBeenCalledTimes(1)
  })

  it("does nothing without a persistKey", async () => {
    const { store } = fakeStore()
    setViewMemoryStore(store)
    const { pane } = mount()
    await flush()
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    vi.advanceTimersByTime(SAVE_DELAY_MS * 2)
    expect(store.get).not.toHaveBeenCalled()
    expect(store.set).not.toHaveBeenCalled()
  })
})

describe("ZoomTip", () => {
  const tooltip = () => document.querySelector("[role=tooltip]") as HTMLElement | null

  function mountTip(rect: { left: number, top: number, width: number, height: number } | null) {
    // The pane sits at (100, 200) on the screen.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 100, top: 200, right: 500, bottom: 500, width: 400, height: 300, x: 100, y: 200, toJSON() {} } as DOMRect)
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp(defineComponent({
      render: () => h(ZoomPane, { viewOnly: true, world: WORLD }, { default: () => h(ZoomTip, { rect, title: "Iron Gear", description: "3 / min" }, () => h("i", { "data-testid": "custom" })) }),
    }))
    app.mount(root)
  }

  it("shows nothing without a box", async () => {
    mountTip(null)
    await flush()
    expect(tooltip()).toBeNull()
  })

  it("opens beside the box, below it with a gap, never on it, and holds the game's own content", async () => {
    mountTip({ left: 10, top: 20, width: 30, height: 40 })
    await flush()
    const tip = tooltip()!
    expect(tip).not.toBeNull()
    expect(tip.textContent).toContain("Iron Gear")
    expect(tip.querySelector("[data-testid=custom]")).not.toBeNull()
    // The box is at (110, 220) to (140, 260) on the screen: the card starts under it, past the gap.
    expect(tip.getAttribute("data-side")).toBe("bottom")
    expect(Number.parseFloat(tip.style.top)).toBe(260 + TOOLTIP_GAP)
  })
})

describe("useZoomTip", () => {
  const rect = { left: 1, top: 2, width: 3, height: 4 }
  // A tooltip that closed a moment ago makes the next come at once; none has closed lately.
  beforeEach(() => void (clock = 2e9))
  // A tooltip that closed a moment ago makes the next come at once; no tooltip has closed lately.

  it("shows the tip after the hover wait, with its content, and hides it", () => {
    const { tip, show, hide } = useZoomTip({ delay: 400 })
    show(rect, { title: "Node", description: "A node" })
    expect(tip.rect).toBeNull()
    vi.advanceTimersByTime(399)
    expect(tip.rect).toBeNull()
    vi.advanceTimersByTime(2)
    expect(tip.rect).toEqual(rect)
    expect(tip.title).toBe("Node")
    hide()
    expect(tip.rect).toBeNull()
  })

  it("follows at once from one thing to the next, and a hide cancels one that is waiting", () => {
    const { tip, show, hide } = useZoomTip({ delay: 400 })
    show(rect, { title: "A" })
    vi.advanceTimersByTime(500)
    show({ ...rect, left: 50 }, { title: "B" })
    expect(tip.rect?.left).toBe(50)
    expect(tip.title).toBe("B")
    hide()
    // The warm window of the kit's tooltips is over by now: the next one waits again, and a hide cancels it.
    vi.advanceTimersByTime(1000)
    show(rect, { title: "C" })
    hide()
    vi.advanceTimersByTime(1000)
    expect(tip.rect).toBeNull()
  })
})

// ── Review fixes ──

const wheel = (target: Element, deltaY = -100) => target.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY }))
const press = (target: Element, type: "pointerdown" | "pointermove" | "pointerup", at = { x: 0, y: 0 }) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y, button: 0 }))
const dblclickAt = (target: Element, at = { x: 100, y: 50 }) => target.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: at.x, clientY: at.y }))
const AREA = { x: 600, y: 600, width: 100, height: 100 }

/** A pane whose props can change while it is mounted. */
function mountLive(initial: Record<string, unknown>) {
  const props = reactive({ viewOnly: true, world: WORLD, minZoom: 0.1, maxZoom: 4, ...initial } as Record<string, unknown>)
  let api!: PaneApi
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp(defineComponent({ render: () => h(ZoomPane, { ref: (instance: unknown) => (api = instance as PaneApi), ...props }) }))
  app.mount(root)
  return { props, api: () => api, pane: root.querySelector("[data-slot=zoom-pane]") as HTMLElement, root, button: (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement }
}

describe("a glide is stopped by the user", () => {
  it("by the wheel, and stays where it was stopped", async () => {
    const { api, pane } = mount({ wheel: "zoom" })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    api().showArea(AREA)
    vi.advanceTimersByTime(100)
    wheel(pane)
    await flush()
    const stopped = api().zoom
    vi.advanceTimersByTime(600)
    await flush()
    expect(api().zoom).toBe(stopped)
    expect(stopped).not.toBeCloseTo(2.52)
  })

  it("by a drag of the pointer, but not by a plain press", async () => {
    const { api, pane } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    api().showArea(AREA)
    vi.advanceTimersByTime(100)
    await flush()
    // A press alone (the first half of a double-click) lets it go on.
    press(pane, "pointerdown", { x: 100, y: 100 })
    press(pane, "pointerup", { x: 100, y: 100 })
    vi.advanceTimersByTime(50)
    await flush()
    const going = api().zoom
    // A drag takes over where the view is and stops it.
    press(pane, "pointerdown", { x: 100, y: 100 })
    press(pane, "pointermove", { x: 140, y: 100 })
    const mid = api().zoom
    vi.advanceTimersByTime(600)
    await flush()
    expect(api().zoom).toBe(mid)
    expect(mid).toBeGreaterThan(1)
    expect(going).toBeLessThan(2.52)
  })

  it("and the view that is remembered is the one where it stopped, not the target", async () => {
    const { store } = fakeStore()
    setViewMemoryStore(store)
    const { api, pane } = mount({ persistKey: "map", wheel: "zoom" })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    store.set.mockClear()
    api().showArea(AREA)
    vi.advanceTimersByTime(100)
    wheel(pane, 0)
    await flush()
    const stopped = api().view
    vi.advanceTimersByTime(SAVE_DELAY_MS + 50)
    expect(store.set).toHaveBeenCalledTimes(1)
    const saved = store.set.mock.calls[0]![1] as { x: number, y: number, zoom: number }
    expect(saved.zoom).toBeCloseTo(stopped.zoom)
    expect(saved.zoom).not.toBeCloseTo(2.52)
    expect(saved.x).toBeCloseTo((PANE.width / 2 - stopped.x) / stopped.zoom)
  })

  it("and a glide that gets there is remembered once it has", async () => {
    const { store } = fakeStore()
    setViewMemoryStore(store)
    const { api } = mount({ persistKey: "map" })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    store.set.mockClear()
    api().showArea(AREA)
    vi.advanceTimersByTime(400 + SAVE_DELAY_MS)
    expect(store.set).toHaveBeenCalledTimes(1)
    expect((store.set.mock.calls[0]![1] as { zoom: number }).zoom).toBeCloseTo(2.52)
  })
})

describe("persistKey changing", () => {
  it("puts back the view of the new key, and writes what was waiting under the old one", async () => {
    const views: Record<string, unknown> = { "zoom-view:a": { x: 500, y: 400, zoom: 2 }, "zoom-view:b": { x: 300, y: 200, zoom: 1 } }
    const store = { get: vi.fn(async (key: string) => views[key] ?? null), set: vi.fn(async () => undefined) }
    setViewMemoryStore(store)
    const { api, props, pane } = mountLive({ persistKey: "a" })
    await flush()
    expect(api().zoom).toBe(2)
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    props.persistKey = "b"
    await flush()
    expect(store.set).toHaveBeenCalledWith("zoom-view:a", expect.objectContaining({ zoom: 2 }))
    expect(api().zoom).toBe(1)
    expect(api().view.x).toBeCloseTo(200 - 300)
    expect(api().view.y).toBeCloseTo(150 - 200)
  })

  it("shows the whole content for a new key with nothing saved", async () => {
    setViewMemoryStore({ get: async (key: string) => (key === "zoom-view:a" ? { x: 500, y: 400, zoom: 2 } : null), set: async () => undefined })
    const { api, props } = mountLive({ persistKey: "a" })
    await flush()
    expect(api().zoom).toBe(2)
    props.persistKey = "b"
    await flush()
    expect(api().zoom).toBeCloseTo(0.268, 2)
  })
})

describe("a saved view and a parent that sets one", () => {
  /** A store whose answer comes when the test says. */
  function slowStore(saved: unknown) {
    let answer!: (value: unknown) => void
    const store = { get: vi.fn(() => new Promise<unknown>((resolve) => (answer = resolve))), set: vi.fn(async () => undefined) }
    return { store, answer: () => answer(saved) }
  }

  it("what the parent asks for before the saved view comes back wins, and is what gets remembered", async () => {
    const { store, answer } = slowStore({ x: 500, y: 400, zoom: 2 })
    setViewMemoryStore(store)
    const { api } = mount({ persistKey: "map" })
    await flush()
    api().setView({ x: -10, y: -20, zoom: 1.5 })
    answer()
    await flush()
    expect(api().zoom).toBe(1.5)
    expect(api().view.x).toBeCloseTo(-10)
    vi.advanceTimersByTime(SAVE_DELAY_MS + 50)
    expect(store.set).toHaveBeenCalledWith("zoom-view:map", { x: (200 + 10) / 1.5, y: (150 + 20) / 1.5, zoom: 1.5 })
  })

  it("also when it is showArea, and the content is shown when the saved view is given up on", async () => {
    const { store, answer } = slowStore({ x: 500, y: 400, zoom: 2 })
    setViewMemoryStore(store)
    const { api, root } = mount({ persistKey: "map" })
    await flush()
    api().showArea(AREA)
    answer()
    await flush()
    vi.advanceTimersByTime(400)
    await flush()
    expect(api().zoom).toBeCloseTo(2.52)
    expect((root.querySelector("[data-slot=zoom-pane-content]") as HTMLElement).classList.contains("invisible")).toBe(false)
  })

  it("a saved view that takes longer than the wait does not make the map jump when it comes", async () => {
    const { store, answer } = slowStore({ x: 500, y: 400, zoom: 2 })
    setViewMemoryStore(store)
    const { api, root } = mount({ persistKey: "map" })
    await flush()
    const content = root.querySelector("[data-slot=zoom-pane-content]") as HTMLElement
    expect(content.classList.contains("invisible")).toBe(true)
    vi.advanceTimersByTime(1600)
    await flush()
    expect(content.classList.contains("invisible")).toBe(false)
    const whole = api().zoom
    expect(whole).toBeCloseTo(0.268, 2)
    answer()
    await flush()
    expect(api().zoom).toBe(whole)
  })

  it("a restored view is not fitted again when the content changes size", async () => {
    setViewMemoryStore(fakeStore({ x: 500, y: 400, zoom: 2 }).store)
    const { api, props } = mountLive({ persistKey: "map" })
    await flush()
    expect(api().zoom).toBe(2)
    props.world = { width: 2000, height: 1000 }
    await flush()
    expect(api().zoom).toBe(2)
  })
})

describe("view-only mode follows its world", () => {
  it("fits again when the size of what is drawn changes, and takes no notice before it has one", async () => {
    const { api, props } = mountLive({ world: { width: 0, height: 0 } })
    await flush()
    expect(api().zoom).toBe(1)
    props.world = { width: 1000, height: 1000 }
    await flush()
    expect(api().zoom).toBeCloseTo(0.268, 2)
    props.world = { width: 2000, height: 1000 }
    await flush()
    // 2000 wide in the 368 px left inside the padding.
    expect(api().zoom).toBeCloseTo(368 / 2000, 2)
  })
})

describe("a double-click that is not a zoom", () => {
  it("right after a jump, as the second click of a click on a group of pins lands on the map", async () => {
    const { api, pane } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    later()
    // The click on the group zooms in (a jump that glides); the double-click comes with the second click.
    api().showArea(AREA)
    press(pane, "pointerdown", { x: 100, y: 50 })
    dblclickAt(pane)
    vi.advanceTimersByTime(500)
    await flush()
    expect(api().zoom).toBeCloseTo(2.52)
  })

  it("right after a drag", async () => {
    const { api, pane } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    later()
    press(pane, "pointerdown", { x: 50, y: 50 })
    press(pane, "pointermove", { x: 90, y: 50 })
    press(pane, "pointerup", { x: 90, y: 50 })
    later(100)
    press(pane, "pointerdown", { x: 90, y: 50 })
    press(pane, "pointerup", { x: 90, y: 50 })
    dblclickAt(pane, { x: 90, y: 50 })
    expect(api().zoom).toBe(1)
    // A double-click once things have been still does zoom.
    later()
    press(pane, "pointerdown", { x: 90, y: 50 })
    dblclickAt(pane, { x: 90, y: 50 })
    expect(api().zoom).toBeCloseTo(1.25)
  })

  it("right after the wheel", async () => {
    const { api, pane } = mount({ wheel: "zoom" })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    later()
    wheel(pane, 0)
    dblclickAt(pane)
    expect(api().zoom).toBe(1)
  })

  it("when the view moved between the press and the double-click", async () => {
    const { api, pane } = mount()
    await flush()
    api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
    later()
    press(pane, "pointerdown", { x: 100, y: 50 })
    // Something (a key, a button) moved the view in between.
    pane.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))
    later()
    dblclickAt(pane)
    expect(api().zoom).toBe(1)
  })
})

describe("the % button", () => {
  it("says what it does and where the zoom is now, so a screen reader hears both", async () => {
    const { api, button } = mount({ hundred: 0.5 })
    await flush()
    api().setView({ x: 0, y: 0, zoom: 0.265 })
    await flush()
    expect(button("zoom-percent").getAttribute("aria-label")).toBe("Back to 100%, now 53%")
  })
})

describe("ZoomTip when the view moves", () => {
  it("says dismiss, so the tip does not hang where the thing no longer is", async () => {
    const dismissed = vi.fn()
    let api!: PaneApi
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp(defineComponent({
      render: () => h(ZoomPane, { ref: (instance: unknown) => (api = instance as PaneApi), viewOnly: true, world: WORLD }, {
        default: () => h(ZoomTip, { rect: { left: 10, top: 20, width: 30, height: 40 }, title: "Node", onDismiss: dismissed }),
      }),
    }))
    app.mount(root)
    await flush()
    dismissed.mockClear()
    api.setView({ x: 5, y: 5, zoom: 1 })
    await flush()
    expect(dismissed).toHaveBeenCalled()
  })
})

describe("a hidden pane (display: none)", () => {
  it("keeps its view when it is hidden and shown again, and sends nothing while hidden", async () => {
    const { api, views } = mount()
    await flush()
    api().setView({ x: -120, y: -80, zoom: 1.5 })
    await flush()
    const before = views.length
    resize(0, 0)
    await flush()
    expect(views.length).toBe(before)
    expect(api().view).toEqual({ x: -120, y: -80, zoom: 1.5 })
    resize(PANE.width, PANE.height)
    await flush()
    expect(api().view).toEqual({ x: -120, y: -80, zoom: 1.5 })
  })

  it("a box with no width or no height is hidden too", async () => {
    const { api } = mount()
    await flush()
    api().setView({ x: -120, y: -80, zoom: 1.5 })
    await flush()
    resize(0, 300)
    resize(400, 0)
    await flush()
    expect(api().view).toEqual({ x: -120, y: -80, zoom: 1.5 })
    expect(api().percent).toBe(150)
  })

  it("a jump asked for while hidden lands when it shows again; the newest one wins", async () => {
    const { api } = mount()
    await flush()
    resize(0, 0)
    api().setView({ x: -10, y: -10, zoom: 1 })
    api().setView({ x: -200, y: -100, zoom: 2 })
    await flush()
    expect(api().zoom).not.toBe(2)
    resize(PANE.width, PANE.height)
    await flush()
    expect(api().view).toEqual({ x: -200, y: -100, zoom: 2 })
  })

  it("a real resize still re-clamps the view", async () => {
    const { api, last } = mount()
    await flush()
    api().setView({ x: 200, y: 150, zoom: 1 })
    await flush()
    resize(100, 100)
    await flush()
    expect(last().pane).toEqual({ width: 100, height: 100 })
    // Loose bounds: an edge may reach the middle of the pane, no further.
    expect(api().view.x).toBe(50)
    expect(api().view.y).toBe(50)
  })

  it("a smaller box after being hidden re-clamps, a view that still fits is kept", async () => {
    const { api } = mount()
    await flush()
    api().setView({ x: 200, y: 150, zoom: 1 })
    await flush()
    resize(0, 0)
    resize(100, 100)
    await flush()
    expect(api().view).toEqual({ x: 50, y: 50, zoom: 1 })
  })

  it("a first measure at 0 x 0 does not fit to 0; the first real size fits", async () => {
    resize(0, 0)
    const { api, last, views } = mount()
    await flush()
    expect(views.length).toBe(0)
    expect(api().percent).toBe(100)
    resize(PANE.width, PANE.height)
    await flush()
    expect(last().pane).toEqual(PANE)
    expect(last().view.zoom).toBeCloseTo(0.268, 2)
  })

  it("a view asked for before the first real size is used instead of the first fit", async () => {
    resize(0, 0)
    const { api } = mount()
    await flush()
    api().setView({ x: -50, y: -50, zoom: 1 })
    resize(PANE.width, PANE.height)
    await flush()
    expect(api().view).toEqual({ x: -50, y: -50, zoom: 1 })
  })
})
