<script setup lang="ts">
// A grid of cells with A, B, C … and 1, 2, 3 … headers, for spreadsheets and big tables. Only the rows and columns in
// view are drawn, so 20,000 rows scroll like 20.
//
// The grid knows nothing about the data. Values go in as functions (`text`, `editText`, `cellClass`, `cellStyle`), and
// what the user does comes out as events (`commit`, `clear`, `fill`, `resize-column`, `copy`, `paste`, …); the caller
// changes its data and the grid draws it again. Selection, the cell being edited and the scroll position are models,
// so a caller can read them back (panel state) or leave them to the grid.
//
// - Select: click, drag, Shift+click; a header selects its row or column, the corner everything. Keys: arrows,
//   Shift/Ctrl+arrows, Tab, Enter, Home/End, Ctrl+Home/End, Page Up/Down, Ctrl+A.
// - Edit: typing replaces the cell, F2 or a double-click edits it; Enter, Tab and the arrows (unless the text is a
//   formula) keep it, Esc drops it, Alt+Enter starts a new line. Delete clears the selection (`clear`).
// - Fill: drag the square at the selection's corner, or Ctrl+D / Ctrl+R (`fill` with source and target ranges).
// - Size: drag a header's edge (`resize-column`, `resize-row`). Frozen rows and columns stay put while the rest scrolls.
// - `readonly`: select and copy only.
// - The cell editor keeps its edit when the focus moves into an element marked `data-grid-keep-edit` (a formula bar,
//   a list of suggestions); clicking anywhere else keeps the edit and ends it.
// - Before the grid acts on a key it emits `keydown` (and `editor-keydown` while editing): call `preventDefault()` to
//   take the key over (bold, undo, a checkbox's Space).
// - The `cell` slot draws a cell (`{ row, col, text, active, selected }`); without it the text is shown.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type HTMLAttributes, type StyleValue } from "vue"
import { useResizeObserver } from "@vueuse/core"
import { cn } from "../../../lib/utils"
import { uiText } from "../text"
import { columnName, hitIndex, makeAxis, scrollToShow, visibleRange, type Axis } from "./geometry"
import {
  cell,
  clampSelection,
  extendTo,
  fillPlan,
  fillShortcut,
  inRange,
  moveByKey,
  rangeOf,
  sameCell,
  selectAll,
  selectCols,
  selectRows,
  single,
  unionRange,
  type CellPos,
  type FillPlan,
  type GridRange,
  type GridSelection,
} from "./selection"
import type { GridEdit, GridScroll, HeaderKind } from "./types"

type Sizes = ReadonlyMap<number, number> | Readonly<Record<number, number>>

const props = withDefaults(
  defineProps<{
    rows: number
    cols: number
    /** What a cell shows. */
    text: (row: number, col: number) => string
    /** What editing a cell starts with (a formula, say); the shown text when left out. */
    editText?: (row: number, col: number) => string
    /** Whether a cell has something in it (Ctrl+arrows, End); a non-empty `text` when left out. */
    filled?: (row: number, col: number) => boolean
    cellClass?: (row: number, col: number) => HTMLAttributes["class"]
    cellStyle?: (row: number, col: number) => StyleValue
    /** A tooltip for a cell. */
    cellTitle?: (row: number, col: number) => string | undefined
    columnLabel?: (col: number) => string
    rowLabel?: (row: number) => string
    columnWidths?: Sizes
    rowHeights?: Sizes
    defaultColumnWidth?: number
    defaultRowHeight?: number
    /** Rows that take no room (a filter); the keys skip them. */
    hiddenRows?: ReadonlySet<number>
    frozenRows?: number
    frozenCols?: number
    /** The last row and column with something in them, for Ctrl+End. */
    usedBottom?: number
    usedRight?: number
    readonly?: boolean
    /** Whether dragging a header's edge resizes. */
    resizable?: boolean
    ariaLabel?: string
    class?: HTMLAttributes["class"]
  }>(),
  { defaultColumnWidth: 96, defaultRowHeight: 28, frozenRows: 0, frozenCols: 0, readonly: false, resizable: true },
)

const emit = defineEmits<{
  /** The user kept an edit. */
  commit: [pos: CellPos, text: string]
  /** Delete or Backspace on the selection. */
  clear: [range: GridRange]
  /** The fill handle was let go, or Ctrl+D / Ctrl+R. */
  fill: [plan: FillPlan]
  "resize-column": [col: number, width: number]
  "resize-row": [row: number, height: number]
  /** Copy, cut and paste on the grid (not inside the editor). Fill `event.clipboardData` and call `preventDefault()`. */
  copy: [range: GridRange, event: ClipboardEvent]
  cut: [range: GridRange, event: ClipboardEvent]
  paste: [selection: GridSelection, event: ClipboardEvent]
  /** A key on the grid, before the grid acts on it. `preventDefault()` takes it over. */
  keydown: [event: KeyboardEvent]
  /** A key in the cell editor, before the grid acts on it. */
  "editor-keydown": [event: KeyboardEvent]
  /** A right-click on a cell or a header, with its element to anchor a menu to. */
  menu: [target: { kind: HeaderKind | "cell"; row: number; col: number; element: HTMLElement }]
}>()

