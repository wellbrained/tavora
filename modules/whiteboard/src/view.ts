// Where the board is looked at. Excalidraw keeps a view as the board point at the top-left corner, so a panel that
// opens at another size (or grows to its place in the layout a moment after opening) shows the drawing pushed aside.
// Keeping the middle where it was instead puts the drawing back where the user left it.

export interface Size {
  width: number;
  height: number;
}

interface Shown extends Size {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
}

/**
 * What to do when the board is shown at `now`'s size after `before`: nothing (null) while the size is unknown or
 * unchanged; otherwise the size to remember and, when a size was known, the scroll that keeps the middle in place.
 */
export function keepMiddle(before: Size | null, now: Shown): { size: Size; scroll?: { scrollX: number; scrollY: number } } | null {
  if (!(now.width > 0) || !(now.height > 0)) return null;
  if (before && before.width === now.width && before.height === now.height) return null;
  const size = { width: now.width, height: now.height };
  if (!before) return { size };
  const zoom = now.zoom.value || 1;
  return { size, scroll: { scrollX: now.scrollX + (now.width - before.width) / 2 / zoom, scrollY: now.scrollY + (now.height - before.height) / 2 / zoom } };
}
