// Where the board is looked at. Excalidraw keeps a view as the board point at the top-left corner, so a board that
// opens at another size than it was left at shows the drawing pushed aside. Opening keeps the middle where it was
// instead, which puts the drawing back where the user left it.

import type { View } from "./boardState";

export interface Size {
  width: number;
  height: number;
}

interface Shown extends Size {
  scrollX: number;
  scrollY: number;
  zoom: { value: number };
}

const hasSize = (shown: Size) => shown.width > 0 && shown.height > 0;

/** The view to keep of the board as shown, with its size once it has one. */
export function viewOf(shown: Shown): View {
  return { scrollX: shown.scrollX, scrollY: shown.scrollY, zoom: shown.zoom.value, ...(hasSize(shown) ? { width: shown.width, height: shown.height } : {}) };
}

/**
 * What to do when the board is shown at `now`'s size after `before`: nothing (null) while the size is unknown or
 * unchanged; otherwise the size to remember and, when a size was known, the scroll that keeps the middle in place.
 */
export function keepMiddle(before: Size | null, now: Shown): { size: Size; scroll?: { scrollX: number; scrollY: number } } | null {
  if (!hasSize(now)) return null;
  if (before && before.width === now.width && before.height === now.height) return null;
  const size = { width: now.width, height: now.height };
  if (!before) return { size };
  const zoom = now.zoom.value || 1;
  return { size, scroll: { scrollX: now.scrollX + (now.width - before.width) / 2 / zoom, scrollY: now.scrollY + (now.height - before.height) / 2 / zoom } };
}