defineSlots<{
  cell?: (props: { row: number; col: number; text: string; active: boolean; selected: boolean }) => unknown
}>()

const selection = defineModel<GridSelection>("selection", { default: () => single(cell(0, 0)) })
const editing = defineModel<GridEdit | null>("editing", { default: null })
const scroll = defineModel<GridScroll>("scroll", { default: () => ({ top: 0, left: 0 }) })

const root = ref<HTMLElement | null>(null)
const editor = ref<HTMLTextAreaElement | null>(null)
// The editor sits inside the area loop, where a plain ref would be a list.
const setEditor = (el: unknown) => {
  editor.value = el instanceof HTMLTextAreaElement ? el : null
}

// ── Sizes

/** A header edge being dragged: drawn at once, saved on release. */
const liveSize = ref<{ kind: "col" | "row"; index: number; size: number } | null>(null)

function withLive(sizes: Sizes | undefined, kind: "col" | "row"): Sizes | undefined {
  const live = liveSize.value
  if (!live || live.kind !== kind) return sizes
  const copy = new Map<number, number>(sizes instanceof Map ? sizes : Object.entries(sizes ?? {}).map(([key, value]) => [Number(key), value]))
  copy.set(live.index, live.size)
  return copy
}

const colAxis = computed<Axis>(() => makeAxis(props.cols, props.defaultColumnWidth, withLive(props.columnWidths, "col")))
const rowAxis = computed<Axis>(() => makeAxis(props.rows, props.defaultRowHeight, withLive(props.rowHeights, "row"), props.hiddenRows))
const frozenRows = computed(() => Math.max(0, Math.min(props.frozenRows, props.rows)))
const frozenCols = computed(() => Math.max(0, Math.min(props.frozenCols, props.cols)))
const frozenHeight = computed(() => rowAxis.value.start(frozenRows.value))
const frozenWidth = computed(() => colAxis.value.start(frozenCols.value))

const headerHeight = computed(() => props.defaultRowHeight)
// Wide enough for the longest row number.
const rowHeaderWidth = computed(() => Math.max(40, 16 + String(props.rows).length * 8))

const viewport = ref({ width: 0, height: 0 })
useResizeObserver(root, () => {
  const el = root.value
  if (el) viewport.value = { width: el.clientWidth, height: el.clientHeight }
})
const innerWidth = computed(() => Math.max(0, viewport.value.width - rowHeaderWidth.value))
const innerHeight = computed(() => Math.max(0, viewport.value.height - headerHeight.value))

// ── What is in view

const scrollTop = ref(scroll.value.top)
const scrollLeft = ref(scroll.value.left)

const shownRows = (from: number, to: number) => {
  const list: number[] = []
  for (let row = from; row <= to; row++) if (rowAxis.value.size(row) > 0) list.push(row)
  return list
}
const shownCols = (from: number, to: number) => {
  const list: number[] = []
  for (let col = from; col <= to; col++) if (colAxis.value.size(col) > 0) list.push(col)
  return list
}

const bodyRows = computed(() => {
  const [from, to] = visibleRange(rowAxis.value, frozenRows.value, scrollTop.value, innerHeight.value, 3)
  return shownRows(from, to)
})
const bodyCols = computed(() => {
  const [from, to] = visibleRange(colAxis.value, frozenCols.value, scrollLeft.value, innerWidth.value, 1)
  return shownCols(from, to)
})
const topRows = computed(() => shownRows(0, frozenRows.value - 1))
const leftCols = computed(() => shownCols(0, frozenCols.value - 1))

type Band = "frozen" | "body"
interface Area {
  key: string
  rowBand: Band
  colBand: Band
  rows: number[]
  cols: number[]
  /** Where the area's first row and column start on the axes. */
  rowOrigin: number
  colOrigin: number
  style: StyleValue
}

const areas = computed<Area[]>(() => {
  const frozenTop = headerHeight.value
  const frozenLeft = rowHeaderWidth.value
  const make = (rowBand: Band, colBand: Band): Area => {
    const sticky: Record<string, string> = {}
    if (rowBand === "frozen") sticky.top = `${frozenTop}px`
    if (colBand === "frozen") sticky.left = `${frozenLeft}px`
    return {
      key: `${rowBand}-${colBand}`,
      rowBand,
      colBand,
      rows: rowBand === "frozen" ? topRows.value : bodyRows.value,
      cols: colBand === "frozen" ? leftCols.value : bodyCols.value,
      rowOrigin: rowBand === "frozen" ? 0 : frozenHeight.value,
      colOrigin: colBand === "frozen" ? 0 : frozenWidth.value,
      style: {
        gridRow: rowBand === "frozen" ? 2 : 3,
        gridColumn: colBand === "frozen" ? 2 : 3,
        position: rowBand === "frozen" || colBand === "frozen" ? "sticky" : "relative",
        ...sticky,
      },
    }
  }
  // Drawn in this order, so the frozen parts lie over the scrolling one without a z-index.
  return [make("body", "body"), make("body", "frozen"), make("frozen", "body"), make("frozen", "frozen")]
})

