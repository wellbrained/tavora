// What DataGrid's keys and pointer do to the selection, as pure functions: arrows, Shift and Ctrl with them, Tab and
// Enter inside a range, Home/End, Page Up/Down, Ctrl+A, and the ranges Ctrl+D, Ctrl+R and the fill handle fill.
// The grid knows nothing about the data; it only asks whether a cell is filled (for Ctrl+arrows).

export interface CellPos {
  row: number
  col: number
}

/** A block of cells, both corners included. Always `top <= bottom` and `left <= right`. */
export interface GridRange {
  top: number
  left: number
  bottom: number
  right: number
}

/**
 * The selection: the range from `anchor` to `focus` (Shift moves the focus), and the `active` cell inside it, the one
 * typing goes into. Tab and Enter move the active cell through a range without losing it.
 */
export interface GridSelection {
  active: CellPos
  anchor: CellPos
  focus: CellPos
}

/** What the keys need to know about the grid. */
export interface MoveContext {
  rows: number
  cols: number
  /** Whether a row takes room; a hidden (filtered) one is skipped. All are shown when left out. */
  rowShown?: (row: number) => boolean
  colShown?: (col: number) => boolean
  /** Whether a cell has something in it, for Ctrl+arrows, End and Ctrl+End. */
  filled?: (row: number, col: number) => boolean
  /** The last row and column with something in them (-1 when empty), for Ctrl+End. */
  usedBottom?: number
  usedRight?: number
  /** How many rows Page Up and Page Down move. */
  pageRows?: number
}

export const cell = (row: number, col: number): CellPos => ({ row, col })
export const sameCell = (a: CellPos, b: CellPos): boolean => a.row === b.row && a.col === b.col

export function single(pos: CellPos): GridSelection {
  return { active: { ...pos }, anchor: { ...pos }, focus: { ...pos } }
}

