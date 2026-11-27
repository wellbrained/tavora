// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import Tooltip from "./Tooltip"
import { useTooltip, type UseTooltip, type UseTooltipOptions } from "./use-tooltip"

// A card pinned open in the panel (useTooltip's `pin` without the shared tooltip), and the long press that shows a card
// on touch.

let app: App | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
})

interface Card { name: string }

/** Targets bound with `tip.on(...)` (a span, or a button with `button`) and the panel's one Tooltip. */
async function mount(options: UseTooltipOptions, names: string[], target: Record<string, unknown> = {}, as = "span") {
  let tip!: UseTooltip<Card>
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({
    setup() {
      tip = useTooltip<Card>(options)
      return () => [
        h("div", names.map((name, index) => h(as, { key: index, "data-index": index, tabindex: 0, ...tip.on({ name }, target) }, name))),
        h(Tooltip, { ...tip.props, title: tip.content?.name ?? "" }),
      ]
    },
  }))
  app.mount(host)
  await nextTick()
  return { tip, targets: [...host.querySelectorAll<HTMLElement>("[data-index]")] }
}
const press = (element: Element, pointerType = "mouse") => {
  element.dispatchEvent(Object.assign(new Event("pointerdown", { bubbles: true }), { pointerType, pointerId: 1, clientX: 0, clientY: 0 }))
}
const click = (element: Element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
const enter = (element: Element) => element.dispatchEvent(Object.assign(new Event("pointerenter"), { pointerType: "mouse" }))
const leave = (element: Element) => element.dispatchEvent(new Event("pointerleave"))
const card = () => document.querySelector<HTMLElement>("[data-slot=tooltip]")

describe("a card pinned in the panel", () => {
  it("pins on a press, takes the pointer, shows an X and stays when the pointer leaves", async () => {
    const { tip, targets } = await mount({ pin: true }, ["Bow", "Axe"])
    press(targets[0]!)
    click(targets[0]!)
    await nextTick()
    expect(tip.pinned).toBe(true)
    expect(tip.props.pinned).toBe(true)
    expect(card()!.dataset.pinned).toBe("true")
    expect(card()!.querySelector("[data-slot=tooltip-close]")!.getAttribute("aria-label")).toBe("Close")
    leave(targets[0]!)
    targets[0]!.dispatchEvent(new FocusEvent("blur"))
    expect(tip.props.open).toBe(true)
    // Another target's hover leaves the pinned card be.
    enter(targets[1]!)
    vi.advanceTimersByTime(500)
    expect(tip.content).toEqual({ name: "Bow" })
  })

  it("closes on its X and on Escape, and gives the focus back to its target", async () => {
    const { tip, targets } = await mount({ pin: true }, ["Bow"])
    click(targets[0]!)
    await nextTick()
    card()!.querySelector<HTMLElement>("[data-slot=tooltip-close]")!.focus()
    card()!.querySelector<HTMLElement>("[data-slot=tooltip-close]")!.click()
    expect(tip.props.open).toBe(false)
    expect(document.activeElement).toBe(targets[0])

    click(targets[0]!)
    await nextTick()
    document.body.focus()
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(tip.props.open).toBe(false)
    expect(document.activeElement).toBe(targets[0])
  })

  it("closes on a second press of its target and on a press elsewhere, but not on a press inside it", async () => {
    const { tip, targets } = await mount({ pin: true }, ["Bow"])
    click(targets[0]!)
    await nextTick()
    press(card()!)
    expect(tip.props.open).toBe(true)
    press(targets[0]!)
    click(targets[0]!)
    expect(tip.props.open).toBe(false)

    click(targets[0]!)
    await nextTick()
    press(document.body)
    expect(tip.props.open).toBe(false)
  })

  it("doesn't pin on a button unless the target says `pin`", async () => {
    const plain = await mount({ pin: true }, ["Bow"], {}, "button")
    click(plain.targets[0]!)
    expect(plain.tip.pinned).toBe(false)
    app!.unmount()
    document.body.replaceChildren()
    const slot = await mount({ pin: true }, ["Bow"], { pin: true }, "button")
    click(slot.targets[0]!)
    expect(slot.tip.pinned).toBe(true)
  })

  it("doesn't pin without `pin`: a press closes the card as before", async () => {
    const { tip, targets } = await mount({}, ["Bow"])
    enter(targets[0]!)
    vi.advanceTimersByTime(180)
    press(targets[0]!)
    click(targets[0]!)
    expect(tip.props.open).toBe(false)
    expect(tip.props.pinned).toBe(false)
  })
})

describe("a long press on touch", () => {
  it("shows the card after a moment and swallows the click that ends the touch", async () => {
    const onClick = vi.fn()
    const { tip, targets } = await mount({}, ["Bow"])
    targets[0]!.addEventListener("click", onClick)
    press(targets[0]!, "touch")
    vi.advanceTimersByTime(300)
    expect(tip.props.open).toBe(false)
    vi.advanceTimersByTime(200)
    expect(tip.props.open).toBe(true)
    click(targets[0]!)
    expect(onClick).not.toHaveBeenCalled()
    // It stays after the finger lifts, until a press elsewhere.
    targets[0]!.dispatchEvent(new Event("pointerup"))
    leave(targets[0]!)
    expect(tip.props.open).toBe(true)
    press(document.body)
    expect(tip.props.open).toBe(false)
  })

  it("is a plain tap when the finger lifts or moves away first", async () => {
    const { tip, targets } = await mount({}, ["Bow"])
    press(targets[0]!, "touch")
    targets[0]!.dispatchEvent(new Event("pointerup"))
    vi.advanceTimersByTime(600)
    expect(tip.props.open).toBe(false)
    press(targets[0]!, "touch")
    targets[0]!.dispatchEvent(Object.assign(new Event("pointermove"), { pointerId: 1, clientX: 30, clientY: 0 }))
    vi.advanceTimersByTime(600)
    expect(tip.props.open).toBe(false)
  })
})

describe("Tooltip maxHeight", () => {
  it("scrolls a card taller than its own height", async () => {
    vi.useRealTimers()
    const host = document.createElement("div")
    document.body.append(host)
    const tall = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 200, height: 400, left: 0, top: 0, right: 200, bottom: 400, x: 0, y: 0, toJSON() {} } as DOMRect)
    app = createApp({ render: () => h(Tooltip, { open: true, anchor: { left: 10, top: 10, right: 20, bottom: 20 }, title: "Tall", maxHeight: 120 }) })
    app.mount(host)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    await nextTick()
    const el = card()!
    expect(el.dataset.scrolls).toBe("true")
    expect(el.style.maxHeight).toBe("120px")
    tall.mockRestore()
  })
})

describe("pinning from the keyboard", () => {
  it("pins a target that isn't a control with Enter, and Enter again closes it", async () => {
    const { tip, targets } = await mount({ pin: true }, ["Bow"])
    targets[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(tip.pinned).toBe(true)
    expect(tip.pinnedTarget).toBe(targets[0])
    targets[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(tip.props.open).toBe(false)
    expect(tip.pinnedTarget).toBeNull()
  })
})
