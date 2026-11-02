// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, ref, type App } from "vue"
import { RadioGroup, RadioGroupItem } from "."
import { StyleTiles } from "../style-tiles"

// Arrow keys travel through a group without animating (motion.css holds the motion while the group has data-travel).
// reka moves the focus first and picks the new option a tick later, so the flag has to survive the focus move and
// still be there when the pick lands.

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

/** Mounts a group and records, at the moment each pick is made, whether the group was marked as travelling. */
function mountGroup(kind: "radio" | "tiles") {
  const value = ref("a")
  const picks: { value: string; travelling: boolean }[] = []
  const root = document.createElement("div")
  document.body.append(root)
  const group = () => root.querySelector(kind === "radio" ? "[data-slot=radio-group]" : "[data-slot=style-tiles]") as HTMLElement
  const update = (payload: unknown) => {
    const next = String(payload)
    picks.push({ value: next, travelling: group().hasAttribute("data-travel") })
    value.value = next
  }
  const App = defineComponent({
    render: () =>
      kind === "radio"
        ? h(RadioGroup, { modelValue: value.value, "onUpdate:modelValue": update }, () => ["a", "b", "c"].map((v) => h(RadioGroupItem, { value: v, "data-testid": v })))
        : h(StyleTiles, { modelValue: value.value, "onUpdate:modelValue": update, label: "Style", options: ["a", "b", "c"].map((v) => ({ value: v, label: v, testid: v })) }),
  })
  app = createApp(App)
  app.mount(root)
  const item = (v: string) => root.querySelector(`[data-testid=${v}]`) as HTMLElement
  return { value, picks, group, item }
}

describe.each(["radio", "tiles"] as const)("%s group", (kind) => {
  // Tiles lie in a row, radios in a column.
  const NEXT = kind === "tiles" ? "ArrowRight" : "ArrowDown"
  it("keeps data-travel while the arrow keys move the choice, and drops it on key up", async () => {
    const { value, picks, group, item } = mountGroup(kind)
    await wait()
    item("a").focus()
    await wait()
    item("a").dispatchEvent(new KeyboardEvent("keydown", { key: NEXT, bubbles: true, cancelable: true }))
    await wait()
    expect(value.value).toBe("b")
    expect(picks).toEqual([{ value: "b", travelling: true }])
    expect(group().hasAttribute("data-travel")).toBe(true)

    // Arrow again, holding the key: still travelling
    item("b").dispatchEvent(new KeyboardEvent("keydown", { key: NEXT, bubbles: true, cancelable: true }))
    await wait()
    expect(picks.at(-1)).toEqual({ value: "c", travelling: true })

    item("c").dispatchEvent(new KeyboardEvent("keyup", { key: NEXT, bubbles: true }))
    await wait()
    expect(group().hasAttribute("data-travel")).toBe(false)
  })

  it("animates a click: no data-travel when the pick is made", async () => {
    const { picks, item } = mountGroup(kind)
    await wait()
    item("c").dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    item("c").click()
    await wait()
    expect(picks).toEqual([{ value: "c", travelling: false }])
  })

  it("drops data-travel when the focus leaves the group, not when it moves inside it", async () => {
    const { group, item } = mountGroup(kind)
    await wait()
    item("a").focus()
    await wait()
    item("a").dispatchEvent(new KeyboardEvent("keydown", { key: NEXT, bubbles: true, cancelable: true }))
    await wait()
    expect(group().hasAttribute("data-travel")).toBe(true)
    const outside = document.createElement("button")
    document.body.append(outside)
    outside.focus()
    await wait()
    expect(group().hasAttribute("data-travel")).toBe(false)
  })
})
