import "./drop-line.css"

/**
 * The drop line of a list the user reorders: where the dragged row would land, drawn centred in the gap with a dot at
 * its start. Give each row `:class="dropLine(place, row.id)"` with the place from `useReorderMotion`'s `over`. A list
 * with space between its rows says how much with `--tavora-drop-gap` on itself (`[--tavora-drop-gap:--spacing(2)]` for
 * `gap-2`), so the line sits in the middle of it. The row's `::after` is the line, so the row must not use its own, and the row is `position: relative`.
 */
export function dropLine(place: { id: string; after: boolean } | null, id: string): "tavora-drop-before" | "tavora-drop-after" | false {
  if (place?.id !== id) return false
  return place.after ? "tavora-drop-after" : "tavora-drop-before"
}