const contentStyle = computed<StyleValue>(() => ({
  display: "grid",
  gridTemplateColumns: `${rowHeaderWidth.value}px ${frozenWidth.value}px ${colAxis.value.total - frozenWidth.value}px`,
  gridTemplateRows: `${headerHeight.value}px ${frozenHeight.value}px ${rowAxis.value.total - frozenHeight.value}px`,
  width: `${rowHeaderWidth.value + colAxis.value.total}px`,
  height: `${headerHeight.value + rowAxis.value.total}px`,
}))

const cellBox = (area: Area, row: number, col: number) => ({
  top: `${rowAxis.value.start(row) - area.rowOrigin}px`,
  left: `${colAxis.value.start(col) - area.colOrigin}px`,
  width: `${colAxis.value.size(col)}px`,
  height: `${rowAxis.value.size(row)}px`,
})

const range = computed(() => rangeOf(selection.value))

/** A range drawn inside an area, in its own coordinates; parts outside the area are clipped by it. */
function rangeBox(area: Area, target: GridRange): Record<string, string> | null {
  const inRows = area.rowBand === "frozen" ? target.top < frozenRows.value : target.bottom >= frozenRows.value
  const inCols = area.colBand === "frozen" ? target.left < frozenCols.value : target.right >= frozenCols.value
  if (!inRows || !inCols) return null
  const top = rowAxis.value.start(target.top) - area.rowOrigin
  const left = colAxis.value.start(target.left) - area.colOrigin
  const height = rowAxis.value.start(target.bottom + 1) - rowAxis.value.start(target.top)
  const width = colAxis.value.start(target.right + 1) - colAxis.value.start(target.left)
  if (height <= 0 || width <= 0) return null
  return { top: `${top}px`, left: `${left}px`, width: `${width}px`, height: `${height}px` }
}

const ownsCell = (area: Area, row: number, col: number) =>
  (area.rowBand === "frozen") === row < frozenRows.value && (area.colBand === "frozen") === col < frozenCols.value

// ── Headers

const columnLabel = (col: number) => props.columnLabel?.(col) ?? columnName(col)
const rowLabel = (row: number) => props.rowLabel?.(row) ?? String(row + 1)
const colHeaderBands = computed(() => [
  { key: "body", cols: bodyCols.value, origin: frozenWidth.value, style: { gridRow: 1, gridColumn: 3, position: "sticky", top: "0px" } as StyleValue },
  { key: "frozen", cols: leftCols.value, origin: 0, style: { gridRow: 1, gridColumn: 2, position: "sticky", top: "0px", left: `${rowHeaderWidth.value}px` } as StyleValue },
])
const rowHeaderBands = computed(() => [
  { key: "body", rows: bodyRows.value, origin: frozenHeight.value, style: { gridRow: 3, gridColumn: 1, position: "sticky", left: "0px" } as StyleValue },
  { key: "frozen", rows: topRows.value, origin: 0, style: { gridRow: 2, gridColumn: 1, position: "sticky", left: "0px", top: `${headerHeight.value}px` } as StyleValue },
])
const colSelected = (col: number) => col >= range.value.left && col <= range.value.right
const rowSelected = (row: number) => row >= range.value.top && row <= range.value.bottom

// ── Scrolling

function onScroll() {
  const el = root.value
  if (!el) return
  scrollTop.value = el.scrollTop
  scrollLeft.value = el.scrollLeft
  scroll.value = { top: el.scrollTop, left: el.scrollLeft }
}

function applyScroll(next: GridScroll) {
  const el = root.value
  if (!el) return
  if (Math.abs(el.scrollTop - next.top) > 0.5) el.scrollTop = next.top
  if (Math.abs(el.scrollLeft - next.left) > 0.5) el.scrollLeft = next.left
  scrollTop.value = el.scrollTop
  scrollLeft.value = el.scrollLeft
}

watch(scroll, (next) => {
  if (Math.abs(next.top - scrollTop.value) > 0.5 || Math.abs(next.left - scrollLeft.value) > 0.5) applyScroll(next)
})

/** Scrolls just far enough to show a cell. */
function scrollToCell(pos: CellPos) {
  const el = root.value
  if (!el) return
  const top = scrollToShow(rowAxis.value, frozenRows.value, el.scrollTop, innerHeight.value, pos.row)
  const left = scrollToShow(colAxis.value, frozenCols.value, el.scrollLeft, innerWidth.value, pos.col)
  applyScroll({ top, left })
}

onMounted(() => {
  const el = root.value
  if (el) viewport.value = { width: el.clientWidth, height: el.clientHeight }
  // The saved scroll needs the content's size first.
  nextTick(() => applyScroll(scroll.value))
})

// Rows or columns that went away must not leave the selection outside the grid.
watch(
  () => [props.rows, props.cols] as const,
  ([rows, cols]) => {
    const fitted = clampSelection(selection.value, Math.max(1, rows), Math.max(1, cols))
    if (JSON.stringify(fitted) !== JSON.stringify(selection.value)) selection.value = fitted
  },
)

