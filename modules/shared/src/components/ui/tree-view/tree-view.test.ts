// @vitest-environment jsdom
// TreeView: what it announces, what a press does in each selection mode, the keys, `*`, the tab stop and the row slot.
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import { ariaProblems } from "../../../testing"
import { collapseAll, expandAll, TreeView, type TreeNode } from "."

const ITEMS: TreeNode[] = [
  { id: "start", label: "Getting started", badge: 2, children: [{ id: "install", label: "Install Tavora" }, { id: "panel", label: "Your first panel" }] },
  {
    id: "modules",
    label: "Modules",
    children: [
      { id: "built-in", label: "Built-in modules", children: [{ id: "notes", label: "Notes" }] },
      { id: "own", label: "Make your own", children: [{ id: "rules", label: "The module rules" }] },
    ],
  },
  { id: "settings", label: "Settings" },
]

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))
let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.replaceChildren()
})

function mount(props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const picked = ref<string | null>((props.modelValue as string | undefined) ?? null)
  const expanded = ref<string[]>((props.expanded as string[] | undefined) ?? [])
  const select = vi.fn()
  app = createApp({
    render: () =>
      h(
        TreeView,
        {
          items: ITEMS,
          label: "Guide",
          ...props,
          modelValue: picked.value,
          "onUpdate:modelValue": (id: string) => (picked.value = id),
          expanded: expanded.value,
          "onUpdate:expanded": (ids: string[]) => (expanded.value = ids),
          onSelect: select,
        },
        slots,
      ),
  })
  app.mount(host)
  const row = (id: string) => host.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)
  const shown = () => [...host.querySelectorAll<HTMLElement>("[role=treeitem]")].map((el) => el.dataset.treeId)
  const key = async (key: string) => {
    ;(document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
    await wait()
  }
  return { host, row, shown, key, picked, expanded, select }
}

