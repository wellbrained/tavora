// Putting a deleted item back into its list, for Undo (undoable.ts). No Vue here, so the app's main process can use it.

/**
 * Where an item sat in its list when it was deleted: its index, the key of the item just before it (null: it was
 * first) and of the one just after it (null: it was last).
 */
export interface ListPlace<K> {
  index: number;
  after: K | null;
  before?: K | null;
}

/** Notes where the item with this key sits, before it is taken out. Null when it isn't in the list. */
export function placeOf<T, K>(items: readonly T[], key: K, keyOf: (item: T) => K): ListPlace<K> | null {
  const index = items.findIndex((item) => keyOf(item) === key);
  if (index < 0) return null;
  return { index, after: index > 0 ? keyOf(items[index - 1]!) : null, before: index < items.length - 1 ? keyOf(items[index + 1]!) : null };
}

/**
 * A copy of the list with the item back in its place: right after the item that was before it, so other deletes and
 * their undos in between don't shift it; at the top when it was first. When that neighbour is gone too, right before
 * the one that was after it; at the end when it was last; else at its old index.
 */
export function reinsert<T, K>(items: readonly T[], item: T, place: ListPlace<K>, keyOf: (item: T) => K): T[] {
  const next = [...items];
  const find = (key: K | null | undefined) => (key === null || key === undefined ? -1 : next.findIndex((other) => keyOf(other) === key));
  let at: number;
  if (place.after === null) at = 0;
  else if (find(place.after) >= 0) at = find(place.after) + 1;
  else if (find(place.before) >= 0) at = find(place.before);
  else if (place.before === null) at = next.length;
  else at = Math.min(place.index, next.length);
  next.splice(at, 0, item);
  return next;
}