// ── Hit testing

interface Hit {
  kind: HeaderKind | "cell"
  row: number
  col: number
}

function hitAt(clientX: number, clientY: number, clampInside = false): Hit | null {
  const el = root.value
  if (!el) return null
  const box = el.getBoundingClientRect()
  let x = clientX - box.left
  let y = clientY - box.top
  if (clampInside) {
    x = Math.max(rowHeaderWidth.value, Math.min(box.width - 1, x))
    y = Math.max(headerHeight.value, Math.min(box.height - 1, y))
  }
  if (x < 0 || y < 0) return null
  const inRowHeader = x < rowHeaderWidth.value
  const inColHeader = y < headerHeight.value
  const row = hitIndex(rowAxis.value, frozenRows.value, el.scrollTop, y - headerHeight.value)
  const col = hitIndex(colAxis.value, frozenCols.value, el.scrollLeft, x - rowHeaderWidth.value)
  if (inRowHeader && inColHeader) return { kind: "corner", row: 0, col: 0 }
  if (inColHeader) return { kind: "column", row: 0, col }
  if (inRowHeader) return { kind: "row", row, col: 0 }
  return { kind: "cell", row, col }
}

/** The header edge under the pointer, if it is close enough to drag. */
function edgeAt(clientX: number, clientY: number): { kind: "col" | "row"; index: number } | null {
  const el = root.value
  if (!el || !props.resizable) return null
  const box = el.getBoundingClientRect()
  const x = clientX - box.left
  const y = clientY - box.top
  const grab = 4
  if (y < headerHeight.value && x >= rowHeaderWidth.value) {
    const inner = x - rowHeaderWidth.value
    const col = hitIndex(colAxis.value, frozenCols.value, el.scrollLeft, inner)
    const shift = col < frozenCols.value ? 0 : el.scrollLeft
    const right = colAxis.value.start(col + 1) - shift
    const left = colAxis.value.start(col) - shift
    if (Math.abs(inner - right) <= grab) return { kind: "col", index: col }
    if (Math.abs(inner - left) <= grab && col > 0) return { kind: "col", index: col - 1 }
  }
  if (x < rowHeaderWidth.value && y >= headerHeight.value) {
    const inner = y - headerHeight.value
    const row = hitIndex(rowAxis.value, frozenRows.value, el.scrollTop, inner)
    const shift = row < frozenRows.value ? 0 : el.scrollTop
    const bottom = rowAxis.value.start(row + 1) - shift
    if (Math.abs(inner - bottom) <= grab) return { kind: "row", index: row }
  }
  return null
}

const hoverEdge = ref<"col" | "row" | null>(null)

// ── Pointer

// Each drag belongs to the pointer that started it: another pointer (a touch while the mouse drags) neither moves nor ends it.
type Drag =
  | { kind: "select"; mode: "cell" | "column" | "row"; pointerId: number; x: number; y: number; captured: boolean }
  | { kind: "fill"; pointerId: number; plan: FillPlan | null }
  | { kind: "resize"; pointerId: number; axis: "col" | "row"; index: number; from: number; start: number }

const drag = ref<Drag | null>(null)
let lastPointer = { x: 0, y: 0 }
let autoScrollFrame = 0

const fillPreview = computed(() => (drag.value?.kind === "fill" && drag.value.plan ? unionRange(drag.value.plan.source, drag.value.plan.target) : null))

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 2) return
  if (editing.value && editor.value && event.target instanceof Node && editor.value.contains(event.target)) return
  const edge = event.button === 0 ? edgeAt(event.clientX, event.clientY) : null
  if (edge) {
    event.preventDefault()
    const axis = edge.kind === "col" ? colAxis.value : rowAxis.value
    drag.value = { kind: "resize", pointerId: event.pointerId, axis: edge.kind, index: edge.index, from: edge.kind === "col" ? event.clientX : event.clientY, start: axis.size(edge.index) }
    root.value?.setPointerCapture?.(event.pointerId)
    return
  }
  const hit = hitAt(event.clientX, event.clientY)
  if (!hit) return
  // The grid keeps the focus (and its keys), even when a cell draws a button; the click still reaches it.
  event.preventDefault()
  root.value?.focus({ preventScroll: true })
  if (editing.value) commitEdit(null)
  // A right-click inside the selection keeps it, so a menu acts on all of it.
  if (event.button === 2) {
    const keep =
      (hit.kind === "cell" && inRange(range.value, hit.row, hit.col)) ||
      (hit.kind === "column" && colSelected(hit.col) && range.value.top === 0 && range.value.bottom === props.rows - 1) ||
      (hit.kind === "row" && rowSelected(hit.row) && range.value.left === 0 && range.value.right === props.cols - 1)
    if (keep) return
  }
  if (hit.kind === "corner") {
    selection.value = selectAll(props.rows, props.cols)
    return
  }
  if (hit.kind === "column") {
    const from = event.shiftKey ? selection.value.anchor.col : hit.col
    selection.value = selectCols(Math.min(from, hit.col), Math.max(from, hit.col), props.rows)
    if (event.shiftKey) selection.value = { ...selection.value, anchor: cell(0, from), focus: cell(props.rows - 1, hit.col) }
  } else if (hit.kind === "row") {
    const from = event.shiftKey ? selection.value.anchor.row : hit.row
    selection.value = selectRows(Math.min(from, hit.row), Math.max(from, hit.row), props.cols)
    if (event.shiftKey) selection.value = { ...selection.value, anchor: cell(from, 0), focus: cell(hit.row, props.cols - 1) }
  } else if (event.shiftKey) {
    selection.value = extendTo(selection.value, cell(hit.row, hit.col))
  } else {
    selection.value = single(cell(hit.row, hit.col))
  }
  if (event.button === 0) {
    drag.value = { kind: "select", mode: hit.kind === "column" ? "column" : hit.kind === "row" ? "row" : "cell", pointerId: event.pointerId, x: event.clientX, y: event.clientY, captured: false }
    startDrag(event, false)
  }
}

