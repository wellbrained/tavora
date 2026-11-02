import { effectScope, nextTick, ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useCountTo } from "./use-count-to"

let reduced = false

beforeEach(() => {
  reduced = false
  vi.useFakeTimers()
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => setTimeout(() => callback(performance.now()), 16) as unknown as number)
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle))
  vi.stubGlobal("matchMedia", () => ({ matches: reduced }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const make = (start: number, options?: Parameters<typeof useCountTo>[1]) => {
  const source = ref(start)
  const shown = effectScope().run(() => useCountTo(source, options))!
  return { source, shown }
}

describe("useCountTo", () => {
  it("shows the first value at once", () => {
    expect(make(7).shown.value).toBe(7)
  })

  it("counts to a new value in whole steps and ends exactly on it", async () => {
    const { source, shown } = make(0)
    source.value = 10
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)
    expect(shown.value).toBeGreaterThan(0)
    expect(shown.value).toBeLessThan(10)
    expect(Number.isInteger(shown.value)).toBe(true)
    await vi.advanceTimersByTimeAsync(400)
    expect(shown.value).toBe(10)
  })

  it("carries on from where it is when the target changes in the middle", async () => {
    const { source, shown } = make(0)
    source.value = 100
    await nextTick()
    await vi.advanceTimersByTimeAsync(100)
    const middle = shown.value
    source.value = 0
    await nextTick()
    await vi.advanceTimersByTimeAsync(16)
    expect(shown.value).toBeLessThanOrEqual(middle)
    await vi.advanceTimersByTimeAsync(500)
    expect(shown.value).toBe(0)
  })

  it("jumps at once under reduced motion", async () => {
    reduced = true
    const { source, shown } = make(0)
    source.value = 10
    await nextTick()
    expect(shown.value).toBe(10)
  })

  it("still ends on the value when the page gets no frames", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 1)
    const { source, shown } = make(0)
    source.value = 10
    await nextTick()
    expect(shown.value).toBe(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(shown.value).toBe(10)
  })

  it("takes a value that is not a number at once", async () => {
    const { source, shown } = make(5)
    source.value = Number.NaN
    await nextTick()
    expect(shown.value).toBeNaN()
  })
})
