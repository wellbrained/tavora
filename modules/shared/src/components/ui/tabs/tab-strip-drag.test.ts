// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import TabStrip from "./TabStrip.vue"

// Tabs of 100 wide in a row from 0. Like a browser, a tab's box moves with its `translate`: the dragged tab follows the
// pointer and the others slide aside, so a hit test on the live boxes finds the dragged tab under the pointer.
const WIDTH = 100
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

function pointer(type: string, x: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: 10, button: 0, bubbles: true, cancelable: true })
  Object.defineProperty(event, "pointerId", { value: 1 })
  return event
}

async function setup(animated: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: !animated && query.includes("reduce") }))
  const reorder: string[][] = []
  const root = document.createElement("div")
  document.body.append(root)
  const tabs = ["a", "b", "c", "d"].map((id) => ({ id, label: id }))
  app = createApp({ render: () => h(TabStrip, { tabs, modelValue: "a", onReorder: (ids: string[]) => reorder.push(ids) }) })
  app.mount(root)
  await nextTick()
  const els = [...root.querySelectorAll<HTMLElement>("[data-tab-id]")]
  els.forEach((el, n) => {
    el.getBoundingClientRect = () => {
      const shift = Number.parseFloat(el.style.translate) || 0
      const left = n * WIDTH + shift
      return { left, right: left + WIDTH, top: 0, bottom: 30, width: WIDTH, height: 30, x: left, y: 0, toJSON() {} }
    }
  })
  const scroller = root.querySelector<HTMLElement>("[data-testid=tab-strip-scroller]")!
  scroller.getBoundingClientRect = () => ({ left: 0, right: 1000, top: 0, bottom: 30, width: 1000, height: 30, x: 0, y: 0, toJSON() {} })
  return { els, reorder }
}

/** Presses tab `from` in its middle and drags the pointer to `to`. */
async function drag(els: HTMLElement[], from: number, to: number) {
  const start = from * WIDTH + 50
  els[from]!.dispatchEvent(pointer("pointerdown", start))
  for (const x of [start + Math.sign(to - start) * 10, (start + to) / 2, to]) {
    window.dispatchEvent(pointer("pointermove", x))
    await nextTick()
  }
  window.dispatchEvent(pointer("pointerup", to))
  await vi.advanceTimersByTimeAsync(700)
}

describe.each([true, false])("TabStrip drag, animations %s", (animated) => {
  it("drops a tab dragged to the right before a later tab", async () => {
    vi.useFakeTimers()
    try {
      const { els, reorder } = await setup(animated)
      await drag(els, 0, 240) // in c's left half
      expect(reorder).toEqual([["b", "a", "c", "d"]])
    } finally {
      vi.useRealTimers()
    }
  })

  it("drops a tab dragged to the left", async () => {
    vi.useFakeTimers()
    try {
      const { els, reorder } = await setup(animated)
      await drag(els, 3, 120) // in b's left half
      expect(reorder).toEqual([["a", "d", "b", "c"]])
    } finally {
      vi.useRealTimers()
    }
  })

  it("drops a tab dragged past the end last", async () => {
    vi.useFakeTimers()
    try {
      const { els, reorder } = await setup(animated)
      await drag(els, 0, 600)
      expect(reorder).toEqual([["b", "c", "d", "a"]])
    } finally {
      vi.useRealTimers()
    }
  })
})