function onFillDown(event: PointerEvent) {
  if (event.button !== 0 || props.readonly) return
  event.preventDefault()
  event.stopPropagation()
  if (editing.value) commitEdit(null)
  drag.value = { kind: "fill", pointerId: event.pointerId, plan: null }
  startDrag(event, true)
}

// A selection drag takes the pointer only once it really moves: taken at once, the click would go to the grid
// instead of a checkbox or link drawn in the cell.
function startDrag(event: PointerEvent, capture: boolean) {
  lastPointer = { x: event.clientX, y: event.clientY }
  if (capture) root.value?.setPointerCapture?.(event.pointerId)
  root.value?.focus({ preventScroll: true })
  cancelAnimationFrame(autoScrollFrame)
  autoScrollFrame = requestAnimationFrame(autoScroll)
}

function dragTo(clientX: number, clientY: number) {
  const current = drag.value
  if (!current || current.kind === "resize") return
  const hit = hitAt(clientX, clientY, true)
  if (!hit) return
  if (current.kind === "fill") {
    current.plan = fillPlan(range.value, cell(hit.row, hit.col))
    drag.value = { ...current }
    return
  }
  const sel = selection.value
  if (current.mode === "column") selection.value = { ...sel, focus: cell(props.rows - 1, hit.col) }
  else if (current.mode === "row") selection.value = { ...sel, focus: cell(hit.row, props.cols - 1) }
  else if (!sameCell(sel.focus, cell(hit.row, hit.col))) selection.value = extendTo(sel, cell(hit.row, hit.col))
}

function onPointerMove(event: PointerEvent) {
  const current = drag.value
  if (!current) {
    const edge = edgeAt(event.clientX, event.clientY)
    hoverEdge.value = edge?.kind ?? null
    return
  }
  if (event.pointerId !== current.pointerId) return
  lastPointer = { x: event.clientX, y: event.clientY }
  if (current.kind === "select" && !current.captured && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 4) {
    current.captured = true
    root.value?.setPointerCapture?.(current.pointerId)
  }
  if (current.kind === "resize") {
    const moved = (current.axis === "col" ? event.clientX : event.clientY) - current.from
    const least = current.axis === "col" ? 24 : 20
    liveSize.value = { kind: current.axis, index: current.index, size: Math.max(least, Math.round(current.start + moved)) }
    return
  }
  dragTo(event.clientX, event.clientY)
}

/** While dragging past an edge, the grid scrolls that way, faster the further out the pointer is. */
function autoScroll() {
  const el = root.value
  const current = drag.value
  if (!el || !current || current.kind === "resize") return
  const box = el.getBoundingClientRect()
  const speed = (outside: number) => Math.sign(outside) * Math.min(40, Math.abs(outside) / 2)
  let dx = 0
  let dy = 0
  if (lastPointer.x > box.right) dx = speed(lastPointer.x - box.right)
  else if (lastPointer.x < box.left + rowHeaderWidth.value + frozenWidth.value && el.scrollLeft > 0 && lastPointer.x < box.left + rowHeaderWidth.value) dx = speed(lastPointer.x - box.left - rowHeaderWidth.value)
  if (lastPointer.y > box.bottom) dy = speed(lastPointer.y - box.bottom)
  else if (lastPointer.y < box.top + headerHeight.value && el.scrollTop > 0) dy = speed(lastPointer.y - box.top - headerHeight.value)
  if (dx || dy) {
    el.scrollLeft += dx
    el.scrollTop += dy
    onScroll()
    dragTo(lastPointer.x, lastPointer.y)
  }
  autoScrollFrame = requestAnimationFrame(autoScroll)
}

