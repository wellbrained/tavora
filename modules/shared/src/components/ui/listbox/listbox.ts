// What the Listbox works out without the page: which letters of a label a search matched, and where the keys go next.
// Which options a search keeps and how they fall into groups is shared with the Picker (picker/options.ts).

export interface LabelPart {
  text: string
  match: boolean
}

/** The label cut around the first place the search is found in it, so those letters can be bold. One part when it isn't. */
export function matchParts(label: string, query: string): LabelPart[] {
  const text = query.trim().toLowerCase()
  const at = text ? label.toLowerCase().indexOf(text) : -1
  if (at < 0) return [{ text: label, match: false }]
  const end = at + text.length
  return [
    { text: label.slice(0, at), match: false },
    { text: label.slice(at, end), match: true },
    { text: label.slice(end), match: false },
  ].filter((piece) => piece.text)
}

export type Move = "next" | "prev" | "first" | "last" | "pageDown" | "pageUp"

/**
 * Where the lit row goes for a key, as an index into `rows` (the rows in the order they are shown). Rows that can't be
 * picked are skipped. Up and Down wrap around; a page step (`page` rows) and Home or End stop at the ends. With nothing
 * lit, Down and Home go to the first row and Up and End to the last. Undefined when no row can be picked.
 */
export function moveIndex(rows: { disabled?: boolean | string }[], from: number, move: Move, page = 10): number | undefined {
  const open = rows.map((row, index) => (row.disabled ? -1 : index)).filter((index) => index >= 0)
  if (!open.length) return undefined
  const first = open[0]!
  const last = open.at(-1)!
  const lit = open.includes(from)
  switch (move) {
    case "first":
      return first
    case "last":
      return last
    case "next":
      return lit ? (open.find((index) => index > from) ?? first) : first
    case "prev":
      return lit ? (open.findLast((index) => index < from) ?? last) : last
    case "pageDown":
      return lit ? (open.findLast((index) => index <= from + page) ?? last) : first
    case "pageUp":
      return lit ? (open.find((index) => index >= from - page) ?? first) : first
  }
}

/** The move a key asks for, or undefined for a key the list leaves alone. */
export function moveFor(key: string): Move | undefined {
  return ({ ArrowDown: "next", ArrowUp: "prev", Home: "first", End: "last", PageDown: "pageDown", PageUp: "pageUp" } as const)[key]
}
