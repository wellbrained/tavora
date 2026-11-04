// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { DataGrid, cell, rangeOf, single, type FillPlan, type GridEdit, type GridRange, type GridSelection } from "."

// jsdom has no layout: the grid's box is made up, as in the ZoomPane tests.
const box = { width: 600, height: 300 }
const flush = async () => {
  for (let step = 0; step < 4; step++) await nextTick()
}

let app: App | undefined
let host: HTMLElement
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: () => void) {}
    observe() {
      this.callback()
    }
    disconnect() {}
  })
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => box.width })
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => box.height })
  host = document.createElement("div")
  document.body.append(host)
})
afterEach(() => {
  app?.unmount()
  app = undefined
  host.remove()
  vi.unstubAllGlobals()
})

interface Mounted {
  root: HTMLElement
  selection: { value: GridSelection }
  editing: { value: GridEdit | null }
  commits: Array<[number, number, string]>
  clears: GridRange[]
  fills: FillPlan[]
}

async function mount(options: { rows?: number; cols?: number; readonly?: boolean; frozenRows?: number; data?: Map<string, string> } = {}): Promise<Mounted> {
  const data = options.data ?? new Map<string, string>()
  const selection = ref<GridSelection>(single(cell(0, 0)))
  const editing = ref<GridEdit | null>(null)
  const result: Mounted = { root: null as unknown as HTMLElement, selection, editing, commits: [], clears: [], fills: [] }
  const Host = defineComponent(() => () =>
    h(DataGrid, {
      rows: options.rows ?? 10_000,
      cols: options.cols ?? 26,
      readonly: options.readonly ?? false,
      frozenRows: options.frozenRows ?? 0,
      text: (row: number, col: number) => data.get(`${row}:${col}`) ?? "",
      selection: selection.value,
      "onUpdate:selection": (next: GridSelection) => (selection.value = next),
      editing: editing.value,
      "onUpdate:editing": (next: GridEdit | null) => (editing.value = next),
      onCommit: (pos: { row: number; col: number }, text: string) => result.commits.push([pos.row, pos.col, text]),
      onClear: (range: GridRange) => result.clears.push(range),
      onFill: (plan: FillPlan) => result.fills.push(plan),
    }),
  )
  app = createApp(Host)
  app.mount(host)
  await flush()
  result.root = host.querySelector<HTMLElement>("[data-slot=data-grid]")!
  return result
}

const press = async (target: HTMLElement, key: string, mods: KeyboardEventInit = {}) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }))
  await flush()
}

