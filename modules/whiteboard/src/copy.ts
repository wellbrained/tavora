// Copy as picture: which elements go into the picture, and how sharp it can be within what the host's clipboard takes.

/** The parts of an element that decide whether it is copied. */
interface Copyable {
  id: string;
  isDeleted: boolean;
  containerId?: string | null;
  frameId?: string | null;
}

/** The host takes a PNG of at most 16384 px a side; kept well under that and under 20 MB so a copy is quick. */
export const MAX_SIDE = 8192;
export const MAX_PIXELS = 32_000_000;
/** Twice the board's size, so the picture stays sharp when pasted into a chat or a document. */
export const SHARP_SCALE = 2;
/** Space around the drawing, in board units. */
export const COPY_PADDING = 16;

/**
 * What is copied: the selected elements with the text inside them and what lies in a selected frame, or the whole board
 * when nothing is selected. Deleted elements never.
 */
export function elementsToCopy<T extends Copyable>(elements: readonly T[], selectedIds: Readonly<Record<string, boolean>>): T[] {
  const live = elements.filter((element) => !element.isDeleted);
  const selected = new Set(live.filter((element) => selectedIds[element.id]).map((element) => element.id));
  if (selected.size === 0) return live;
  return live.filter(
    (element) => selected.has(element.id) || (element.containerId != null && selected.has(element.containerId)) || (element.frameId != null && selected.has(element.frameId)),
  );
}

/** The scale for a drawing of this size (in board units): sharp, unless that would be too big for the clipboard. */
export function copyScale(width: number, height: number, limit = { side: MAX_SIDE, pixels: MAX_PIXELS }): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(SHARP_SCALE, limit.side / Math.max(width, height), Math.sqrt(limit.pixels / (width * height)));
}
