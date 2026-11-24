// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { TileMap } from "."
import type { TileSource } from "./geometry"

// As in the ZoomPane tests: jsdom has no layout and no ResizeObserver, so the box is made up and can be hidden.
const box = { width: 400, height: 300 }
const observers = new Set<() => void>()
function resize(width: number, height: number) {
  box.width = width
  box.height = height
  for (const callback of observers) callback()
}
const flush = async () => {
  for (let step = 0; step < 5; step++) await nextTick()
}

let app: App | undefined
beforeEach(() => {
  box.width = 400
  box.height = 300
  observers.clear()
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] })
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
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
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 8192 })
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 8192 })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("TileMap in a hidden pane", () => {
  it("keeps its view and its tiles while hidden: nothing is reset or loaded again", async () => {
    const url = vi.fn((level: number, x: number, y: number) => `${level}/${x}-${y}`)
    const source: TileSource = { size: 8192, tileSize: 512, maxLevel: 4, url }
    let api!: { camera: { x: number, y: number, zoom: number } | null, setCamera: (camera: { x: number, y: number, zoom: number }) => void }
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp(defineComponent({ render: () => h(TileMap, { ref: (instance: unknown) => (api = instance as typeof api), source, label: "Map", maxZoom: 1 }) }))
    app.mount(root)
    await flush()
    api.setCamera({ x: 4000, y: 4000, zoom: 1 })
    await flush()
    const tiles = () => [...root.querySelectorAll("img")].map((img) => img.getAttribute("src"))
    const before = tiles()
    // Zoomed in, so sharper tiles are on top of the base level.
    expect(before.length).toBeGreaterThan(1)
    const camera = { ...api.camera! }
    const calls = url.mock.calls.length

    resize(0, 0)
    await flush()
    expect(tiles()).toEqual(before)
    expect(url.mock.calls.length).toBe(calls)
    expect(api.camera).toEqual(camera)

    resize(400, 300)
    await flush()
    expect(tiles()).toEqual(before)
    expect(api.camera).toEqual(camera)
  })
})

describe("TileMap tiles that fail", () => {
  it("shows a tile of a new source again, even if the same tile failed for the old one", async () => {
    const first: TileSource = { size: 1024, tileSize: 512, maxLevel: 1, url: (level, x, y) => `a/${level}/${x}-${y}` }
    const second: TileSource = { size: 1024, tileSize: 512, maxLevel: 1, url: (level, x, y) => `b/${level}/${x}-${y}` }
    const current = ref(first)
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp(defineComponent({ render: () => h(TileMap, { source: current.value, label: "Map", maxZoom: 1 }) }))
    app.mount(root)
    await flush()
    const base = root.querySelector<HTMLImageElement>("img[src='a/0/0-0']")!
    base.dispatchEvent(new Event("error"))
    await flush()
    expect(root.querySelector("img[src='a/0/0-0']")).toBeNull()
    current.value = second
    await flush()
    expect(root.querySelector("img[src='b/0/0-0']")).not.toBeNull()
  })
})
