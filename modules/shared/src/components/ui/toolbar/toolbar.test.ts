// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, h, nextTick, ref, type App, type VNodeChild } from "vue"
import { Toolbar } from "."
import { Button } from "../button"
import { Toggle, ToggleGroup } from "../toggle"
import { SegmentedControl } from "../segmented-control"
import { Separator } from "../separator"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "../popover"
import { SearchInput } from "../search-input"
import { ariaProblems } from "../../../testing"
import { isTabStop } from "../../../aria-patterns"

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

async function mount(content: () => VNodeChild, props: Record<string, unknown> = {}) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render: () => h(Toolbar, { label: "Tools", ...props }, { default: content }) })
  app.mount(root)
  await nextTick()
  await wait()
  const get = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement
  const key = async (name: string, init: KeyboardEventInit = {}) => {
    ;(document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }))
    await nextTick()
    await wait()
  }
  return { root, get, key }
}

const buttons = (...ids: string[]) => () => ids.map((id) => h(Button, { "data-testid": id, key: id }, () => id))

describe("Toolbar", () => {
  it("is a named toolbar with one Tab stop", async () => {
    const { root, get } = await mount(buttons("a", "b", "c"))
    const bar = root.querySelector("[role=toolbar]")!
    expect(bar.getAttribute("aria-label")).toBe("Tools")
    expect(bar.getAttribute("aria-orientation")).toBe("horizontal")
    // Nothing used yet: the toolbar itself takes the one Tab stop and hands it to the first item.
    expect(["a", "b", "c"].map((id) => get(id).tabIndex)).toEqual([-1, -1, -1])
    expect((bar as HTMLElement).tabIndex).toBe(0)
  })

  it("moves with the arrows, starts over at the ends and jumps with Home and End", async () => {
    const { get, key } = await mount(buttons("a", "b", "c"))
    get("a").focus()
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("b"))
    await key("ArrowRight")
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("a"))
    await key("ArrowLeft")
    expect(document.activeElement).toBe(get("c"))
    await key("Home")
    expect(document.activeElement).toBe(get("a"))
    await key("End")
    expect(document.activeElement).toBe(get("c"))
    expect(get("c").tabIndex).toBe(0)
    expect(get("a").tabIndex).toBe(-1)
  })

  it("keeps a switched-off button reachable and announced as off", async () => {
    const { get, key } = await mount(() => [h(Button, { "data-testid": "a" }, () => "a"), h(Button, { "data-testid": "b", disabled: true }, () => "b"), h(Button, { "data-testid": "c" }, () => "c")])
    expect(get("b").hasAttribute("disabled")).toBe(false)
    expect(get("b").getAttribute("aria-disabled")).toBe("true")
    get("a").focus()
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("b"))
  })

  it("leaves a Button outside a toolbar as it was", async () => {
    const root = document.createElement("div")
    document.body.append(root)
    const off = ref(true)
    app = createApp({ render: () => h(Button, { "data-testid": "x", disabled: off.value }, () => "x") })
    app.mount(root)
    await wait()
    const button = root.querySelector("[data-testid=x]") as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.hasAttribute("tabindex")).toBe(false)
  })

  it("puts a Toggle and a ToggleGroup's buttons on the same ring, pressing only with Space or Enter", async () => {
    const formats = ref<string[]>([])
    const { get, key } = await mount(() => [
      h(Toggle, { label: "Pin", "data-testid": "pin" }, () => "P"),
      h(ToggleGroup, {
        label: "Style",
        modelValue: formats.value,
        "onUpdate:modelValue": (next: string[]) => (formats.value = next),
        options: [
          { value: "bold", label: "Bold", text: "B", testid: "bold" },
          { value: "italic", label: "Italic", text: "I", testid: "italic" },
        ],
      }),
      h(Button, { "data-testid": "end" }, () => "end"),
    ])
    get("pin").focus()
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("bold"))
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("italic"))
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("end"))
    expect(formats.value).toEqual([])
    get("italic").click()
    await nextTick()
    expect(formats.value).toEqual(["italic"])
  })

  it("moves through a SegmentedControl without changing the choice; a click or Space picks", async () => {
    const view = ref("list")
    const { root, get, key } = await mount(() => [
      h(Button, { "data-testid": "first" }, () => "first"),
      h(SegmentedControl, {
        label: "View",
        modelValue: view.value,
        "onUpdate:modelValue": (next: string) => (view.value = next),
        options: [
          { value: "list", label: "List", testid: "list" },
          { value: "grid", label: "Grid", testid: "grid" },
          { value: "map", label: "Map", testid: "map", disabled: true },
        ],
      }),
      h(Button, { "data-testid": "last" }, () => "last"),
    ])
    get("first").focus()
    await key("ArrowRight")
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("grid"))
    expect(view.value).toBe("list")
    // A plainly switched-off option is skipped.
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("last"))
    get("grid").click()
    await nextTick()
    expect(view.value).toBe("grid")
    expect(get("grid").getAttribute("aria-checked")).toBe("true")
    expect(root.querySelector("[role=radiogroup]")?.getAttribute("aria-label")).toBe("View")
    expect(ariaProblems(root)).toEqual([])
  })

  it("stands a Separator upright in a row and keeps it out of the keys", async () => {
    const { root } = await mount(() => [h(Button, () => "a"), h(Separator), h(Button, () => "b")])
    const line = root.querySelector("[data-slot=separator]")!
    expect(line.getAttribute("data-orientation")).toBe("vertical")
    expect(line.hasAttribute("tabindex")).toBe(false)
  })

  it("opens a menu with ↓ in a row, and moves on with ↓ in a column", async () => {
    const menu = () =>
      h(DropdownMenu, null, () => [
        h(DropdownMenuTrigger, { asChild: true }, () => h(Button, { "data-testid": "more" }, () => "more")),
        h(DropdownMenuContent, null, () => h(DropdownMenuItem, () => "Rename")),
      ])
    const row = await mount(() => [menu(), h(Button, { "data-testid": "next" }, () => "next")])
    row.get("more").focus()
    await row.key("ArrowDown")
    expect(row.get("more").getAttribute("aria-expanded")).toBe("true")
    app!.unmount()
    document.body.innerHTML = ""

    const column = await mount(() => [menu(), h(Button, { "data-testid": "next" }, () => "next")], { orientation: "vertical" })
    expect(column.root.querySelector("[role=toolbar]")!.getAttribute("aria-orientation")).toBe("vertical")
    column.get("more").focus()
    await column.key("ArrowDown")
    expect(column.get("more").getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(column.get("next"))
    await column.key("ArrowDown")
    expect(document.activeElement).toBe(column.get("more"))
  })

  it("leaves what a toolbar opens, and a field's own buttons, out of its keys", async () => {
    const text = ref("abc")
    const { root, get } = await mount(() => [
      h(Popover, { open: true }, () => [
        h(PopoverTrigger, { asChild: true }, () => h(Button, { "data-testid": "open" }, () => "open")),
        h(PopoverContent, null, () => h(Button, { "data-testid": "inside" }, () => "inside")),
      ]),
      h(SearchInput, { modelValue: text.value, "onUpdate:modelValue": (next: string) => (text.value = next), label: "Find", "data-testid": "find" }),
    ])
    await wait()
    expect(get("open").hasAttribute("data-toolbar-item")).toBe(true)
    const inside = document.querySelector("[data-testid=inside]") as HTMLElement
    expect(inside).toBeTruthy()
    expect(inside.hasAttribute("data-toolbar-item")).toBe(false)
    expect(root.querySelectorAll("[data-toolbar-item]").length).toBe(1)
  })

  it("moves with ↑ and ↓ in a column, starting over at the ends", async () => {
    const { get, key } = await mount(buttons("a", "b", "c"), { orientation: "vertical" })
    get("a").focus()
    await key("ArrowDown")
    expect(document.activeElement).toBe(get("b"))
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("b"))
    await key("ArrowUp")
    await key("ArrowUp")
    expect(document.activeElement).toBe(get("c"))
    await key("Home")
    expect(document.activeElement).toBe(get("a"))
    await key("End")
    expect(document.activeElement).toBe(get("c"))
  })

  it("keeps a field as a Tab stop of its own, out of the arrow keys", async () => {
    const text = ref("")
    const { root, get, key } = await mount(() => [
      h(Button, { "data-testid": "a" }, () => "a"),
      h(SearchInput, { modelValue: text.value, "onUpdate:modelValue": (next: string) => (text.value = next), "aria-label": "Find", "data-testid": "find" }),
    ])
    const field = root.querySelector("input") as HTMLInputElement
    expect(isTabStop(field)).toBe(true)
    expect(field.hasAttribute("data-toolbar-item")).toBe(false)
    get("a").focus()
    await key("ArrowRight")
    expect(document.activeElement).toBe(get("a"))
  })
})
