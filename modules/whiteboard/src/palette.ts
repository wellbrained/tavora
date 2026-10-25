// Where Excalidraw's style palette sits on the board, and the maths that keeps it there (Palette.vue).

export interface PalettePlace {
  /** How far the palette is moved from where Excalidraw puts it, in pixels. */
  x: number;
  y: number;
  collapsed: boolean;
  /** Whether the less used options (sloppiness, edges, opacity, align, actions, …) are shown too. */
  more: boolean;
}

export const DEFAULT_PALETTE: PalettePlace = { x: 0, y: 0, collapsed: false, more: false };

/** Reads a stored place, falling back to the default for anything that is not one. */
export function palettePlace(value: unknown): PalettePlace {
  if (!value || typeof value !== "object") return DEFAULT_PALETTE;
  const { x, y, collapsed, more } = value as Record<string, unknown>;
  return {
    x: typeof x === "number" && Number.isFinite(x) ? x : 0,
    y: typeof y === "number" && Number.isFinite(y) ? y : 0,
    collapsed: collapsed === true,
    more: more === true,
  };
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How much of the palette stays on the board at least, so its handle can always be grabbed again. */
const KEEP = 40;

/**
 * The offset moved so the palette stays on the board: all of its width when it fits, and its handle at the top.
 * `home` is where the palette is without any offset.
 */
export function clampPlace(x: number, y: number, home: Box, board: Box): { x: number; y: number } {
  const width = home.right - home.left;
  const minX = board.left - home.left;
  const maxX = Math.max(minX, board.right - width - home.left);
  const minY = board.top - home.top;
  const maxY = Math.max(minY, board.bottom - KEEP - home.top);
  return { x: Math.round(Math.min(maxX, Math.max(minX, x))), y: Math.round(Math.min(maxY, Math.max(minY, y))) };
}