function onPointerUp(event: PointerEvent) {
  const current = drag.value
  if (current && event.pointerId !== current.pointerId) return
  drag.value = null
  cancelAnimationFrame(autoScrollFrame)
  if (root.value?.hasPointerCapture?.(event.pointerId)) root.value.releasePointerCapture(event.pointerId)
  if (!current) return
  if (current.kind === "resize") {
    const live = liveSize.value
    liveSize.value = null
    if (live && live.size !== current.start) {
      if (live.kind === "col") emit("resize-column", live.index, live.size)
      else emit("resize-row", live.index, live.size)
    }
    return
  }
  if (current.kind === "fill" && current.plan) {
    const plan = current.plan
    emit("fill", plan)
    const whole = unionRange(plan.source, plan.target)
    selection.value = { active: { ...selection.value.active }, anchor: cell(whole.top, whole.left), focus: cell(whole.bottom, whole.right) }
  }
}

function onDoubleClick(event: MouseEvent) {
  if (props.readonly) return
  const hit = hitAt(event.clientX, event.clientY)
  if (hit?.kind !== "cell") return
  startEditing(undefined, "edit")
}

function onContextMenu(event: MouseEvent) {
  const hit = hitAt(event.clientX, event.clientY)
  if (!hit) return
  const target = event.target instanceof HTMLElement ? event.target : null
  const element =
    hit.kind === "cell"
      ? (target?.closest<HTMLElement>("[data-cell]") ?? cellElement(cell(hit.row, hit.col)))
      : (target?.closest<HTMLElement>("[data-header]") ?? null)
  if (!element) return
  event.preventDefault()
  emit("menu", { kind: hit.kind, row: hit.row, col: hit.col, element })
}

// ── Keys

const pageRows = computed(() => Math.max(1, Math.floor((innerHeight.value - frozenHeight.value) / props.defaultRowHeight) - 1))
const filled = (row: number, col: number) => (props.filled ? props.filled(row, col) : props.text(row, col) !== "")

function onKeyDown(event: KeyboardEvent) {
  if (event.target !== root.value) return
  emit("keydown", event)
  if (event.defaultPrevented) return
  const ctrl = event.ctrlKey || event.metaKey
  if (!props.readonly && ctrl && !event.altKey && !event.shiftKey && (event.key === "d" || event.key === "r")) {
    event.preventDefault()
    const plan = fillShortcut(range.value, event.key === "d" ? "down" : "right")
    if (plan) emit("fill", plan)
    return
  }
  const moved = moveByKey(
    selection.value,
    { key: event.key, shift: event.shiftKey, ctrl, alt: event.altKey },
    {
      rows: props.rows,
      cols: props.cols,
      rowShown: (row) => rowAxis.value.size(row) > 0,
      colShown: (col) => colAxis.value.size(col) > 0,
      filled,
      usedBottom: props.usedBottom,
      usedRight: props.usedRight,
      pageRows: pageRows.value,
    },
  )
  if (moved) {
    event.preventDefault()
    selection.value = moved
    scrollToCell(event.shiftKey && !event.key.startsWith("Tab") && event.key !== "Enter" ? moved.focus : moved.active)
    return
  }
  if (props.readonly) return
  if (event.key === "F2") {
    event.preventDefault()
    startEditing(undefined, "edit")
  } else if (event.key === "Delete" || event.key === "Backspace") {
    event.preventDefault()
    emit("clear", { ...range.value })
  } else if (event.key === "Process" || event.keyCode === 229 || event.isComposing) {
    // An input method (Japanese, Chinese, Korean…) starts composing: open the editor empty and let the key go on,
    // so the composition lands in the cell.
    startComposing()
  } else if (event.key.length === 1 && !ctrl && !event.altKey) {
    // Typing replaces the cell with what was typed.
    event.preventDefault()
    startEditing(event.key, "enter")
  }
}

// ── Editing

/** An input method begins on the idle grid: an empty edit, whose editor takes the focus right away. */
function startComposing() {
  if (props.readonly || editing.value) return
  startEditing("", "enter")
}

function onCompositionStart(event: CompositionEvent) {
  if (event.target === root.value) startComposing()
}

/**
 * An edit the grid started takes the focus into the cell. One the caller started (typing in a formula bar, say)
 * shows in the cell too but leaves the focus where it is.
 */
let focusEditor = false

/** Starts editing the active cell with a text (its edit text when left out). */
function startEditing(text?: string, mode: GridEdit["mode"] = "edit") {
  if (props.readonly) return
  const { row, col } = selection.value.active
  scrollToCell(selection.value.active)
  focusEditor = true
  editing.value = { row, col, text: text ?? (props.editText ?? props.text)(row, col), mode }
}

watch(
  () => editing.value && `${editing.value.row}:${editing.value.col}`,
  (now, before) => {
    if (!now || now === before || !focusEditor) return
    focusEditor = false
    nextTick(() => {
      const el = editor.value
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(el.value.length, el.value.length)
    })
  },
)

/** Keeps the edit and moves the active cell with a key (or not at all), then gives the grid the focus back. */
function commitEdit(move: { key: string; shift: boolean } | null) {
  const current = editing.value
  if (!current) return
  // The field is newer than the model when a key follows the typing within the same tick.
  const text = editor.value?.value ?? current.text
  editing.value = null
  emit("commit", cell(current.row, current.col), text)
  if (move) {
    const moved = moveByKey(selection.value, { key: move.key, shift: move.key === "Tab" || move.key === "Enter" ? move.shift : false }, { rows: props.rows, cols: props.cols, rowShown: (row) => rowAxis.value.size(row) > 0 })
    if (moved) {
      selection.value = moved
      scrollToCell(moved.active)
    }
  }
  nextTick(() => root.value?.focus({ preventScroll: true }))
}

