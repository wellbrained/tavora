// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from "vue"
import { ariaProblems } from "../../../testing"
import { moveIndex, moveOf, recoverIndex, columnsFromBoxes } from "./moves"
import { useSlotGrid, type SlotGrid, type SlotGridOptions } from "./use-slot-grid"

describe("moveIndex", () => {
  // 3 × 3 with a hole in the middle:  a b c / d . f / g h i
  const board = ["a", "b", "c", "d", null, "f", "g", "h", "i"]
  const at = (key: string) => board.indexOf(key)
  const go = (from: string, move: Parameters<typeof moveIndex>[3], wrap = false) => board[moveIndex(board, 3, at(from), move, wrap)]

  it("moves one slot and stops at the edge", () => {
    expect(go("a", "right")).toBe("b")
    expect(go("c", "right")).toBe("c")
    expect(go("a", "up")).toBe("a")
    expect(go("g", "down")).toBe("g")
    expect(go("a", "left")).toBe("a")
  })

  it("skips a hole", () => {
    expect(go("d", "right")).toBe("f")
    expect(go("b", "down")).toBe("h")
    expect(go("h", "up")).toBe("b")
  })

  it("starts over at the other end with wrap", () => {
    expect(go("c", "right", true)).toBe("d")
    expect(go("i", "right", true)).toBe("a")
    expect(go("a", "left", true)).toBe("i")
    expect(go("a", "up", true)).toBe("g")
    expect(go("h", "down", true)).toBe("b")
  })

  it("goes to the ends of the row and the board", () => {
    expect(go("f", "rowStart")).toBe("d")
    expect(go("d", "rowEnd")).toBe("f")
    expect(go("f", "first")).toBe("a")
    expect(go("b", "last")).toBe("i")
  })

  it("treats a short last row as holes", () => {
    const short = ["a", "b", "c", "d"]
    expect(short[moveIndex(short, 3, 2, "down")]).toBe("c")
    expect(short[moveIndex(short, 3, 3, "rowEnd")]).toBe("d")
    expect(short[moveIndex(short, 3, 1, "down")]).toBe("b")
  })

  it("reads the keys", () => {
    expect(moveOf({ key: "ArrowLeft" })).toBe("left")
    expect(moveOf({ key: "Home" })).toBe("rowStart")
    expect(moveOf({ key: "End", ctrlKey: true })).toBe("last")
    expect(moveOf({ key: "ArrowLeft", ctrlKey: true })).toBeNull()
    expect(moveOf({ key: "ArrowLeft", shiftKey: true })).toBeNull()
    expect(moveOf({ key: "1" })).toBeNull()
  })

  it("finds where the focus goes after a slot left", () => {
    expect(recoverIndex(["a", "c"], 1)).toBe(1)
    expect(recoverIndex(["a", "b"], 2)).toBe(1)
    expect(recoverIndex([null, "b"], 0)).toBe(1)
    expect(recoverIndex([], 0)).toBe(-1)
  })

  it("counts the slots on the first line", () => {
    expect(columnsFromBoxes([10, 10, 10, 50, 50])).toBe(3)
    expect(columnsFromBoxes([])).toBe(1)
  })
})

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ""
})

