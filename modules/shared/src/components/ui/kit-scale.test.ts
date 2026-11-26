// @vitest-environment jsdom
// The kit's one size scale (sm | default | lg from the control height), `fill`, EmptyState's frame, and the names that
// say "bad" (`destructive`) and "busy" (`busy` / `loading`), with the old names still read for one round.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App, type VNodeChild } from "vue"
import { Save } from "@lucide/vue"
import { CONTROL_HEIGHT, controlSize } from "../../lib/control-size"
import { Input } from "./input"
import { SearchInput } from "./search-input"
import { NumberField } from "./number-field"
import { SelectTrigger, Select } from "./select"
import { Picker } from "./picker"
import { SegmentedControl } from "./segmented-control"
import { ListRow } from "./list-row"
import { TreeView } from "./tree-view"
import { StarRating } from "./star-rating"
import { TagInput } from "./tag-input"
import { EmptyState } from "./empty-state"
import { Notice } from "./notice"
import { DialogButton } from "./dialog"
import { GameCover } from "./game-cover"

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})
async function mount(render: () => VNodeChild) {
  const root = document.createElement("div")
  document.body.append(root)
  app = createApp({ render })
  app.mount(root)
  await nextTick()
  await wait()
  return root
}
const has = (element: Element | null, cls: string) => [...(element?.classList ?? [])].includes(cls)
const SM = "h-[calc(var(--style-control-height,32px)-4px)]"
const LG = "h-[calc(var(--style-control-height,32px)+8px)]"

describe("size scale", () => {
  it("reads every name, and the old `md` as default", () => {
    expect(controlSize("sm")).toBe("sm")
    expect(controlSize("lg")).toBe("lg")
    expect(controlSize("md")).toBe("default")
    expect(controlSize(undefined)).toBe("default")
    expect(CONTROL_HEIGHT.default).toBe("h-[var(--style-control-height,32px)]")
  })

  it("sizes the fields like a Button", async () => {
    const root = await mount(() => [
      h(Input, { size: "sm", "data-testid": "input" }),
      h(SearchInput, { size: "lg", "data-testid": "search" }),
      h(NumberField, { size: "sm", modelValue: 1, "data-testid": "number" }),
      h(Select, null, () => h(SelectTrigger, { size: "lg", "data-testid": "select" }, () => "x")),
    ])
    expect(has(root.querySelector("[data-testid=input]"), SM)).toBe(true)
    expect(has(root.querySelector("[data-testid=search]"), LG)).toBe(true)
    const number = root.querySelector("[data-testid=number]")!
    expect(has(number, SM)).toBe(true)
    expect(has(number.querySelector("[data-slot=number-field-increment]"), "size-[calc(var(--style-control-height,32px)-4px)]")).toBe(true)
    expect(root.querySelector("[data-testid=select]")?.getAttribute("data-size")).toBe("lg")
  })

  it("keeps a field's default height when no size is given", async () => {
    const root = await mount(() => h(Input, { "data-testid": "input" }))
    const input = root.querySelector("[data-testid=input]")!
    expect(has(input, "h-[var(--style-control-height,32px)]")).toBe(true)
    expect(has(input, SM)).toBe(false)
  })

  it("passes the size to a Picker's button", async () => {
    const root = await mount(() => h(Picker, { label: "Map", size: "sm", modelValue: "a", options: [{ value: "a", label: "A" }] }))
    expect(root.querySelector("[data-slot=button]")?.getAttribute("data-size")).toBe("sm")
  })

  it("makes a SegmentedControl as tall as the size, inside its edge", async () => {
    const root = await mount(() => [
      h(SegmentedControl, { label: "View", modelValue: "a", options: [{ value: "a", label: "A", testid: "default" }] }),
      h(SegmentedControl, { label: "View", size: "sm", modelValue: "a", options: [{ value: "a", label: "A", testid: "sm" }] }),
    ])
    expect(has(root.querySelector("[data-testid=default]"), "h-[calc(var(--style-control-height,32px)-6px)]")).toBe(true)
    expect(has(root.querySelector("[data-testid=sm]"), "h-[calc(var(--style-control-height,32px)-10px)]")).toBe(true)
  })

  it("gives list and tree rows the control height, and a dense tree 4px less", async () => {
    const root = await mount(() => [
      h(ListRow, { "data-testid": "row" }, () => "Notes"),
      h(ListRow, { size: "lg", "data-testid": "big" }, () => "Notes"),
      h(TreeView, { label: "Files", items: [{ id: "a", label: "A" }], "data-testid": "tree" }),
      h(TreeView, { label: "Files", size: "sm", items: [{ id: "b", label: "B" }], "data-testid": "dense" }),
    ])
    expect(has(root.querySelector("[data-testid=row]"), "min-h-[var(--style-control-height,32px)]")).toBe(true)
    expect(has(root.querySelector("[data-testid=big]"), "min-h-[calc(var(--style-control-height,32px)+8px)]")).toBe(true)
    const rows = root.querySelectorAll("[data-slot=tree-row]")
    expect(has(rows[0]!, "min-h-[var(--style-control-height,32px)]")).toBe(true)
    expect(has(rows[1]!, "min-h-[calc(var(--style-control-height,32px)-4px)]")).toBe(true)
  })

  it("sizes stars and tags on the same names", async () => {
    const root = await mount(() => [
      h(StarRating, { label: "3 of 5", modelValue: 3, size: "md", "data-testid": "md" }),
      h(StarRating, { label: "3 of 5", modelValue: 3, "data-testid": "plain" }),
      h(TagInput, { modelValue: [], size: "sm" }),
    ])
    expect(has(root.querySelector("[data-testid=md] svg"), "size-4")).toBe(true)
    expect(has(root.querySelector("[data-testid=plain] svg"), "size-4")).toBe(true)
    expect(has(root.querySelector("[data-slot=tag-input]"), "min-h-[calc(var(--style-control-height,32px)-4px)]")).toBe(true)
  })
})

