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

  it("lets Shift+Tab from a field leave the toolbar instead of landing on a tool after it", async () => {
    const text = ref("")
    const { root } = await mount(() => [
      h(SearchInput, { modelValue: text.value, "onUpdate:modelValue": (next: string) => (text.value = next), "aria-label": "Find" }),
      h(Button, { "data-testid": "a" }, () => "a"),
    ])
    const bar = root.querySelector("[role=toolbar]") as HTMLElement
    const field = root.querySelector("input") as HTMLInputElement
    expect(bar.tabIndex).toBe(0)
    field.focus()
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }))
    // While the browser moves the focus back, the toolbar's own element is no stop; then it is again.
    expect(bar.tabIndex).toBe(-1)
    await wait()
    expect(bar.tabIndex).toBe(0)
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

describe("Toolbar Tab stops with fields", () => {
  const search = (id: string) => h(SearchInput, { modelValue: "", "onUpdate:modelValue": () => {}, "aria-label": id, "data-testid": id })
  // Tab moves along the page's tab stops in DOM order; where it lands on the toolbar's own element, that hands the focus on.
  const tabbable = () => [...document.querySelectorAll<HTMLElement>("input, button, [tabindex]")].filter((element) => element.tabIndex >= 0)
  async function tab(from: HTMLElement | null, back = false) {
    const stops = tabbable()
    if (from) {
      const down = new KeyboardEvent("keydown", { key: "Tab", shiftKey: back, bubbles: true, cancelable: true })
      // A handler that takes the key over has put the focus where it wants it.
      if (!from.dispatchEvent(down)) return document.activeElement
    }
    const at = from ? stops.indexOf(from) : -1
    const next = stops[back ? (at < 0 ? stops.length : at) - 1 : at + 1]
    next?.focus()
    await nextTick()
    await wait()
    return document.activeElement
  }
  async function page(content: () => VNodeChild) {
    const root = document.createElement("div")
    document.body.append(root)
    app = createApp({ render: () => h("div", [h("button", { "data-testid": "before" }, "before"), h(Toolbar, { label: "Tools" }, { default: content }), h("button", { "data-testid": "after" }, "after")]) })
    app.mount(root)
    await nextTick()
    await wait()
    const get = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement
    return { get }
  }

  it("lands on a field before the first tool, then the tool, then out", async () => {
    const { get } = await page(() => [search("find"), h(Button, { "data-testid": "a" }, () => "a"), h(Button, { "data-testid": "b" }, () => "b")])
    get("before").focus()
    expect(await tab(get("before"))).toBe(get("find"))
    expect(await tab(get("find"))).toBe(get("a"))
    expect(await tab(get("a"))).toBe(get("after"))
  })

  it("goes back to a tool used before and on to the field before it", async () => {
    const { get } = await page(() => [search("find"), h(Button, { "data-testid": "a" }, () => "a"), h(Button, { "data-testid": "b" }, () => "b")])
    get("b").focus()
    await wait()
    get("after").focus()
    expect(await tab(get("after"), true)).toBe(get("b"))
    expect(await tab(get("b"), true)).toBe(get("find"))
  })

  it("keeps a field after the last tool a stop of its own", async () => {
    const { get } = await page(() => [h(Button, { "data-testid": "a" }, () => "a"), h(Button, { "data-testid": "b" }, () => "b"), search("find")])
    expect(await tab(get("before"))).toBe(get("a"))
    expect(await tab(get("a"))).toBe(get("find"))
    expect(await tab(get("find"))).toBe(get("after"))
    // And back: the field after the tools is the last stop, then the tool used last.
    get("after").focus()
    expect(await tab(get("after"), true)).toBe(get("find"))
  })

  it("keeps a field between tools a stop of its own", async () => {
    const { get } = await page(() => [h(Button, { "data-testid": "a" }, () => "a"), search("find"), h(Button, { "data-testid": "b" }, () => "b")])
    expect(await tab(get("before"))).toBe(get("a"))
    expect(await tab(get("a"))).toBe(get("find"))
    expect(await tab(get("find"), true)).toBe(get("a"))
  })

  it("lands on a leading field first even once a later tool was used", async () => {
    const { get } = await page(() => [search("find"), h(Button, { "data-testid": "a" }, () => "a"), h(Button, { "data-testid": "b" }, () => "b")])
    get("a").focus()
    get("a").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))
    await wait()
    expect(document.activeElement).toBe(get("b"))
    get("before").focus()
    expect(await tab(get("before"))).toBe(get("find"))
    expect(await tab(get("find"))).toBe(get("b"))
  })

  it("lands on a leading field that is a select-like button", async () => {
    const { get } = await page(() => [h("button", { role: "combobox", "aria-label": "World", "data-testid": "world" }, "World"), h(Button, { "data-testid": "a" }, () => "a")])
    expect(await tab(get("before"))).toBe(get("world"))
    expect(await tab(get("world"))).toBe(get("a"))
  })
})