describe("DataGrid", () => {
  it("draws only the rows and columns in view", async () => {
    const { root } = await mount({ rows: 10_000 })
    const cells = root.querySelectorAll("[data-cell]")
    // 300 px tall at 28 px a row is about 10 rows; 600 px wide at 96 px a column about 6. Plus a little overscan.
    expect(cells.length).toBeGreaterThan(20)
    expect(cells.length).toBeLessThan(200)
    expect(root.querySelector("[data-cell='9999:0']")).toBeNull()
    expect(root.querySelector("[data-header=column]")?.textContent?.trim()).toBe("A")
  })

  it("opens a 10,000-row sheet quickly", async () => {
    const data = new Map<string, string>()
    for (let row = 0; row < 10_000; row++) data.set(`${row}:0`, `Item ${row}`)
    const started = performance.now()
    await mount({ rows: 10_000, data })
    expect(performance.now() - started).toBeLessThan(300)
  })

  it("moves with the arrows and grows with Shift", async () => {
    const grid = await mount()
    await press(grid.root, "ArrowDown")
    await press(grid.root, "ArrowRight")
    expect(grid.selection.value.active).toEqual(cell(1, 1))
    await press(grid.root, "ArrowDown", { shiftKey: true })
    expect(rangeOf(grid.selection.value)).toEqual({ top: 1, left: 1, bottom: 2, right: 1 })
  })

  it("starts editing when you type, keeps it on Enter and moves down", async () => {
    const grid = await mount()
    await press(grid.root, "4")
    expect(grid.editing.value).toMatchObject({ row: 0, col: 0, text: "4", mode: "enter" })
    const editor = grid.root.querySelector<HTMLTextAreaElement>("[data-grid-editor]")!
    expect(editor).not.toBeNull()
    editor.value = "42"
    editor.dispatchEvent(new Event("input", { bubbles: true }))
    await press(editor, "Enter")
    expect(grid.commits).toEqual([[0, 0, "42"]])
    expect(grid.editing.value).toBeNull()
    expect(grid.selection.value.active).toEqual(cell(1, 0))
  })

  it("opens an empty editor when an input method starts composing", async () => {
    const grid = await mount();
    await press(grid.root, "Process", { keyCode: 229 } as KeyboardEventInit)
    expect(grid.editing.value).toMatchObject({ row: 0, col: 0, text: "", mode: "enter" })
    expect(grid.root.querySelector("[data-grid-editor]")).not.toBeNull()
  })

  it("opens it on compositionstart too", async () => {
    const other = await mount()
    other.root.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }))
    await flush()
    expect(other.editing.value).toMatchObject({ text: "" })
  })

  it("drops the edit on Escape", async () => {
    const grid = await mount()
    await press(grid.root, "F2")
    const editor = grid.root.querySelector<HTMLTextAreaElement>("[data-grid-editor]")!
    await press(editor, "Escape")
    expect(grid.commits).toEqual([])
    expect(grid.editing.value).toBeNull()
  })

  it("keeps a typed edit and moves on with an arrow, but not inside a formula", async () => {
    const grid = await mount()
    await press(grid.root, "a")
    await press(grid.root.querySelector<HTMLTextAreaElement>("[data-grid-editor]")!, "ArrowRight")
    expect(grid.commits).toEqual([[0, 0, "a"]])
    expect(grid.selection.value.active).toEqual(cell(0, 1))
    await press(grid.root, "=")
    await press(grid.root.querySelector<HTMLTextAreaElement>("[data-grid-editor]")!, "ArrowRight")
    expect(grid.editing.value?.text).toBe("=")
  })

  it("clears the selection with Delete and fills down with Ctrl+D", async () => {
    const grid = await mount()
    await press(grid.root, "ArrowDown", { shiftKey: true })
    await press(grid.root, "ArrowDown", { shiftKey: true })
    await press(grid.root, "Delete")
    expect(grid.clears).toEqual([{ top: 0, left: 0, bottom: 2, right: 0 }])
    await press(grid.root, "d", { ctrlKey: true })
    expect(grid.fills[0]?.source).toEqual({ top: 0, left: 0, bottom: 0, right: 0 })
    expect(grid.fills[0]?.target).toEqual({ top: 1, left: 0, bottom: 2, right: 0 })
  })

  it("lets the caller take a key first", async () => {
    const grid = await mount()
    grid.root.addEventListener("keydown", (event) => event.key === "ArrowDown" && event.preventDefault(), { capture: true })
    await press(grid.root, "ArrowDown")
    expect(grid.selection.value.active).toEqual(cell(0, 0))
  })

  it("only selects and copies when read-only", async () => {
    const grid = await mount({ readonly: true })
    await press(grid.root, "x")
    await press(grid.root, "F2")
    await press(grid.root, "Delete")
    expect(grid.editing.value).toBeNull()
    expect(grid.clears).toEqual([])
    expect(grid.root.querySelector("[data-fill-handle]")).toBeNull()
    await press(grid.root, "ArrowDown")
    expect(grid.selection.value.active).toEqual(cell(1, 0))
  })

  it("shows an edit the caller started in the cell, but leaves the focus where it was", async () => {
    const grid = await mount();
    const bar = document.createElement("input");
    bar.dataset.gridKeepEdit = "";
    document.body.append(bar);
    bar.focus();
    grid.editing.value = { row: 0, col: 0, text: "=SU", mode: "edit" };
    await flush();
    const editor = grid.root.querySelector<HTMLTextAreaElement>("[data-grid-editor]")!;
    expect(editor.value).toBe("=SU");
    expect(document.activeElement).toBe(bar);
    // Moving from the cell editor into a part marked data-grid-keep-edit keeps the edit going.
    editor.dispatchEvent(new FocusEvent("blur", { relatedTarget: bar }));
    await flush();
    expect(grid.commits).toEqual([]);
    expect(grid.editing.value?.text).toBe("=SU");
    bar.remove();
  });

  it("draws frozen rows on their own", async () => {
    const { root } = await mount({ frozenRows: 2 })
    expect(root.querySelector("[data-area=frozen-body] [data-cell='0:0']")).not.toBeNull()
    expect(root.querySelector("[data-area=body-body] [data-cell='0:0']")).toBeNull()
    expect(root.querySelector("[data-area=body-body] [data-cell='2:0']")).not.toBeNull()
  })
})
