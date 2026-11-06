// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, ref, type App } from "vue"
import { Grid3x3, List } from "@lucide/vue"
import { SegmentedControl, type SegmentedOption } from "."
import { isSoftOption, optionHint } from "./options"
import { installTitleTooltips } from "../../../title-tooltips"

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

type Value = "list" | "grid" | "map"

/** Mounts a control and records every pick it reports. */
function mount(options: SegmentedOption<Value>[], extra: Record<string, unknown> = {}) {
  const value = ref<Value>("list")
  const picks: string[] = []
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({
    render: () =>
      h(SegmentedControl<Value>, {
        modelValue: value.value,
        "onUpdate:modelValue": (next: Value) => {
          picks.push(next)
          value.value = next
        },
        label: "View",
        options,
        ...extra,
      }),
  })
  app.mount(root)
  const item = (v: string) => root.querySelector(`[data-testid=${v}]`) as HTMLElement
  const key = (target: HTMLElement, name: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }))
  return { value, picks, root, item, key }
}

const plain: SegmentedOption<Value>[] = [
  { value: "list", label: "List", testid: "list" },
  { value: "grid", label: "Grid", testid: "grid" },
  { value: "map", label: "Map", testid: "map" },
]

describe("plain options", () => {
  it("render as before: the label alone, no icon, no hint", async () => {
    const { root, item } = mount(plain)
    await wait()
    expect(root.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(item("grid").textContent?.trim()).toBe("Grid")
    expect(item("grid").querySelector("svg")).toBeNull()
    expect(item("grid").hasAttribute("title")).toBe(false)
    expect(item("grid").hasAttribute("aria-label")).toBe(false)
    expect(item("grid").className).not.toContain("inline-flex")
    expect(item("list").getAttribute("aria-checked")).toBe("true")
  })

  it("pick on a click and on the arrow keys", async () => {
    const { picks, item, key } = mount(plain)
    await wait()
    item("map").click()
    await wait()
    expect(picks).toEqual(["map"])
    item("map").focus()
    key(item("map"), "ArrowLeft")
    await wait()
    expect(picks).toEqual(["map", "grid"])
  })

  it("are all off with the whole control disabled", async () => {
    const { picks, item } = mount(plain, { disabled: true })
    await wait()
    item("grid").click()
    await wait()
    expect(picks).toEqual([])
    expect(item("grid").hasAttribute("disabled")).toBe(true)
  })
})

describe("icons", () => {
  it("show before the label", async () => {
    const { item } = mount([{ value: "list", label: "List", testid: "list", icon: List }, ...plain.slice(1)])
    await wait()
    const first = item("list").firstElementChild
    expect(first?.tagName.toLowerCase()).toBe("svg")
    expect(first?.getAttribute("aria-hidden")).toBe("true")
    expect(item("list").textContent?.trim()).toBe("List")
    expect(item("list").hasAttribute("aria-label")).toBe(false)
  })

  it("alone: the label is the tooltip and the aria-label", async () => {
    const { item } = mount([{ value: "list", label: "List", testid: "list", icon: List, iconOnly: true }, ...plain.slice(1)])
    await wait()
    expect(item("list").querySelector("svg")).not.toBeNull()
    expect(item("list").textContent?.trim()).toBe("")
    expect(item("list").getAttribute("aria-label")).toBe("List")
    expect(item("list").getAttribute("title")).toBe("List")
  })

  it("alone without an icon still shows its label", async () => {
    const { item } = mount([{ value: "list", label: "List", testid: "list", iconOnly: true }, ...plain.slice(1)])
    await wait()
    expect(item("list").textContent?.trim()).toBe("List")
    expect(item("list").hasAttribute("aria-label")).toBe(false)
  })
})

describe("tooltips", () => {
  it("an option's tooltip is its title", async () => {
    const { item } = mount([plain[0]!, { ...plain[1]!, tooltip: "Tiles of pictures" }, plain[2]!])
    await wait()
    expect(item("grid").getAttribute("title")).toBe("Tiles of pictures")
    expect(item("list").hasAttribute("title")).toBe(false)
  })

  it("an icon-only option with a tooltip keeps its name in front", () => {
    expect(optionHint({ value: "x", label: "Grid", icon: Grid3x3, iconOnly: true, tooltip: "Tiles" })).toBe("Grid: Tiles")
    expect(optionHint({ value: "x", label: "Grid", icon: Grid3x3, iconOnly: true })).toBe("Grid")
    expect(optionHint({ value: "x", label: "Grid", tooltip: "  " })).toBeUndefined()
  })

  it("a disabled option says why instead", () => {
    expect(optionHint({ value: "x", label: "Map", disabled: true, disabledReason: "Needs a map", tooltip: "Show the map" })).toBe("Needs a map")
    expect(optionHint({ value: "x", label: "Map", disabled: true, tooltip: "Show the map" })).toBe("Show the map")
    expect(optionHint({ value: "x", label: "Map", icon: List, iconOnly: true, disabled: true, disabledReason: "Needs a map" })).toBe("Map: Needs a map")
  })

  it("show in the kit's tooltip beside the option when it is hovered, also while disabled", async () => {
    const dispose = installTitleTooltips(document)
    try {
      const { item } = mount([plain[0]!, plain[1]!, { ...plain[2]!, disabled: true, disabledReason: "Needs a map" }])
      await wait()
      item("map").dispatchEvent(new PointerEvent("pointerover", { bubbles: true }))
      await wait(350)
      const tip = document.querySelector('[role="tooltip"]')
      expect(tip?.textContent).toContain("Needs a map")
      expect(item("map").getAttribute("aria-describedby")).toBe(tip?.id)
    } finally {
      dispose()
    }
  })
})

describe("a disabled option", () => {
  const withReason: SegmentedOption<Value>[] = [plain[0]!, plain[1]!, { ...plain[2]!, disabled: true, disabledReason: "Needs a map" }]

  it("with a reason stays focusable and hoverable but is marked off", async () => {
    const { item } = mount(withReason)
    await wait()
    const off = item("map")
    expect(off.hasAttribute("disabled")).toBe(false)
    expect(off.getAttribute("aria-disabled")).toBe("true")
    expect(off.hasAttribute("data-disabled")).toBe(false) // reka's roving focus would skip an item with it
    expect(off.getAttribute("title")).toBe("Needs a map")
    expect(off.classList.contains("pointer-events-none")).toBe(false)
    off.focus()
    expect(document.activeElement).toBe(off)
    expect(isSoftOption(withReason[2]!)).toBe(true)
  })

  it("can't be picked by a click", async () => {
    const { picks, value, item } = mount(withReason)
    await wait()
    item("map").click()
    await wait()
    expect(picks).toEqual([])
    expect(value.value).toBe("list")
  })

  it("can't be picked by Space or Enter", async () => {
    const { picks, item, key } = mount(withReason)
    await wait()
    item("map").focus()
    key(item("map"), "Enter")
    key(item("map"), " ")
    item("map").click() // what a browser does after Space
    await wait()
    expect(picks).toEqual([])
  })

  it("is landed on by the arrow keys, without being picked", async () => {
    const { picks, item, key } = mount(withReason)
    await wait()
    item("grid").focus()
    await wait() // reka picks a focused option only while an arrow key is down
    key(item("grid"), "ArrowRight")
    // reka picks what an arrow lands on a tick after the focus moved; wait for that
    await wait()
    expect(document.activeElement).toBe(item("map"))
    expect(picks).toEqual([])
    expect(item("map").getAttribute("aria-checked")).toBe("false")
  })

  it("without a reason is plainly disabled and skipped by the arrow keys", async () => {
    const { picks, item, key } = mount([plain[0]!, { ...plain[1]!, disabled: true }, plain[2]!])
    await wait()
    expect(item("grid").hasAttribute("disabled")).toBe(true)
    expect(item("grid").hasAttribute("aria-disabled")).toBe(false)
    item("list").focus()
    key(item("list"), "ArrowRight")
    await wait()
    expect(document.activeElement).toBe(item("map"))
    expect(picks).toEqual(["map"])
  })

  it("leaves the other options alone", async () => {
    const { picks, item } = mount(withReason)
    await wait()
    item("grid").click()
    await wait()
    expect(picks).toEqual(["grid"])
  })

  it("is not soft when the whole control is disabled", () => {
    expect(isSoftOption(withReason[2]!, true)).toBe(false)
  })
})
