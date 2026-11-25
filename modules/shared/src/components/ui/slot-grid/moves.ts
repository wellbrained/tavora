// Where a key moves the focus on a board of slots, as pure maths over the slot list. The list is row by row, `columns`
// wide; `null` is a hole (no slot there), and a short last row counts as holes. Holes are skipped; nothing else is.

export type SlotMove = "left" | "right" | "up" | "down" | "rowStart" | "rowEnd" | "first" | "last"

/** The move a key asks for, or null when it isn't one of the grid's keys. Ctrl (or ⌘) with Home and End goes to the ends of the board. */
export function moveOf(event: { key: string, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean, shiftKey?: boolean }): SlotMove | null {
  if (event.altKey || event.shiftKey) return null
  const ctrl = !!(event.ctrlKey || event.metaKey)
  if (event.key === "Home") return ctrl ? "first" : "rowStart"
  if (event.key === "End") return ctrl ? "last" : "rowEnd"
  if (ctrl) return null
  return ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[event.key] ?? null
}

/**
 * The index the focus moves to from `from`, or `from` when there is nowhere to go (an edge without `wrap`).
 * With `wrap`, ← and → go on into the row before or after (the last slot leads to the first), ↑ and ↓ start over at the
 * other end of the column.
 */
export function moveIndex(slots: readonly unknown[], columns: number, from: number, move: SlotMove, wrap = false): number {
  const cols = Math.max(1, Math.floor(columns))
  const count = slots.length
  const rows = Math.ceil(count / cols)
  const isSlot = (index: number) => index >= 0 && index < count && slots[index] != null
  const row = Math.floor(from / cols)

  const first = (start: number, step: number, until: (index: number) => boolean) => {
    for (let index = start; until(index); index += step) if (isSlot(index)) return index
    return -1
  }
  const found = (index: number) => (index < 0 ? from : index)

  switch (move) {
    case "first": return found(first(0, 1, (i) => i < count))
    case "last": return found(first(count - 1, -1, (i) => i >= 0))
    case "rowStart": return found(first(row * cols, 1, (i) => i < Math.min(count, (row + 1) * cols)))
    case "rowEnd": return found(first(Math.min(count, (row + 1) * cols) - 1, -1, (i) => i >= row * cols))
    case "left":
    case "right": {
      const step = move === "right" ? 1 : -1
      if (wrap) {
        for (let n = 1; n < count; n++) {
          const index = (((from + step * n) % count) + count) % count
          if (isSlot(index)) return index
        }
        return from
      }
      return found(first(from + step, step, (i) => i >= row * cols && i < Math.min(count, (row + 1) * cols)))
    }
    case "up":
    case "down": {
      const step = move === "down" ? 1 : -1
      const col = from % cols
      for (let n = 1; n < rows; n++) {
        let r = row + step * n
        if (wrap) r = ((r % rows) + rows) % rows
        else if (r < 0 || r >= rows) return from
        const index = r * cols + col
        if (isSlot(index)) return index
      }
      return from
    }
  }
}

/** Where the focus goes when the slot at `index` went away: the slot now at that place, else the nearest one before it, else the first. */
export function recoverIndex(slots: readonly unknown[], index: number): number {
  for (let i = Math.min(index, slots.length - 1); i >= 0; i--) if (slots[i] != null) return i
  return slots.findIndex((slot) => slot != null)
}

/** How many slots fit in a row, from the slots' boxes on the page: the ones on the same line as the first. */
export function columnsFromBoxes(tops: readonly number[]): number {
  if (!tops.length) return 1
  const top = tops[0]!
  let columns = 0
  for (const t of tops) {
    if (Math.abs(t - top) > 1) break
    columns++
  }
  return columns
}
