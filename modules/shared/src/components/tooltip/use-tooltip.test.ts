// @vitest-environment jsdom
import type { TooltipContent } from "@tavora/sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { isTruncated, useTooltip, type SharedTooltip, type UseTooltip } from "./use-tooltip"

// The helper behind every in-panel tooltip that isn't a title hint: one card for many targets.

let app: App | undefined
beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
})

interface Card { name: string }

/** Mounts targets bound with `tip.on(...)` and hands back the helper and the targets. */
async function mount<T>(make: () => UseTooltip<T>, cards: () => (T | null)[], extra: Record<string, unknown> = {}) {
  let tip!: UseTooltip<T>
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(defineComponent({
    setup() {
      tip = make()
      return () => h("div", cards().map((card, index) => h("span", { key: index, "data-index": index, ...tip.on(card, extra) }, "Target")))
    },
  }))
  app.mount(host)
  await nextTick()
  return { tip, targets: [...host.querySelectorAll<HTMLElement>("[data-index]")] }
}
const enter = (element: Element) => element.dispatchEvent(Object.assign(new Event("pointerenter"), { pointerType: "mouse" }))
const leave = (element: Element) => element.dispatchEvent(new Event("pointerleave"))

describe("useTooltip in the panel", () => {
  it("shows a card after a short wait on hover, beside the target, and describes the target by it", async () => {
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Bow" }, { name: "Axe" }])
    enter(targets[0]!)
    expect(tip.props.open).toBe(false)
    vi.advanceTimersByTime(180)
    expect(tip.props.open).toBe(true)
    expect(tip.content).toEqual({ name: "Bow" })
    expect(targets[0]!.getAttribute("aria-describedby")).toBe(tip.props.id)
    leave(targets[0]!)
    expect(tip.props.open).toBe(false)
    expect(targets[0]!.hasAttribute("aria-describedby")).toBe(false)
  })

  it("doesn't wait for the next card right after one closed", async () => {
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Bow" }, { name: "Axe" }])
    enter(targets[0]!)
    vi.advanceTimersByTime(180)
    leave(targets[0]!)
    enter(targets[1]!)
    expect(tip.props.open).toBe(true)
    expect(tip.content).toEqual({ name: "Axe" })
  })

  it("cancels a card still on the way when the pointer leaves", async () => {
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Bow" }])
    enter(targets[0]!)
    leave(targets[0]!)
    vi.advanceTimersByTime(500)
    expect(tip.props.open).toBe(false)
  })

  it("shows at once from the keyboard and closes on blur, Escape and a press", async () => {
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Bow" }], { focusable: true })
    const target = targets[0]!
    expect(target.getAttribute("tabindex")).toBe("0")
    target.focus()
    expect(tip.props.open).toBe(true)
    target.blur()
    expect(tip.props.open).toBe(false)
    target.focus()
    expect(tip.props.open).toBe(true)
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(tip.props.open).toBe(false)
    target.blur()
    target.focus()
    expect(tip.props.open).toBe(true)
    target.dispatchEvent(new Event("pointerdown"))
    expect(tip.props.open).toBe(false)
  })

  it("asks a function for its card only when it's needed, keeps it up to date, and shows nothing for none", async () => {
    const name = ref("Bow")
    const make = vi.fn(() => ({ name: name.value }))
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [null])
    enter(targets[0]!)
    vi.advanceTimersByTime(500)
    expect(tip.props.open).toBe(false)
    expect(make).not.toHaveBeenCalled()
    tip.show(targets[0]!, make, { side: "right" })
    expect(tip.props).toMatchObject({ open: true, side: "right" })
    name.value = "Bogen"
    expect(tip.content).toEqual({ name: "Bogen" })
  })

  it("closes when its target goes away", async () => {
    const shown = ref([{ name: "Bow" }])
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => shown.value, { focusable: true })
    targets[0]!.focus()
    expect(tip.props.open).toBe(true)
    shown.value = []
    await nextTick()
    expect(tip.props.open).toBe(false)
  })

  it("ignores touch: a tap is for the target itself", async () => {
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Bow" }])
    targets[0]!.dispatchEvent(Object.assign(new Event("pointerenter"), { pointerType: "touch" }))
    vi.advanceTimersByTime(500)
    expect(tip.props.open).toBe(false)
  })
})