describe("TreeView", () => {
  it("is a named tree whose rows say their level and place, and shows only open branches", async () => {
    const t = mount({ expanded: ["start"] })
    await wait()
    const tree = t.host.querySelector("[role=tree]")!
    expect(tree.getAttribute("aria-label")).toBe("Guide")
    expect(t.shown()).toEqual(["start", "install", "panel", "modules", "settings"])
    const panel = t.row("panel")!
    expect(panel.getAttribute("aria-level")).toBe("2")
    expect(panel.getAttribute("aria-posinset")).toBe("2")
    expect(panel.getAttribute("aria-setsize")).toBe("2")
    expect(t.row("start")!.getAttribute("aria-expanded")).toBe("true")
    expect(t.row("modules")!.getAttribute("aria-expanded")).toBe("false")
    expect(t.row("settings")!.hasAttribute("aria-expanded")).toBe(false)
    expect(t.row("install")!.closest("[role=group]")).not.toBeNull()
    expect(ariaProblems(t.host)).toEqual([])
  })

  it("starts with everything open with default-expanded all", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp({ render: () => h(TreeView, { items: ITEMS, label: "Guide", defaultExpanded: "all" }) })
    app.mount(host)
    await wait()
    expect(host.querySelectorAll("[role=treeitem]")).toHaveLength(9)
  })

  it("picks a row on a press and opens a branch only from its chevron", async () => {
    const t = mount()
    await wait()
    t.row("start")!.click()
    await wait()
    expect(t.picked.value).toBe("start")
    expect(t.select).toHaveBeenLastCalledWith("start")
    expect(t.expanded.value).toEqual([])
    expect(t.row("start")!.getAttribute("aria-selected")).toBe("true")
    ;(t.row("start")!.querySelector("[data-tree-chevron]") as HTMLElement).click()
    await wait()
    expect(t.expanded.value).toEqual(["start"])
    expect(t.select).toHaveBeenCalledTimes(1)
    // A second press keeps the pick and says so again (an outline opens its page again).
    t.row("start")!.click()
    await wait()
    expect(t.picked.value).toBe("start")
    expect(t.select).toHaveBeenCalledTimes(2)
  })

  it("picks nothing with selection none: a press on a branch opens it, Enter too", async () => {
    const t = mount({ selection: "none" })
    await wait()
    t.row("start")!.click()
    await wait()
    expect(t.expanded.value).toEqual(["start"])
    expect(t.picked.value).toBeNull()
    expect(t.select).toHaveBeenLastCalledWith("start")
    expect(t.host.querySelector("[aria-selected]")).toBeNull()
    t.row("modules")!.focus()
    await t.key("Enter")
    expect(t.expanded.value).toEqual(["start", "modules"])
  })

  it("moves with the arrow keys: down, right opens then goes in, left goes to the parent then closes", async () => {
    const t = mount()
    await wait()
    t.row("start")!.focus()
    await t.key("ArrowDown")
    expect(document.activeElement).toBe(t.row("modules"))
    await t.key("ArrowRight")
    expect(t.expanded.value).toEqual(["modules"])
    await t.key("ArrowRight")
    expect(document.activeElement).toBe(t.row("built-in"))
    await t.key("ArrowLeft")
    expect(document.activeElement).toBe(t.row("modules"))
    await t.key("ArrowLeft")
    expect(t.expanded.value).toEqual([])
    await t.key("End")
    expect(document.activeElement).toBe(t.row("settings"))
  })

  it("opens every branch beside the focused row with *, without motion", async () => {
    const t = mount({ expanded: ["modules"] })
    await wait()
    t.row("built-in")!.focus()
    await t.key("*")
    expect(t.expanded.value).toEqual(["modules", "built-in", "own"])
    expect(t.host.querySelector("[data-slot=tree-view]")!.hasAttribute("data-tree-instant")).toBe(true)
  })

  it("leaves * to a field inside a row", async () => {
    const t = mount({ expanded: ["modules"] }, { row: ({ item }: { item: TreeNode }) => (item.id === "built-in" ? h("input", { "data-test": "rename" }) : item.label) })
    await wait()
    const input = t.row("built-in")!.querySelector<HTMLInputElement>("[data-test=rename]")!
    input.focus()
    const event = new KeyboardEvent("keydown", { key: "*", bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    await wait()
    expect(event.defaultPrevented).toBe(false)
    expect(t.expanded.value).toEqual(["modules"])
  })

  it("closes many branches at once without motion, and they leave the page", async () => {
    const style = document.createElement("style")
    style.textContent = ".tavora-collapse[data-state=closed] { animation-name: tavora-collapse-out; } [data-tree-instant] .tavora-collapse[data-armed] { animation-name: none !important; }"
    document.head.append(style)
    const t = mount({ expanded: expandAll(ITEMS) })
    await wait()
    t.expanded.value = collapseAll()
    await nextTick()
    expect(t.host.querySelector("[data-slot=tree-view]")!.hasAttribute("data-tree-instant")).toBe(true)
    await wait(80)
    expect(t.shown()).toEqual(["start", "modules", "settings"])
    style.remove()
  })

  it("skips a disabled row with the keys and takes no press on it", async () => {
    const items: TreeNode[] = [{ id: "a", label: "A" }, { id: "b", label: "B", disabled: true }, { id: "c", label: "C" }]
    const t = mount({ items })
    await wait()
    t.row("b")!.click()
    await wait()
    expect(t.select).not.toHaveBeenCalled()
    expect(t.picked.value).toBeNull()
    t.row("a")!.focus()
    await t.key("ArrowDown")
    expect(document.activeElement).toBe(t.row("c"))
  })

  it("lands Tab on the picked row", async () => {
    const t = mount({ expanded: ["start"], modelValue: "panel" })
    await wait()
    const tree = t.host.querySelector<HTMLElement>("[role=tree]")!
    tree.focus()
    await wait()
    expect(document.activeElement).toBe(t.row("panel"))
  })

  it("draws a row's content from the row slot, after the kit's chevron", async () => {
    const row = vi.fn(({ item, level, branch, expanded, selected }) => h("span", { "data-test": "own" }, `${item.label}:${level}:${branch}:${expanded}:${selected}`))
    const t = mount({ expanded: ["start"], modelValue: "start" }, { row })
    await wait()
    expect(t.row("start")!.querySelector("[data-tree-chevron]")).not.toBeNull()
    expect(t.row("start")!.querySelector("[data-test=own]")!.textContent).toBe("Getting started:1:true:true:true")
    expect(t.row("install")!.querySelector("[data-test=own]")!.textContent).toBe("Install Tavora:2:false:false:false")
  })

  it("follows a v-model:expanded change from outside", async () => {
    const t = mount()
    await wait()
    t.expanded.value = expandAll(ITEMS)
    await nextTick()
    await wait()
    expect(t.shown()).toHaveLength(9)
    t.expanded.value = collapseAll()
    await wait()
    expect(t.shown()).toEqual(["start", "modules", "settings"])
  })
})

describe("expandAll", () => {
  it("lists every branch, deep ones too, and no leaf", () => {
    expect(expandAll(ITEMS)).toEqual(["start", "modules", "built-in", "own"])
  })
})
