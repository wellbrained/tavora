import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createViewMemory, flushViewMemory, readSavedView, SAVE_DELAY_MS, type ViewStore } from "./view-memory"

function fakeStore(initial?: unknown) {
  const data = new Map<string, unknown>(initial === undefined ? [] : [["zoom-view:map", initial]])
  const store: ViewStore & { set: ReturnType<typeof vi.fn>, get: ReturnType<typeof vi.fn> } = {
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => void data.set(key, value)),
  }
  return { store, data }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("readSavedView", () => {
  it("takes a view and nothing else", () => {
    expect(readSavedView({ x: 1, y: 2, zoom: 0.5 })).toEqual({ x: 1, y: 2, zoom: 0.5 })
    expect(readSavedView(null)).toBeNull()
    expect(readSavedView({ x: 1, y: 2 })).toBeNull()
    expect(readSavedView({ x: "1", y: 2, zoom: 1 })).toBeNull()
    expect(readSavedView({ x: 1, y: 2, zoom: 0 })).toBeNull()
    expect(readSavedView({ x: Number.NaN, y: 2, zoom: 1 })).toBeNull()
  })
})

describe("createViewMemory", () => {
  it("restores what was saved under its key", async () => {
    const { store } = fakeStore({ x: 10, y: 20, zoom: 1.5 })
    expect(await createViewMemory("map", { store }).load()).toEqual({ x: 10, y: 20, zoom: 1.5 })
    expect(store.get).toHaveBeenCalledWith("zoom-view:map")
  })

  it("has nothing when nothing is saved, the value is not a view, or storage fails", async () => {
    expect(await createViewMemory("map", { store: fakeStore().store }).load()).toBeNull()
    expect(await createViewMemory("map", { store: fakeStore({ nope: 1 }).store }).load()).toBeNull()
    const broken: ViewStore = { get: async () => Promise.reject(new Error("no storage")), set: async () => Promise.reject(new Error("no storage")) }
    expect(await createViewMemory("map", { store: broken }).load()).toBeNull()
    await expect((async () => {
      const memory = createViewMemory("map", { store: broken })
      memory.save({ x: 1, y: 1, zoom: 1 })
      await memory.flush()
    })()).resolves.toBeUndefined()
    expect(await createViewMemory("map").load()).toBeNull()
  })

  it("writes once the view has been still, and only the last one", async () => {
    const { store } = fakeStore()
    const memory = createViewMemory("map", { store })
    memory.save({ x: 1, y: 1, zoom: 1 })
    vi.advanceTimersByTime(SAVE_DELAY_MS - 100)
    memory.save({ x: 2, y: 2, zoom: 1 })
    vi.advanceTimersByTime(SAVE_DELAY_MS - 100)
    // Moved again before the wait was over: nothing written yet.
    expect(store.set).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(store.set).toHaveBeenCalledTimes(1)
    expect(store.set).toHaveBeenCalledWith("zoom-view:map", { x: 2, y: 2, zoom: 1 })
  })

  it("writes a waiting view at once on flush, and not again", async () => {
    const { store } = fakeStore()
    const memory = createViewMemory("map", { store })
    memory.save({ x: 3, y: 4, zoom: 2 })
    await flushViewMemory()
    expect(store.set).toHaveBeenCalledWith("zoom-view:map", { x: 3, y: 4, zoom: 2 })
    vi.advanceTimersByTime(SAVE_DELAY_MS * 2)
    await memory.flush()
    expect(store.set).toHaveBeenCalledTimes(1)
  })
})