describe("Toolbar looks", () => {
  async function mountLook(props: Record<string, unknown>, below?: () => VNodeChild) {
    const root = document.createElement("div")
    document.body.append(root)
    const slots: Record<string, () => VNodeChild> = { default: buttons("a", "b") }
    if (below) slots.below = below
    app = createApp({ render: () => h(Toolbar, { label: "Tools", ...props }, slots) })
    app.mount(root)
    await nextTick()
    await wait()
    const bar = root.querySelector("[role=toolbar]") as HTMLElement
    const get = (id: string) => root.querySelector(`[data-testid=${id}]`) as HTMLElement
    return { bar, get }
  }
  const classes = (element: Element) => element.className.split(/\s+/)

  it("has no look of its own by default", async () => {
    const { bar } = await mountLook({})
    expect(bar.dataset.variant).toBe("plain")
    expect(classes(bar)).not.toContain("bg-primary/5")
    expect(classes(bar)).not.toContain("tavora-floating")
  })

  it("is a tinted strip as a bar, a control plus 8px tall, wrapping on asking", async () => {
    const { bar } = await mountLook({ variant: "bar" })
    expect(bar.dataset.variant).toBe("bar")
    expect(classes(bar)).toEqual(expect.arrayContaining(["bg-primary/5", "border-primary/25", "border-b", "px-2", "min-h-[calc(var(--style-control-height,32px)+8px)]"]))
    expect(classes(bar)).not.toContain("flex-wrap")
    app!.unmount()
    document.body.innerHTML = ""
    const wrapped = await mountLook({ variant: "bar", wrap: true })
    expect(classes(wrapped.bar)).toEqual(expect.arrayContaining(["flex-wrap", "py-1"]))
  })

  it("has a line at its right as a column bar", async () => {
    const { bar } = await mountLook({ variant: "bar", orientation: "vertical" })
    expect(classes(bar)).toEqual(expect.arrayContaining(["bg-primary/5", "border-r", "flex-col"]))
    expect(classes(bar)).not.toContain("border-b")
  })

  it("puts the below rows under the tools, all in the one toolbar", async () => {
    const { bar, get } = await mountLook({ variant: "bar" }, () => h("div", { "data-testid": "status" }, [h(Button, { "data-testid": "c" }, () => "c")]))
    expect(classes(bar)).toEqual(expect.arrayContaining(["flex-col", "border-b", "p-2"]))
    const row = bar.querySelector("[data-slot=toolbar-row]")!
    expect(row.contains(get("a"))).toBe(true)
    expect(row.nextElementSibling).toBe(get("status"))
    // The row under the tools is still part of the arrow keys.
    get("b").focus()
    ;(document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }))
    await nextTick()
    await wait()
    expect(document.activeElement).toBe(get("c"))
  })

  it("stacks the below rows in a plain toolbar too, without a strip", async () => {
    const { bar, get } = await mountLook({}, () => h("span", { "data-testid": "status" }, "3 shown"))
    expect(bar.querySelector("[data-slot=toolbar-row]")!.nextElementSibling).toBe(get("status"))
    expect(classes(bar)).toContain("flex-col")
    expect(classes(bar)).not.toContain("bg-primary/5")
  })

  it("stacks and unstacks when its below rows come and go", async () => {
    const root = document.createElement("div")
    document.body.append(root)
    const searching = ref(false)
    app = createApp({
      render: () =>
        h(Toolbar, { label: "Tools", variant: "bar" }, {
          default: buttons("a"),
          ...(searching.value ? { below: () => h("div", { "data-testid": "find" }, "find") } : {}),
        }),
    })
    app.mount(root)
    await nextTick()
    const bar = root.querySelector("[role=toolbar]") as HTMLElement
    expect(bar.querySelector("[data-slot=toolbar-row]")).toBeNull()
    searching.value = true
    await nextTick()
    expect(bar.querySelector("[data-slot=toolbar-row]")).not.toBeNull()
    expect(bar.querySelector("[data-testid=find]")).not.toBeNull()
    expect(classes(bar)).toContain("flex-col")
    searching.value = false
    await nextTick()
    expect(bar.querySelector("[data-slot=toolbar-row]")).toBeNull()
    expect(classes(bar)).not.toContain("flex-col")
  })

  it("takes the floating surface over a map or canvas", async () => {
    const { bar } = await mountLook({ variant: "floating", class: "absolute top-2 right-2" })
    expect(bar.dataset.variant).toBe("floating")
    expect(classes(bar)).toEqual(expect.arrayContaining(["tavora-floating", "p-1", "gap-0.5", "absolute"]))
    expect(classes(bar)).not.toContain("gap-1")
    expect(classes(bar)).not.toContain("bg-primary/5")
  })
})