function cancelEdit() {
  editing.value = null
  nextTick(() => root.value?.focus({ preventScroll: true }))
}

function onEditorInput(event: Event) {
  const current = editing.value
  if (!current) return
  editing.value = { ...current, text: (event.target as HTMLTextAreaElement).value }
}

function onEditorKeyDown(event: KeyboardEvent) {
  emit("editor-keydown", event)
  if (event.defaultPrevented || event.isComposing) return
  const current = editing.value
  if (!current) return
  if (event.key === "Escape") {
    event.preventDefault()
    cancelEdit()
  } else if (event.key === "Enter" && !event.altKey) {
    event.preventDefault()
    commitEdit({ key: "Enter", shift: event.shiftKey })
  } else if (event.key === "Enter" && event.altKey) {
    // A new line inside the cell.
    event.preventDefault()
    const el = event.target as HTMLTextAreaElement
    el.setRangeText("\n", el.selectionStart, el.selectionEnd, "end")
    editing.value = { ...current, text: el.value }
  } else if (event.key === "Tab") {
    event.preventDefault()
    commitEdit({ key: "Tab", shift: event.shiftKey })
  } else if (current.mode === "enter" && !current.text.startsWith("=") && event.key.startsWith("Arrow") && !event.shiftKey) {
    // Typed into a cell (not F2): the arrows keep it and move on, as in Excel.
    event.preventDefault()
    commitEdit({ key: event.key, shift: false })
  }
}

function onEditorBlur(event: FocusEvent) {
  // Clicking elsewhere keeps the edit; a caller's own part of it (its formula bar, its suggestions) doesn't count.
  const next = event.relatedTarget
  if (next instanceof HTMLElement && next.closest("[data-grid-keep-edit]")) return
  if (editing.value) commitEdit(null)
}

const editorBox = computed(() => {
  const current = editing.value
  if (!current) return null
  const area = areas.value.find((item) => ownsCell(item, current.row, current.col))
  if (!area) return null
  const box = cellBox(area, current.row, current.col)
  return { area: area.key, style: { top: box.top, left: box.left, minWidth: box.width, minHeight: box.height } }
})

// ── Clipboard

const fromEditor = (event: Event) => editor.value !== null && event.target instanceof Node && editor.value.contains(event.target)
function onCopy(event: ClipboardEvent) {
  if (!fromEditor(event)) emit("copy", { ...range.value }, event)
}
function onCut(event: ClipboardEvent) {
  if (!fromEditor(event) && !props.readonly) emit("cut", { ...range.value }, event)
}
function onPaste(event: ClipboardEvent) {
  if (!fromEditor(event) && !props.readonly) emit("paste", selection.value, event)
}

// ── Reading it out

const active = computed(() => selection.value.active)
const announcement = computed(() => {
  const { row, col } = active.value
  if (row >= props.rows || col >= props.cols) return ""
  const name = `${columnLabel(col)}${rowLabel(row)}`
  const shown = props.text(row, col)
  return shown ? uiText.value.gridCell.replace("{cell}", name).replace("{text}", shown) : uiText.value.gridEmpty.replace("{cell}", name)
})

/** A drawn cell's element (to anchor a menu or a dropdown to), if it is in view. */
function cellElement(pos: CellPos): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>(`[data-cell="${pos.row}:${pos.col}"]`) ?? null
}

onBeforeUnmount(() => cancelAnimationFrame(autoScrollFrame))

defineExpose({
  focus: () => root.value?.focus({ preventScroll: true }),
  scrollToCell,
  startEditing,
  /** Keeps the edit (from a formula bar, say), moving on like Enter or Tab would when given that key. */
  commitEdit: (move?: { key: "Enter" | "Tab"; shift?: boolean }) => commitEdit(move ? { key: move.key, shift: !!move.shift } : null),
  cancelEdit,
  cellElement,
  editorElement: () => editor.value,
})
</script>