describe("useTooltip target options", () => {
  it("names a target without a name of its own, and describes one with a name", async () => {
    let tip!: UseTooltip<Card>
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp(defineComponent({ setup() { tip = useTooltip<Card>(); return () => h("div", [h("button", { id: "icon", ...tip.on({ name: "Save" }) }), h("button", { id: "text", ...tip.on({ name: "Save" }) }, "Save file")]) } }))
    app.mount(host)
    await nextTick()
    const icon = host.querySelector<HTMLElement>("#icon")!, text = host.querySelector<HTMLElement>("#text")!
    icon.focus()
    expect(icon.getAttribute("aria-labelledby")).toBe(tip.props.id)
    expect(icon.hasAttribute("aria-describedby")).toBe(false)
    text.focus()
    expect(icon.hasAttribute("aria-labelledby")).toBe(false)
    expect(text.getAttribute("aria-describedby")).toBe(tip.props.id)
  })

  it("opens and closes with a press on a toggle target, a tap too, and closes on a press elsewhere", async () => {
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Help" }], { toggle: true })
    const target = targets[0]!
    target.dispatchEvent(Object.assign(new Event("pointerenter"), { pointerType: "touch" }))
    target.dispatchEvent(new Event("pointerdown"))
    target.dispatchEvent(new MouseEvent("click"))
    expect(tip.props.open).toBe(true)
    leave(target)
    expect(tip.props.open).toBe(true)
    target.dispatchEvent(new MouseEvent("click"))
    expect(tip.props.open).toBe(false)
    target.dispatchEvent(new MouseEvent("click"))
    expect(tip.props.open).toBe(true)
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }))
    expect(tip.props.open).toBe(false)
  })

  it("stays open on a press with keepOnPress", async () => {
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Copy" }], { keepOnPress: true })
    enter(targets[0]!)
    vi.advanceTimersByTime(180)
    targets[0]!.dispatchEvent(new Event("pointerdown"))
    expect(tip.props.open).toBe(true)
  })

  it("shows only when `when` says so", async () => {
    const fits = ref(true)
    const { tip, targets } = await mount(() => useTooltip<Card>(), () => [{ name: "Long name" }], { when: () => !fits.value })
    enter(targets[0]!)
    vi.advanceTimersByTime(500)
    expect(tip.props.open).toBe(false)
    leave(targets[0]!)
    fits.value = false
    vi.advanceTimersByTime(500)
    enter(targets[0]!)
    vi.advanceTimersByTime(500)
    expect(tip.props.open).toBe(true)
  })

  it("tells cut-short text by its scroll size", () => {
    const el = document.createElement("span")
    Object.defineProperty(el, "scrollWidth", { value: 200, configurable: true })
    Object.defineProperty(el, "clientWidth", { value: 120, configurable: true })
    expect(isTruncated(el)).toBe(true)
    Object.defineProperty(el, "scrollWidth", { value: 120, configurable: true })
    expect(isTruncated(el)).toBe(false)
  })
})