describe("fill", () => {
  it("stretches a SegmentedControl with equal options, never under their labels", async () => {
    const root = await mount(() =>
      h(SegmentedControl, { label: "Level", fill: true, modelValue: "a", options: [{ value: "a", label: "Easy", testid: "a" }, { value: "b", label: "Expert", testid: "b" }] }),
    )
    expect(has(root.querySelector("[data-slot=segmented-control]"), "w-full")).toBe(true)
    const item = root.querySelector("[data-testid=b]")!
    expect(has(item, "flex-1")).toBe(true)
    expect(has(item, "min-w-0")).toBe(false)
    expect(item.textContent).toBe("Expert")
  })

  it("leaves a SegmentedControl its own width without it", async () => {
    const root = await mount(() => h(SegmentedControl, { label: "Level", modelValue: "a", options: [{ value: "a", label: "Easy", testid: "a" }] }))
    expect(has(root.querySelector("[data-slot=segmented-control]"), "w-full")).toBe(false)
    expect(has(root.querySelector("[data-testid=a]"), "flex-1")).toBe(false)
  })
})

describe("EmptyState", () => {
  it("has a dashed frame by default, none when bare, and fills the free height with fill", async () => {
    const root = await mount(() => [
      h(EmptyState, { title: "Nothing", "data-testid": "framed" }),
      h(EmptyState, { title: "Nothing", variant: "bare", fill: true, "data-testid": "bare" }),
    ])
    const framed = root.querySelector("[data-testid=framed]")!
    const bare = root.querySelector("[data-testid=bare]")!
    expect(has(framed, "border-dashed")).toBe(true)
    expect(framed.getAttribute("data-variant")).toBe("framed")
    expect(has(bare, "border-dashed")).toBe(false)
    expect(has(bare, "flex-1")).toBe(true)
    expect(has(bare, "justify-center")).toBe(true)
  })
})

describe("names", () => {
  it("Notice says destructive, and still reads error", async () => {
    const root = await mount(() => [h(Notice, { variant: "destructive", title: "a", "data-testid": "new" }), h(Notice, { variant: "error", title: "b", "data-testid": "old" })])
    for (const id of ["new", "old"]) {
      const notice = root.querySelector(`[data-testid=${id}]`)!
      expect(notice.getAttribute("data-variant")).toBe("destructive")
      expect(notice.getAttribute("role")).toBe("alert")
      expect(has(notice, "bg-destructive/10")).toBe(true)
    }
  })

  it("GameCover says loading, and still reads pending", async () => {
    // While the art is still looked for, the fallback stays away.
    const fallback = { fallback: () => "F" }
    const root = await mount(() => [
      h("div", { "data-testid": "new" }, h(GameCover, { loading: true }, fallback)),
      h("div", { "data-testid": "old" }, h(GameCover, { pending: true }, fallback)),
      h("div", { "data-testid": "none" }, h(GameCover, null, fallback)),
    ])
    expect(root.querySelector("[data-testid=new]")?.textContent).toBe("")
    expect(root.querySelector("[data-testid=old]")?.textContent).toBe("")
    expect(root.querySelector("[data-testid=none]")?.textContent).toBe("F")
  })
})

describe("DialogButton", () => {
  it("is busy with a spinner, takes no press and still reads loading", async () => {
    const pressed = vi.fn()
    const root = await mount(() => [
      h(DialogButton, { icon: Save, busy: true, onClick: pressed, "data-testid": "busy" }, () => "Save"),
      h(DialogButton, { icon: Save, loading: true, onClick: pressed, "data-testid": "loading" }, () => "Save"),
    ])
    for (const id of ["busy", "loading"]) {
      const button = root.querySelector(`[data-testid=${id}]`) as HTMLButtonElement
      expect(button.getAttribute("aria-busy")).toBe("true")
      expect(button.querySelector(".tavora-spin")).not.toBeNull()
      button.click()
    }
    expect(pressed).not.toHaveBeenCalled()
  })

  it("runs an action like a Button", async () => {
    let finish = () => {}
    const action = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const root = await mount(() => h(DialogButton, { icon: Save, action }, () => "Save"))
    const button = root.querySelector("button")!
    button.click()
    await nextTick()
    expect(action).toHaveBeenCalledTimes(1)
    expect(button.getAttribute("aria-busy")).toBe("true")
    button.click()
    expect(action).toHaveBeenCalledTimes(1)
    finish()
    await wait()
    expect(button.getAttribute("aria-busy")).toBeNull()
  })

  it("is not busy by default", async () => {
    const busy = ref(false)
    const root = await mount(() => h(DialogButton, { icon: Save, busy: busy.value }, () => "Save"))
    expect(root.querySelector("button")?.hasAttribute("aria-busy")).toBe(false)
    expect(root.querySelector(".tavora-spin")).toBeNull()
  })
})