export function rangeOf(selection: Pick<GridSelection, "anchor" | "focus">): GridRange {
  const { anchor, focus } = selection
  return {
    top: Math.min(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    bottom: Math.max(anchor.row, focus.row),
    right: Math.max(anchor.col, focus.col),
  }
}

export const rangeRows = (range: GridRange): number => range.bottom - range.top + 1
export const rangeCols = (range: GridRange): number => range.right - range.left + 1
export const isSingle = (range: GridRange): boolean => range.top === range.bottom && range.left === range.right

export function inRange(range: GridRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right
}

/** Keeps a selection inside a grid of this size (after rows were removed, say). */
export function clampSelection(selection: GridSelection, rows: number, cols: number): GridSelection {
  const fit = (pos: CellPos): CellPos => ({ row: clamp(pos.row, 0, rows - 1), col: clamp(pos.col, 0, cols - 1) })
  return { active: fit(selection.active), anchor: fit(selection.anchor), focus: fit(selection.focus) }
}

/** The selection from the anchor to a cell, keeping the active cell (Shift+click, dragging). */
export function extendTo(selection: GridSelection, to: CellPos): GridSelection {
  return { active: { ...selection.active }, anchor: { ...selection.anchor }, focus: { ...to } }
}

export function selectAll(rows: number, cols: number, active: CellPos = cell(0, 0)): GridSelection {
  return { active: { ...active }, anchor: cell(0, 0), focus: cell(Math.max(0, rows - 1), Math.max(0, cols - 1)) }
}

export function selectRows(from: number, to: number, cols: number): GridSelection {
  return { active: cell(from, 0), anchor: cell(from, 0), focus: cell(to, Math.max(0, cols - 1)) }
}

export function selectCols(from: number, to: number, rows: number): GridSelection {
  return { active: cell(0, from), anchor: cell(0, from), focus: cell(Math.max(0, rows - 1), to) }
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

/** The next shown index from `from` in direction `delta` (±1), `count` steps; stays put at the edge. */
function stepShown(from: number, delta: number, count: number, size: number, shown?: (i: number) => boolean): number {
  let at = from
  let left = count
  let i = from
  while (left > 0) {
    i += delta
    if (i < 0 || i >= size) break
    if (!shown || shown(i)) {
      at = i
      left--
    }
  }
  return at
}

function firstShown(size: number, shown?: (i: number) => boolean): number {
  for (let i = 0; i < size; i++) if (!shown || shown(i)) return i
  return 0
}

function lastShown(size: number, shown?: (i: number) => boolean): number {
  for (let i = size - 1; i >= 0; i--) if (!shown || shown(i)) return i
  return Math.max(0, size - 1)
}

/**
 * Ctrl+arrow, as in Excel and Google Sheets: inside a run of filled cells to its last one; from a filled cell into
 * empty space to the next filled cell (or the edge); from an empty cell to the next filled cell (or the edge).
 */
export function jump(from: CellPos, dRow: number, dCol: number, ctx: MoveContext): CellPos {
  const filled = ctx.filled ?? (() => false)
  const vertical = dRow !== 0
  const size = vertical ? ctx.rows : ctx.cols
  const shown = vertical ? ctx.rowShown : ctx.colShown
  const delta = vertical ? dRow : dCol
  const at = (i: number) => (vertical ? filled(i, from.col) : filled(from.row, i))
  const start = vertical ? from.row : from.col
  const next = (i: number) => {
    let j = i + delta
    while (j >= 0 && j < size && shown && !shown(j)) j += delta
    return j
  }
  const edge = delta > 0 ? lastShown(size, shown) : firstShown(size, shown)
  const place = (i: number): CellPos => (vertical ? cell(i, from.col) : cell(from.row, i))

  let i = next(start)
  if (i < 0 || i >= size) return place(start)
  if (at(start) && at(i)) {
    // Inside a run: to its last filled cell.
    let last = i
    for (let j = next(i); j >= 0 && j < size && at(j); j = next(j)) last = j
    return place(last)
  }
  // Into empty space: to the next filled cell, or the edge.
  while (i >= 0 && i < size) {
    if (at(i)) return place(i)
    i = next(i)
  }
  return place(edge)
}

export interface KeyInput {
  key: string
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
}

/**
 * The selection after a key, or `null` when the key doesn't move it (the grid then leaves it to someone else).
 * Ctrl stands for Ctrl or Cmd.
 */
export function moveByKey(selection: GridSelection, input: KeyInput, ctx: MoveContext): GridSelection | null {
  const { key, shift = false, ctrl = false, alt = false } = input
  if (alt) return null
  const range = rangeOf(selection)
  const rowStep = (from: number, delta: number, count = 1) => stepShown(from, delta, count, ctx.rows, ctx.rowShown)
  const colStep = (from: number, delta: number, count = 1) => stepShown(from, delta, count, ctx.cols, ctx.colShown)

  const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
  const arrow = arrows[key]
  if (arrow) {
    const [dRow, dCol] = arrow
    const from = shift ? selection.focus : selection.active
    const to = ctrl ? jump(from, dRow, dCol, ctx) : cell(dRow ? rowStep(from.row, dRow) : from.row, dCol ? colStep(from.col, dCol) : from.col)
    return shift ? { active: { ...selection.active }, anchor: { ...selection.anchor }, focus: to } : single(to)
  }

  if (key === "Tab" || key === "Enter") {
    if (ctrl) return null
    const across = key === "Tab"
    const back = shift
    if (!isSingle(range)) return withinRange(selection, range, across, back)
    const from = selection.active
    return single(across ? cell(from.row, colStep(from.col, back ? -1 : 1)) : cell(rowStep(from.row, back ? -1 : 1), from.col))
  }

  if (key === "Home" || key === "End") {
    const from = shift ? selection.focus : selection.active
    let to: CellPos
    if (ctrl) {
      to = key === "Home"
        ? cell(firstShown(ctx.rows, ctx.rowShown), firstShown(ctx.cols, ctx.colShown))
        : cell(clamp(ctx.usedBottom ?? ctx.rows - 1, 0, ctx.rows - 1), clamp(ctx.usedRight ?? ctx.cols - 1, 0, ctx.cols - 1))
    } else if (key === "Home") {
      to = cell(from.row, firstShown(ctx.cols, ctx.colShown))
    } else {
      // End: the last filled cell of the row, or its last column when the row is empty.
      let last = -1
      if (ctx.filled) for (let col = ctx.cols - 1; col >= 0 && last < 0; col--) if (ctx.filled(from.row, col)) last = col
      to = cell(from.row, last >= 0 ? last : lastShown(ctx.cols, ctx.colShown))
    }
    return shift ? extendTo(selection, to) : single(to)
  }

  if (key === "PageDown" || key === "PageUp") {
    const delta = key === "PageDown" ? 1 : -1
    const page = Math.max(1, ctx.pageRows ?? 10)
    const from = shift ? selection.focus : selection.active
    const to = cell(rowStep(from.row, delta, page), from.col)
    return shift ? extendTo(selection, to) : single(to)
  }

  if (ctrl && (key === "a" || key === "A")) return selectAll(ctx.rows, ctx.cols, selection.active)
  return null
}

/** Tab / Enter inside a range: the active cell walks through it (rows for Tab, columns for Enter) and wraps around. */
function withinRange(selection: GridSelection, range: GridRange, across: boolean, back: boolean): GridSelection {
  let { row, col } = selection.active
  const delta = back ? -1 : 1
  if (across) {
    col += delta
    if (col > range.right) {
      col = range.left
      row = row + 1 > range.bottom ? range.top : row + 1
    } else if (col < range.left) {
      col = range.right
      row = row - 1 < range.top ? range.bottom : row - 1
    }
  } else {
    row += delta
    if (row > range.bottom) {
      row = range.top
      col = col + 1 > range.right ? range.left : col + 1
    } else if (row < range.top) {
      row = range.bottom
      col = col - 1 < range.left ? range.right : col - 1
    }
  }
  return { active: cell(row, col), anchor: { ...selection.anchor }, focus: { ...selection.focus } }
}

/** Which way a fill goes, seen from the cells it copies. */
export type FillDirection = "down" | "up" | "right" | "left"

export interface FillPlan {
  /** The cells being copied or continued. */
  source: GridRange
  /** The cells that get filled (the source not included). */
  target: GridRange
  direction: FillDirection
}

/**
 * Where dragging the fill handle of `source` to `to` fills: the source grows along the axis the pointer went further
 * out on, never both. `null` while the pointer is still inside the source.
 */
export function fillPlan(source: GridRange, to: CellPos): FillPlan | null {
  const down = to.row - source.bottom
  const up = source.top - to.row
  const right = to.col - source.right
  const left = source.left - to.col
  const vertical = Math.max(down, up, 0)
  const horizontal = Math.max(right, left, 0)
  if (vertical === 0 && horizontal === 0) return null
  if (vertical >= horizontal) {
    return down > 0
      ? { source, target: { top: source.bottom + 1, bottom: to.row, left: source.left, right: source.right }, direction: "down" }
      : { source, target: { top: to.row, bottom: source.top - 1, left: source.left, right: source.right }, direction: "up" }
  }
  return right > 0
    ? { source, target: { top: source.top, bottom: source.bottom, left: source.right + 1, right: to.col }, direction: "right" }
    : { source, target: { top: source.top, bottom: source.bottom, left: to.col, right: source.left - 1 }, direction: "left" }
}

/**
 * Ctrl+D (down) and Ctrl+R (right): the first row (column) of the range fills the rest of it. A range one row high
 * (one column wide) takes the row above (the column to the left) instead. `null` when there is nothing to copy from.
 */
export function fillShortcut(range: GridRange, direction: "down" | "right"): FillPlan | null {
  if (direction === "down") {
    if (range.top === range.bottom) {
      if (range.top === 0) return null
      return { source: { ...range, top: range.top - 1, bottom: range.top - 1 }, target: { ...range }, direction }
    }
    return { source: { ...range, bottom: range.top }, target: { ...range, top: range.top + 1 }, direction }
  }
  if (range.left === range.right) {
    if (range.left === 0) return null
    return { source: { ...range, left: range.left - 1, right: range.left - 1 }, target: { ...range }, direction }
  }
  return { source: { ...range, right: range.left }, target: { ...range, left: range.left + 1 }, direction }
}

/** The range covering both. */
export function unionRange(a: GridRange, b: GridRange): GridRange {
  return { top: Math.min(a.top, b.top), left: Math.min(a.left, b.left), bottom: Math.max(a.bottom, b.bottom), right: Math.max(a.right, b.right) }
}
