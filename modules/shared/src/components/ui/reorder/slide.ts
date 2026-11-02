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
