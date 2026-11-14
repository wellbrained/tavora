// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { effectScope } from "vue"
import { bindDrag, type DragHandlers } from "./bind-drag"

const Pointer = (globalThis.PointerEvent ?? MouseEvent) as typeof PointerEvent

function pointer(type: string, x = 0, y = 0, pointerId = 1, target: EventTarget = document.body): PointerEvent {
  const event = new Pointer(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId, button: 0 })
  if (event.pointerId !== pointerId) Object.defineProperty(event, "pointerId", { value: pointerId })
  target.dispatchEvent(event)
  return event
}

const press = (x = 0, y = 0, pointerId = 1) => new Pointer("pointerdown", { clientX: x, clientY: y, pointerId, button: 0 })

function spies() {
  const calls: string[] = []
  const handlers = {
    start: vi.fn(() => void calls.push("start")),
    move: vi.fn((_event: PointerEvent, delta: { x: number, y: number }) => void calls.push(`move ${delta.x},${delta.y}`)),
    drop: vi.fn(() => void calls.push("drop")),
    release: vi.fn(() => void calls.push("release")),
    cancel: vi.fn(() => void calls.push("cancel")),
  } satisfies DragHandlers
  return { calls, handlers }
}

const click = (target: EventTarget = document.body) => {
  const seen = vi.fn()
  document.addEventListener("click", seen, { once: true })
  const event = new MouseEvent("click", { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  document.removeEventListener("click", seen)
  return { reached: seen.mock.calls.length > 0, prevented: event.defaultPrevented }
}

const escape = () => {
  const seen = vi.fn()
  document.addEventListener("keydown", seen, { once: true })
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  document.removeEventListener("keydown", seen)
  return { reached: seen.mock.calls.length > 0, prevented: event.defaultPrevented }
}

// A drop leaves a swallower for the next click until its timer runs.
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

describe("bindDrag", () => {
  it("begins once the pointer passes the threshold, then follows it from the press", () => {
    const drag = bindDrag({ threshold: 4 })
    const { calls, handlers } = spies()
    drag.start(press(10, 10), handlers)
    expect(drag.phase.value).toBe("pressing")
    pointer("pointermove", 12, 12)
    expect(calls).toEqual([])
    pointer("pointermove", 14, 13)
    expect(drag.phase.value).toBe("dragging")
    pointer("pointermove", 20, 10)
    expect(calls).toEqual(["start", "move 4,3", "move 10,0"])
    pointer("pointerup", 20, 10)
    expect(calls.at(-1)).toBe("drop")
    expect(drag.phase.value).toBe("idle")
  })

  it("measures along one axis when asked", () => {
    const drag = bindDrag({ threshold: 4, axis: "x" })
    const { calls, handlers } = spies()
    drag.start(press(), handlers)
    pointer("pointermove", 3, 40)
    expect(calls).toEqual([])
    pointer("pointermove", -4, 40)
    expect(calls).toEqual(["start", "move -4,40"])
    drag.cancel()
  })

  it("begins on the first move without a threshold", () => {
    const drag = bindDrag()
    const { calls, handlers } = spies()
    drag.start(press(5, 5), handlers)
    pointer("pointermove", 5, 5)
    expect(calls).toEqual(["start", "move 0,0"])
    drag.cancel()
  })

  it("counts a release before the threshold as a click: no drop, and the click goes through", () => {
    const drag = bindDrag({ threshold: 4 })
    const { calls, handlers } = spies()
    drag.start(press(), handlers)
    pointer("pointermove", 1, 1)
    pointer("pointerup", 1, 1)
    expect(calls).toEqual(["release"])
    expect(click().reached).toBe(true)
  })

  it("swallows only the click right after a drop", () => {
    const drag = bindDrag()
    const { handlers } = spies()
    drag.start(press(), handlers)
    pointer("pointermove", 10, 0)
    pointer("pointerup", 10, 0)
    expect(click()).toEqual({ reached: false, prevented: true })
    drag.start(press(), handlers)
    pointer("pointermove", 10, 0)
    pointer("pointerup", 10, 0)
    vi.runAllTimers()
    expect(click().reached).toBe(true)
  })

  it("takes Escape for itself and puts the drag back", () => {
    const drag = bindDrag()
    const { calls, handlers } = spies()
    drag.start(press(), handlers)
    pointer("pointermove", 10, 0)
    expect(escape()).toEqual({ reached: false, prevented: true })
    expect(calls).toEqual(["start", "move 10,0", "cancel"])
    expect(drag.phase.value).toBe("idle")
    // The rest of the gesture is no longer the drag's.
    pointer("pointermove", 20, 0)
    pointer("pointerup", 20, 0)
    expect(calls).toHaveLength(3)
    expect(escape().reached).toBe(true)
  })

  it("cancels on Escape while still pressing too", () => {
    const drag = bindDrag({ threshold: 4 })
    const { calls, handlers } = spies()
    drag.start(press(), handlers)
    escape()
    expect(calls).toEqual(["cancel"])
  })

  it("leaves Escape alone when told to", () => {
    const drag = bindDrag({ escape: false })
    const { calls, handlers } = spies()
    drag.start(press(), handlers)
    pointer("pointermove", 10, 0)
    expect(escape().reached).toBe(true)
    pointer("pointerup", 10, 0)
    expect(calls).toEqual(["start", "move 10,0", "drop"])
  })

  it("puts the drag back when the system takes the pointer away", () => {
    const drag = bindDrag()
    const { calls, handlers } = spies()
    drag.start(press(), handlers)
    pointer("pointermove", 10, 0)
    pointer("pointercancel", 10, 0)
    expect(calls).toEqual(["start", "move 10,0", "cancel"])
    expect(click().reached).toBe(true)
  })

  it("follows only the pointer that pressed", () => {
    const drag = bindDrag()
    const { calls, handlers } = spies()
    drag.start(press(0, 0, 1), handlers)
    pointer("pointermove", 10, 0, 2)
    pointer("pointercancel", 10, 0, 2)
    pointer("pointerup", 10, 0, 2)
    expect(calls).toEqual([])
    pointer("pointermove", 10, 0, 1)
    pointer("pointerup", 10, 0, 1)
    expect(calls).toEqual(["start", "move 10,0", "drop"])
  })

  it("cancels the drag before when a new one starts", () => {
    const drag = bindDrag()
    const first = spies()
    const second = spies()
    drag.start(press(), first.handlers)
    pointer("pointermove", 10, 0)
    drag.start(press(), second.handlers)
    expect(first.calls).toEqual(["start", "move 10,0", "cancel"])
    pointer("pointerup", 10, 0)
    expect(second.calls).toEqual(["release"])
  })

  it("sets a drag up from a function only after the one before is put back", () => {
    const drag = bindDrag()
    let value = 0
    drag.start(press(), { move: () => void (value = 5), cancel: () => void (value = 0) })
    pointer("pointermove", 10, 0)
    expect(value).toBe(5)
    let seen = -1
    drag.start(press(), () => {
      seen = value
      return {}
    })
    expect(seen).toBe(0)
    drag.cancel()
  })

  it("does nothing on cancel() when no drag runs", () => {
    const drag = bindDrag()
    const { calls, handlers } = spies()
    drag.cancel()
    drag.start(press(), handlers)
    pointer("pointerup")
    drag.cancel()
    expect(calls).toEqual(["release"])
  })

  it("lets `start` cancel the drag it begins", () => {
    const drag = bindDrag()
    const { calls, handlers } = spies()
    handlers.start.mockImplementation(() => {
      calls.push("start")
      drag.cancel()
    })
    drag.start(press(), handlers)
    pointer("pointermove", 10, 0)
    expect(calls).toEqual(["start", "cancel"])
  })

  describe("holding the pointer", () => {
    function holder() {
      const el = document.createElement("div")
      document.body.append(el)
      const held = new Set<number>()
      el.setPointerCapture = vi.fn((id: number) => void held.add(id))
      el.releasePointerCapture = vi.fn((id: number) => void held.delete(id))
      el.hasPointerCapture = (id: number) => held.has(id)
      return el
    }

    it("holds the pointer while the drag runs and lets go at the end", () => {
      const el = holder()
      const drag = bindDrag()
      drag.start(press(), {}, { capture: el })
      expect(el.setPointerCapture).toHaveBeenCalledWith(1)
      pointer("pointerup", 0, 0, 1, el)
      expect(el.releasePointerCapture).toHaveBeenCalledWith(1)
      el.remove()
    })

    it("puts the drag back when the holder loses the pointer", () => {
      const el = holder()
      const drag = bindDrag()
      const { calls, handlers } = spies()
      drag.start(press(), handlers, { capture: el })
      pointer("pointermove", 10, 0, 1, el)
      // Another element losing it doesn't count.
      pointer("lostpointercapture", 0, 0, 1, document.body)
      expect(drag.phase.value).toBe("dragging")
      pointer("lostpointercapture", 0, 0, 1, el)
      expect(calls).toEqual(["start", "move 10,0", "cancel"])
      el.remove()
    })

    it("starts nothing when the pointer can't be held", () => {
      const el = holder()
      el.setPointerCapture = () => {
        throw new DOMException("No active pointer", "NotFoundError")
      }
      const drag = bindDrag()
      const { calls, handlers } = spies()
      expect(() => drag.start(press(), handlers, { capture: el })).toThrow()
      expect(drag.phase.value).toBe("idle")
      pointer("pointermove", 10, 0)
      pointer("pointerup", 10, 0)
      expect(calls).toEqual([])
      el.remove()
    })

    it("puts the drag back when the holder is taken out of the page", () => {
      const el = holder()
      const drag = bindDrag()
      const { calls, handlers } = spies()
      drag.start(press(), handlers, { capture: el })
      el.remove()
      pointer("lostpointercapture", 0, 0, 1, document)
      expect(calls).toEqual(["cancel"])
    })
  })

  it("puts the drag back when its component goes away", () => {
    const scope = effectScope()
    const drag = scope.run(() => bindDrag())!
    const { calls, handlers } = spies()
    drag.start(press(), handlers)
    pointer("pointermove", 10, 0)
    scope.stop()
    expect(calls).toEqual(["start", "move 10,0", "cancel"])
    pointer("pointerup", 10, 0)
    expect(calls).toHaveLength(3)
  })
})
