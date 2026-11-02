// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import { SAVE_DELAY_MS, setViewMemoryStore, type ViewStore } from "./view-memory"
import { TOOLTIP_GAP } from "../../tooltip"
import { ZoomPane, ZoomTip, useZoomTip } from "."
import type { Size, ZoomView } from "./view"

// The pane measures itself with a ResizeObserver and the sizes of its elements; jsdom has neither, so both are made up:
// a pane of 400 x 300 and (for a pane that moves its content) content of 1000 x 1000.
const PANE: Size = { width: 400, height: 300 }
const WORLD: Size = { width: 1000, height: 1000 }

let app: App | undefined
let reduced = false
beforeEach(() => {
  // Not the clock itself: Vue ignores a click whose time is before its handler was attached, and a faked clock says so.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] })
  reduced = false
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }))
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe() {
      this.callback()
    }
    disconnect() {}
  })
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => PANE.width })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => PANE.height })
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
    dblclick(off.pane, { x: 100, y: 50 })
    expect(off.api().zoom).toBe(1)
    app?.unmount()
    document.body.innerHTML = ""

    const on = mount({}, { default: () => h("button", { "data-testid": "node" }, "Node") })
    await flush()
    on.api().setView({ x: 0, y: 0, zoom: 1 })
    await flush()
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
  // A tooltip that closed a moment ago makes the next come at once; no tooltip has closed lately.
  beforeEach(() => void vi.spyOn(performance, "now").mockReturnValue(1e9))

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