describe("useTooltip with the shared tooltip", () => {
  function sharedTooltip() {
    let closed: ((event: { id: string }) => void) | undefined
    const shared = {
      show: vi.fn(async () => true),
      hide: vi.fn(async () => undefined),
      onClose: vi.fn((fn: (event: { id: string }) => void) => { closed = fn; return () => { closed = undefined } }),
    } satisfies SharedTooltip
    return { shared, close: (id: string) => closed?.({ id }) }
  }
  const card: TooltipContent = { title: "Archer Tower", subtitle: "Tower" }

  it("shows the card in Tavora's tooltip beside the target, and hides it on leave", async () => {
    const { shared } = sharedTooltip()
    const { tip, targets } = await mount(() => useTooltip({ shared }), () => [card])
    enter(targets[0]!)
    vi.advanceTimersByTime(180)
    expect(shared.show).toHaveBeenCalledWith(expect.objectContaining({ anchor: targets[0], content: card, pinnable: false }))
    expect(tip.props.open).toBe(false)
    leave(targets[0]!)
    const id = (shared.show.mock.calls[0] as unknown as [{ id: string }])[0].id
    expect(shared.hide).toHaveBeenCalledWith(id)
  })

  it("pins a card with a click on a target that isn't a control, with one id per card", async () => {
    const { shared } = sharedTooltip()
    const { targets } = await mount(() => useTooltip({ shared, pin: true }), () => [card])
    targets[0]!.dispatchEvent(new MouseEvent("click"))
    targets[0]!.dispatchEvent(new MouseEvent("click"))
    const calls = shared.show.mock.calls as unknown as [{ id: string; pinned?: boolean; pinnable: boolean }][]
    expect(calls.map(([request]) => request.pinned)).toEqual([true, true])
    expect(calls[0]![0].id).toBe(calls[1]![0].id)
    expect(calls[0]![0].pinnable).toBe(true)
  })

  it("never pins on a button: a click only does what the button does", async () => {
    const { shared } = sharedTooltip()
    let tip!: UseTooltip<TooltipContent>
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp(defineComponent({ setup() { tip = useTooltip({ shared, pin: true }); return () => h("button", tip.on(card)) } }))
    app.mount(host)
    await nextTick()
    host.querySelector("button")!.dispatchEvent(new MouseEvent("click"))
    expect(shared.show).not.toHaveBeenCalled()
  })

  it("takes the shared tooltip from a function once the panel is connected, and tries again after a failed show", async () => {
    const { shared } = sharedTooltip()
    const connected = ref<SharedTooltip | null>(null)
    const { targets } = await mount(() => useTooltip({ shared: () => connected.value }), () => [card], { focusable: true })
    targets[0]!.focus()
    expect(shared.show).not.toHaveBeenCalled()
    targets[0]!.blur()
    connected.value = shared
    shared.show.mockRejectedValueOnce(new Error("busy"))
    targets[0]!.focus()
    await vi.runAllTimersAsync()
    targets[0]!.focus()
    targets[0]!.dispatchEvent(new FocusEvent("focus"))
    expect(shared.show).toHaveBeenCalledTimes(2)
  })

  it("shows the card in the panel instead when Tavora can't, with `fallback`", async () => {
    const { shared } = sharedTooltip()
    const connected = ref<SharedTooltip | null>(null)
    const { tip, targets } = await mount(() => useTooltip({ shared: () => connected.value, fallback: true }), () => [card], { focusable: true, side: "right" })
    targets[0]!.focus()
    expect(tip.props).toMatchObject({ open: true, side: "right" })
    expect(targets[0]!.getAttribute("aria-describedby")).toBe(tip.props.id)
    targets[0]!.blur()
    expect(tip.props.open).toBe(false)
    connected.value = shared
    shared.show.mockRejectedValueOnce(new Error("old Tavora"))
    targets[0]!.focus()
    expect(tip.props.open).toBe(false)
    await vi.runAllTimersAsync()
    expect(tip.props.open).toBe(true)
  })

  it("forgets a card Tavora closed, and stops listening when the panel goes", async () => {
    const { shared, close } = sharedTooltip()
    const { targets } = await mount(() => useTooltip({ shared }), () => [card], { focusable: true })
    targets[0]!.focus()
    const id = (shared.show.mock.calls[0] as unknown as [{ id: string }])[0].id
    close(id)
    leave(targets[0]!)
    expect(shared.hide).not.toHaveBeenCalled()
    app!.unmount()
    app = undefined
    expect(shared.onClose).toHaveBeenCalledOnce()
  })
})
