// The sums behind DataGrid's virtual window: where each row and column starts, which ones a scroll position shows, and
// the A, B, … AA names of columns. Pure, so the grid and its tests share it.

/** One direction of the grid: how many rows (or columns) there are and how tall (or wide) each is. */
export interface Axis {
  readonly count: number
  /** Where item `i` starts; `start(count)` is the whole length. */
  start(index: number): number
  size(index: number): number
  /** The item at a position: the last one that starts at or before it, never a hidden (zero-sized) one but the last. */
  indexAt(position: number): number
  readonly total: number
}

/**
 * Builds an axis from a default size and the sizes that differ. A size of 0 hides the item (a filtered row): it takes
 * no room and the grid's keys skip it.
 */
export function makeAxis(count: number, defaultSize: number, sizes?: ReadonlyMap<number, number> | Readonly<Record<number, number>>, hidden?: ReadonlySet<number>): Axis {
  const n = Math.max(0, Math.floor(count))
  const starts = new Float64Array(n + 1)
  const lookup = sizes instanceof Map ? (i: number) => sizes.get(i) : (i: number) => (sizes as Record<number, number> | undefined)?.[i]
  for (let i = 0; i < n; i++) {
    const own = hidden?.has(i) ? 0 : lookup(i)
    starts[i + 1] = starts[i]! + (own === undefined || !Number.isFinite(own) || own < 0 ? defaultSize : own)
  }
  const total = starts[n]!
  return {
    count: n,
    total,
    start: (index) => starts[Math.max(0, Math.min(n, index))]!,
    size: (index) => (index < 0 || index >= n ? 0 : starts[index + 1]! - starts[index]!),
    indexAt(position) {
      if (n === 0) return 0
      if (position <= 0) return firstShown(starts, n, 0)
      if (position >= total) return lastShown(starts, n)
      // The last index whose start is at or before the position; among hidden ones (same start) that is the shown one.
      let low = 0
      let high = n - 1
      while (low < high) {
        const middle = (low + high + 1) >> 1
        if (starts[middle]! <= position) low = middle
        else high = middle - 1
      }
      return low
    },
  }
}

function firstShown(starts: Float64Array, n: number, from: number): number {
  for (let i = from; i < n; i++) if (starts[i + 1]! > starts[i]!) return i
  return Math.min(from, n - 1)
}

function lastShown(starts: Float64Array, n: number): number {
  for (let i = n - 1; i >= 0; i--) if (starts[i + 1]! > starts[i]!) return i
  return n - 1
}

/** Whether an item takes room (a filtered row does not). */
export const isShown = (axis: Axis, index: number): boolean => axis.size(index) > 0

/** The items a scroll position shows past the frozen ones: `[first, last]`, both included, plus `overscan` either side. */
export function visibleRange(axis: Axis, frozen: number, scroll: number, viewport: number, overscan = 2): [number, number] {
  const frozenCount = Math.min(frozen, axis.count)
  if (axis.count <= frozenCount || viewport <= 0) return [frozenCount, frozenCount - 1]
  const frozenSize = axis.start(frozenCount)
  // Past the frozen part, an item at `start` shows at `start - scroll`; the frozen part covers the first `frozenSize`.
  const from = Math.max(frozenCount, axis.indexAt(scroll + frozenSize) - overscan)
  const to = Math.min(axis.count - 1, axis.indexAt(scroll + Math.max(frozenSize, viewport) - 0.5) + overscan)
  return [from, Math.max(from - 1, to)]
}

/** The scroll position that brings an item fully into view (or the same one when it is already, or frozen). */
export function scrollToShow(axis: Axis, frozen: number, scroll: number, viewport: number, index: number): number {
  if (index < Math.min(frozen, axis.count)) return scroll
  const frozenSize = axis.start(Math.min(frozen, axis.count))
  const start = axis.start(index)
  const end = start + axis.size(index)
  if (start - scroll < frozenSize) return Math.max(0, start - frozenSize)
  if (end - scroll > viewport) return Math.max(0, Math.min(start - frozenSize, end - viewport))
  return scroll
}

/** The item under a point that is `position` past the headers, with the frozen part taken into account. */
export function hitIndex(axis: Axis, frozen: number, scroll: number, position: number): number {
  const frozenSize = axis.start(Math.min(frozen, axis.count))
  return axis.indexAt(position < frozenSize ? position : position + scroll)
}

/** "A" for 0, "Z" for 25, "AA" for 26. */
export function columnName(index: number): string {
  let name = ""
  let rest = Math.floor(index) + 1
  while (rest > 0) {
    const digit = (rest - 1) % 26
    name = String.fromCharCode(65 + digit) + name
    rest = Math.floor((rest - 1) / 26)
  }
  return name
}

/** 0 for "A", 26 for "AA"; -1 when it isn't a column name. */
export function columnIndex(name: string): number {
  if (!/^[A-Za-z]{1,4}$/.test(name)) return -1
  let index = 0
  for (const letter of name.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64)
  return index - 1
}