<template>
  <div
    ref="root"
    data-slot="data-grid"
    tabindex="0"
    :aria-label="ariaLabel ?? uiText.grid"
    :aria-readonly="readonly || undefined"
    :class="cn(
      'relative overflow-auto overscroll-contain bg-background text-sm text-foreground outline-none select-none rounded-md',
      'focus-visible:ring-ring/50 focus-visible:ring-3',
      hoverEdge === 'col' || drag?.kind === 'resize' && drag.axis === 'col' ? 'cursor-col-resize' : hoverEdge === 'row' || drag?.kind === 'resize' && drag.axis === 'row' ? 'cursor-row-resize' : drag?.kind === 'fill' ? 'cursor-crosshair' : 'cursor-cell',
      props.class,
    )"
    @scroll.passive="onScroll"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="onDoubleClick"
    @contextmenu="onContextMenu"
    @keydown="onKeyDown"
    @copy="onCopy"
    @cut="onCut"
    @paste="onPaste"
    @compositionstart="onCompositionStart"
  >
    <div :style="contentStyle">
      <div
        v-for="area in areas"
        :key="area.key"
        :data-area="area.key"
        class="overflow-hidden bg-background"
        :class="{ 'border-b border-border': area.rowBand === 'frozen' && topRows.length, 'border-r border-border': area.colBand === 'frozen' && leftCols.length }"
        :style="area.style"
      >
        <template v-for="row in area.rows" :key="row">
          <div
            v-for="col in area.cols"
            :key="col"
            :data-cell="`${row}:${col}`"
            :title="cellTitle?.(row, col)"
            :class="cn('absolute box-border flex items-center overflow-hidden whitespace-nowrap border-r border-b border-border px-2 tabular-nums', cellClass?.(row, col))"
            :style="[cellBox(area, row, col), cellStyle?.(row, col)]"
          >
            <slot name="cell" :row="row" :col="col" :text="text(row, col)" :active="active.row === row && active.col === col" :selected="inRange(range, row, col)">
              <span class="min-w-0 truncate">{{ text(row, col) }}</span>
            </slot>
          </div>
        </template>

        <!-- The selection, over the cells. Nothing a key starts moves, so none of it animates. -->
        <div
          v-if="rangeBox(area, range)"
          aria-hidden="true"
          class="pointer-events-none absolute box-border border border-primary bg-primary/10"
          :style="rangeBox(area, range)!"
        />
        <div
          v-if="ownsCell(area, active.row, active.col) && rangeBox(area, { top: active.row, left: active.col, bottom: active.row, right: active.col })"
          aria-hidden="true"
          class="pointer-events-none absolute box-border border-2 border-primary"
          :style="rangeBox(area, { top: active.row, left: active.col, bottom: active.row, right: active.col })!"
        />
        <div
          v-if="fillPreview && rangeBox(area, fillPreview)"
          aria-hidden="true"
          class="pointer-events-none absolute box-border border border-dashed border-primary"
          :style="rangeBox(area, fillPreview)!"
        />
        <div
          v-if="!readonly && !editing && ownsCell(area, range.bottom, range.right) && rangeBox(area, { top: range.bottom, left: range.right, bottom: range.bottom, right: range.right })"
          data-fill-handle
          :title="uiText.gridFill"
          class="absolute size-2 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-sm border border-background bg-primary"
          :style="{
            top: `${rowAxis.start(range.bottom + 1) - area.rowOrigin - 1}px`,
            left: `${colAxis.start(range.right + 1) - area.colOrigin - 1}px`,
          }"
          @pointerdown="onFillDown"
        />

        <textarea
          v-if="editing && editorBox?.area === area.key"
          :ref="setEditor"
          data-grid-editor
          :value="editing.text"
          rows="1"
          spellcheck="false"
          :aria-label="`${columnLabel(editing.col)}${rowLabel(editing.row)}`"
          class="absolute box-border resize-none overflow-hidden whitespace-pre border-2 border-primary bg-background px-2 py-1 text-sm text-foreground outline-none [field-sizing:content] select-text"
          :style="editorBox.style"
          @input="onEditorInput"
          @keydown="onEditorKeyDown"
          @blur="onEditorBlur"
        />
      </div>

      <!-- Row numbers, then column letters, then the corner: drawn last so they lie over the cells. -->
      <div
        v-for="band in rowHeaderBands"
        :key="`rows-${band.key}`"
        class="overflow-hidden border-r border-border bg-muted text-xs text-muted-foreground"
        :style="band.style"
      >
        <div
          v-for="row in band.rows"
          :key="row"
          data-header="row"
          :data-row="row"
          :class="cn('absolute inset-x-0 box-border flex items-center justify-end border-b border-border px-2 tabular-nums', rowSelected(row) && 'bg-accent font-medium text-accent-foreground')"
          :style="{ top: `${rowAxis.start(row) - band.origin}px`, height: `${rowAxis.size(row)}px` }"
        >
          {{ rowLabel(row) }}
        </div>
      </div>
      <div
        v-for="band in colHeaderBands"
        :key="`cols-${band.key}`"
        class="overflow-hidden border-b border-border bg-muted text-xs text-muted-foreground"
        :style="band.style"
      >
        <div
          v-for="col in band.cols"
          :key="col"
          data-header="column"
          :data-col="col"
          :class="cn('absolute inset-y-0 box-border flex items-center justify-center overflow-hidden whitespace-nowrap border-r border-border px-1', colSelected(col) && 'bg-accent font-medium text-accent-foreground')"
          :style="{ left: `${colAxis.start(col) - band.origin}px`, width: `${colAxis.size(col)}px` }"
        >
          {{ columnLabel(col) }}
        </div>
      </div>
      <div
        data-header="corner"
        class="box-border border-r border-b border-border bg-muted"
        :style="{ gridRow: 1, gridColumn: 1, position: 'sticky', top: '0px', left: '0px' }"
      />
    </div>
    <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
  </div>
</template>