function mount(options: Omit<SlotGridOptions<string>, "slots" | "columns"> & { slots: Ref<(string | null)[]>, columns?: number | "auto" }) {
  let grid!: SlotGrid<string>
  const Board = defineComponent({
    setup() {
      grid = useSlotGrid({ columns: 3, ...options })
      return () =>
        h("div", { ...grid.root, "aria-label": "Board" },
          options.slots.value.map((key, index) => (key == null ? h("span", { key: `hole-${index}` }) : h("button", { key, type: "button", "aria-label": key, ...grid.slot(key) }, key))))
    },
  })
  const host = document.createElement("div")
  document.body.append(host)
  app = createApp(Board)
  app.mount(host)
  return { grid, slot: (key: string) => host.querySelector<HTMLElement>(`[data-slot-key="${key}"]`)! }
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
const active = () => (document.activeElement as HTMLElement | null)?.dataset.slotKey

describe("useSlotGrid", () => {
  it("is one Tab stop, on the chosen slot", async () => {
    const selected = ref<string | null>("e")
    const { slot } = mount({ slots: ref(["a", "b", "c", "d", "e", "f"]), selected })
    await nextTick()
    const stops = [...document.querySelectorAll("[data-slot-key]")].filter((el) => el.getAttribute("tabindex") === "0")
    expect(stops.map((el) => el.getAttribute("data-slot-key"))).toEqual(["e"])
    expect(slot("e").getAttribute("aria-checked")).toBe("true")
    expect(slot("e").hasAttribute("data-selected")).toBe(true)
    expect(document.querySelector("[data-slot=slot-grid]")!.getAttribute("role")).toBe("radiogroup")
    expect(ariaProblems(document.body)).toEqual([])
  })

  it("picks the slot the arrows move to", async () => {
    const selected = ref<string | null>("a")
    const { slot } = mount({ slots: ref(["a", "b", "c", "d", "e", "f"]), selected })
    slot("a").focus()
    press("ArrowRight")
    await nextTick()
    expect(active()).toBe("b")
    expect(selected.value).toBe("b")
    press("ArrowDown")
    await nextTick()
    expect(active()).toBe("e")
    press("End", { ctrlKey: true })
    expect(active()).toBe("f")
    await nextTick()
    expect(slot("f").getAttribute("tabindex")).toBe("0")
  })

  it("leaves other keys alone", () => {
    const { slot } = mount({ slots: ref(["a", "b"]), selected: ref("a") })
    slot("a").focus()
    const event = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    slot("a").dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it("reaches a slot that is off but doesn't pick it", async () => {
    const selected = ref<string | null>("a")
    const { slot } = mount({ slots: ref(["a", "b", "c"]), selected, disabled: (key) => (key === "b" ? "Unlocks at level 3." : false) })
    slot("a").focus()
    press("ArrowRight")
    await nextTick()
    expect(active()).toBe("b")
    expect(selected.value).toBe("a")
    expect(slot("b").getAttribute("aria-disabled")).toBe("true")
    expect(slot("b").getAttribute("aria-description")).toBe("Unlocks at level 3.")
    slot("b").click()
    expect(selected.value).toBe("a")
  })

  it("only moves the focus with select none, and remembers the last slot", async () => {
    const { slot, grid } = mount({ slots: ref(["a", "b", "c"]), select: "none" })
    expect(document.querySelector("[data-slot=slot-grid]")!.getAttribute("role")).toBe("group")
    expect(slot("a").hasAttribute("role")).toBe(false)
    expect(slot("a").getAttribute("tabindex")).toBe("0")
    slot("a").focus()
    press("ArrowRight")
    await nextTick()
    expect(grid.focused.value).toBe("b")
    expect(slot("b").hasAttribute("data-selected")).toBe(false)
    expect(slot("b").getAttribute("tabindex")).toBe("0")
  })

  it("clicks a slot that is no button on Enter and Space", () => {
    let clicks = 0
    let grid!: SlotGrid<string>
    const Board = defineComponent({
      setup() {
        grid = useSlotGrid<string>({ slots: ["a", "b"], columns: 2, select: "none" })
        return () => h("div", { ...grid.root, "aria-label": "Tiles" }, ["a", "b"].map((key) => h("div", { key, role: "button", ...grid.slot(key), onClick: () => clicks++ }, key)))
      },
    })
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp(Board)
    app.mount(host)
    host.querySelector<HTMLElement>("[data-slot-key=a]")!.focus()
    press("Enter")
    press(" ")
    press(" ", { repeat: true })
    expect(clicks).toBe(2)
  })

  it("only moves the focus on Tab, without picking", async () => {
    const selected = ref<string | null>(null)
    const { slot } = mount({ slots: ref(["a", "b"]), selected })
    await nextTick()
    expect(slot("a").getAttribute("tabindex")).toBe("0")
    slot("a").focus()
    expect(selected.value).toBeNull()
    slot("a").click()
    expect(selected.value).toBe("a")
  })

  it("lets a slot that is off take no click or Enter", () => {
    let clicks = 0
    const Board = defineComponent({
      setup() {
        const grid = useSlotGrid<string>({ slots: ["a", "b"], columns: 2, select: "none", disabled: (key) => key === "b" })
        return () => h("div", { ...grid.root, "aria-label": "Tiles" }, ["a", "b"].map((key) => h("div", { key, role: "button", ...grid.slot(key), onClick: () => clicks++ }, key)))
      },
    })
    const host = document.createElement("div")
    document.body.append(host)
    app = createApp(Board)
    app.mount(host)
    const b = host.querySelector<HTMLElement>("[data-slot-key=b]")!
    b.click()
    b.focus()
    press("Enter")
    expect(clicks).toBe(0)
  })

  it("starts over at the other end with wrap", async () => {
    const { slot } = mount({ slots: ref(["a", "b", "c", "d"]), columns: 2, wrap: true, select: "none" })
    slot("b").focus()
    press("ArrowRight")
    expect(active()).toBe("c")
    press("ArrowDown")
    expect(active()).toBe("a")
  })

  it("reads the row from the page with columns auto", () => {
    const { slot } = mount({ slots: ref(["a", null, "b", "c", "d"]), columns: "auto", select: "none" })
    // Three tiles fit on a line: a, b, c on top, d below.
    const tops: Record<string, number> = { a: 0, b: 0, c: 0, d: 48 }
    for (const key of Object.keys(tops)) slot(key).getBoundingClientRect = () => ({ top: tops[key]! }) as DOMRect
    slot("a").focus()
    press("ArrowDown")
    expect(active()).toBe("d")
    press("ArrowRight")
    expect(active()).toBe("d")
  })

  it("moves the focus on when a slot is taken out in place", async () => {
    const slots = ref<(string | null)[]>(["a", "b", "c"])
    const { slot } = mount({ slots, select: "none" })
    slot("b").focus()
    slots.value.splice(1, 1)
    await nextTick()
    await nextTick()
    expect(active()).toBe("c")
  })

  it("leaves the focus on the page when the slot used last goes later", async () => {
    const slots = ref<(string | null)[]>(["a", "b"])
    const { slot } = mount({ slots, select: "none" })
    slot("b").focus()
    slot("b").blur()
    slots.value = ["a"]
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(document.body)
  })

  it("moves the focus on when the focused slot goes", async () => {
    const slots = ref<(string | null)[]>(["a", "b", "c"])
    const { slot } = mount({ slots, select: "none" })
    slot("b").focus()
    slots.value = ["a", "c"]
    await nextTick()
    await nextTick()
    expect(active()).toBe("c")
  })

  it("doesn't take the focus back from outside the board", async () => {
    const slots = ref<(string | null)[]>(["a", "b"])
    const { slot } = mount({ slots, select: "none" })
    slot("b").focus()
    const outside = document.createElement("button")
    document.body.append(outside)
    outside.focus()
    slots.value = ["a"]
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(outside)
  })
})
