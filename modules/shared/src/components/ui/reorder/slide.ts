/** The pure part of reorder motion: how far each item slides to open a gap where the dragged one would land. */

/** One item of a list along its axis: where it starts and how much room it takes. */
export interface Slot {
  id: string
  start: number
  size: number
}

/** The ids with `id` put next to `target`: before it, or after it with `after`. Unchanged for an unknown id or the item itself. */
export function placeNextTo(ids: readonly string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return [...ids]
  const rest = ids.filter((other) => other !== id)
  const at = rest.indexOf(target) + (after ? 1 : 0)
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/**
 * How far every item moves along the axis, in pixels, once `id` sits next to `target`. The list is laid out again in
 * the new order from where the first slot starts, each item keeping its own size and each place keeping the gap that
 * followed it, so rows of different heights and lists with spacing come out right. `slots` are in their current order.
 */
export function slideOffsets(slots: readonly Slot[], id: string, target: string, after: boolean): Map<string, number> {
  const offsets = new Map<string, number>()
  const order = placeNextTo(slots.map((slot) => slot.id), id, target, after)
  const byId = new Map(slots.map((slot) => [slot.id, slot]))
  const gaps = slots.map((slot, index) => {
    const next = slots[index + 1]
    return next ? next.start - (slot.start + slot.size) : 0
  })
  let cursor = slots[0]?.start ?? 0
  order.forEach((key, index) => {
    const slot = byId.get(key)!
    offsets.set(key, cursor - slot.start)
    cursor += slot.size + (gaps[index] ?? 0)
  })
  return offsets
}

/**
 * Where the dragged item lands for a pointer at `pointer` (along the axis), judged against the layout as it was when the
 * drag began, never against the items as they are on screen. The others slide aside while a drag runs, so measuring them
 * live makes a row that has just slid under the pointer ask for the swap back, again and again. Against the settled
 * layout the answer depends on the pointer alone: the item goes before the first other one whose middle the pointer has
 * not passed, or last. `among` limits which items count as places (a list that is shown in parts). Null when that would
 * leave the order as it is.
 */
export function placeAt(slots: readonly Slot[], id: string, pointer: number, among?: readonly string[]): { id: string; after: boolean } | null {
  const others = slots.filter((slot) => slot.id !== id && (!among || among.includes(slot.id)))
  const last = others[others.length - 1]
  if (!last || !slots.some((slot) => slot.id === id)) return null
  const next = others.find((slot) => pointer < slot.start + slot.size / 2)
  const place = next ? { id: next.id, after: false } : { id: last.id, after: true }
  const order = slots.map((slot) => slot.id)
  return placeNextTo(order, id, place.id, place.after).join("\n") === order.join("\n") ? null : place
}

/**
 * Where the pointer is in the coordinates the slots were measured in at the grab. The list may have moved on the screen
 * since (an ancestor scrolled, the window did), and its own content may have scrolled: `originNow - origin0` is the first,
 * `scrollNow - scroll0` the second.
 */
export function pointerAtGrab(pointer: number, origin0: number, originNow: number, scroll0: number, scrollNow: number): number {
  return pointer + (origin0 - originNow) + (scrollNow - scroll0)
}
