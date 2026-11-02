import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { commitAndWait, waitFor } from "./settle"

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("waitFor", () => {
  it("resolves true at once when it is already so", async () => {
    await expect(waitFor(() => true)).resolves.toBe(true)
  })

  it("resolves true when it becomes so, without any animation frame (node has none)", async () => {
    expect(typeof requestAnimationFrame).toBe("undefined")
    let ready = false
    const result = waitFor(() => ready, 500)
    await vi.advanceTimersByTimeAsync(100)
    ready = true
    await vi.advanceTimersByTimeAsync(40)
    await expect(result).resolves.toBe(true)
  })

  it("gives up with false after the time is up", async () => {
    const result = waitFor(() => false, 500)
    await vi.advanceTimersByTimeAsync(600)
    await expect(result).resolves.toBe(false)
  })
})

describe("commitAndWait", () => {
  it("is changed once the list shows the new order", async () => {
    let order = "a"
    const result = commitAndWait(() => void setTimeout(() => (order = "b"), 50), () => order === "b")
    await vi.advanceTimersByTimeAsync(100)
    await expect(result).resolves.toBe("changed")
  })

  it("is unchanged when the order never changes", async () => {
    const result = commitAndWait(() => undefined, () => false, 200)
    await vi.advanceTimersByTimeAsync(300)
    await expect(result).resolves.toBe("unchanged")
  })

  it("is failed, and reported, when the change throws or rejects", async () => {
    const report = vi.fn()
    await expect(commitAndWait(() => { throw new Error("no") }, () => true, 100, report)).resolves.toBe("failed")
    await expect(commitAndWait(() => Promise.reject(new Error("no")), () => true, 100, report)).resolves.toBe("failed")
    expect(report).toHaveBeenCalledTimes(2)
  })
})
