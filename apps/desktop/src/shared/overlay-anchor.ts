// Where a game overlay or a panel in game sits in the game's window (the Overlay layout's position model).
//
// Each one anchors to its nearest corner or edge of the game window (left, centre or right; top, middle or bottom) and
// keeps its offset and size in units of the game window's HEIGHT. A window that is wider than 16:9 (a 21:9 monitor) so
// adds room at the sides without stretching anything: a corner overlay stays in its corner at the same size.
//
// Content of overlays and panels in game scales with the same height (contentScale), from a 1080p reference.
//
// Older Tavoras (game-overlays.json version 2) kept a LegacyRect: fractions of the window's width and height. They are
// converted once (migrateLegacy), when the game's real window size is first seen, so each lands exactly where it was.
// Until then they are placed the old way (placeLegacy).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type HorizontalAnchor = "left" | "center" | "right";
export type VerticalAnchor = "top" | "middle" | "bottom";

/**
 * A position in the game window. `x` and `y` are the distance of the anchored edge from the same edge of the window
 * (for centre and middle: of the item's centre from the window's centre, positive to the right and down). All four
 * numbers are in units of the game window's height.
 */
export interface AnchoredRect {
  h: HorizontalAnchor;
  v: VerticalAnchor;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What game-overlays.json version 2 and before saved: fractions of the window's width (x, width) and height (y, height). */
export type LegacyRect = Rect;

/** An overlay can't be smaller than this on screen, so it can always be grabbed. */
export const MIN_OVERLAY_SIZE = 48;
/** The height at which content is shown at its natural size; the layout canvas works in this height too. */
export const REFERENCE_HEIGHT = 1080;
/** How far content may be scaled: a tiny window stays readable, a huge one doesn't make a giant page. */
export const MIN_CONTENT_SCALE = 0.5;
export const MAX_CONTENT_SCALE = 3;

const HORIZONTAL: readonly HorizontalAnchor[] = ["left", "center", "right"];
const VERTICAL: readonly VerticalAnchor[] = ["top", "middle", "bottom"];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The smallest and biggest sizes in units of height that a saved rectangle may have. */
const MIN_UNITS = 0.005;
const MAX_UNITS = 4;
const MAX_OFFSET = 6;

/** What a new overlay is given: the top left corner of the game window (3 % of the height in, 36 x 16 % of it big). */
export const DEFAULT_RECT: AnchoredRect = { h: "left", v: "top", x: 0.036, y: 0.03, width: 0.356, height: 0.16 };
/** A panel in the game is taller than an overlay page: it is a whole panel, not one number. */
export const DEFAULT_PANEL_ANCHORED: AnchoredRect = { h: "left", v: "top", x: 0.036, y: 0.03, width: 0.39, height: 0.4 };

/** A saved rectangle that makes sense, or null: known anchors, finite numbers, sizes in range. */
export function normalizeAnchored(rect: unknown): AnchoredRect | null {
  if (typeof rect !== "object" || rect === null) return null;
  const { h, v, x, y, width, height } = rect as Record<string, unknown>;
  if (!HORIZONTAL.includes(h as HorizontalAnchor) || !VERTICAL.includes(v as VerticalAnchor)) return null;
  if (![x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  return {
    h: h as HorizontalAnchor,
    v: v as VerticalAnchor,
    x: clamp(x as number, -MAX_OFFSET, MAX_OFFSET),
    y: clamp(y as number, -MAX_OFFSET, MAX_OFFSET),
    width: clamp(width as number, MIN_UNITS, MAX_UNITS),
    height: clamp(height as number, MIN_UNITS, MAX_UNITS),
  };
}

/** The zoom range Chromium accepts for a page (webContents.setZoomFactor); outside it the call is refused or ignored. */
export const MIN_ZOOM_FACTOR = 0.25;
export const MAX_ZOOM_FACTOR = 5;

/** A zoom factor Chromium takes: inside its range, and 1 for anything that isn't a number. */
export function pageZoom(factor: number): number {
  return Number.isFinite(factor) ? clamp(factor, MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR) : 1;
}

/** The scale content has in a game window of this height (DIPs): 1 at 1080p. */
export function contentScale(gameHeight: number): number {
  if (!Number.isFinite(gameHeight) || gameHeight <= 0) return 1;
  return clamp(gameHeight / REFERENCE_HEIGHT, MIN_CONTENT_SCALE, MAX_CONTENT_SCALE);
}

/**
 * Where the rectangle lands in the game window `game` (screen coordinates), always inside it. `min` is the smallest
 * size on screen (the canvas passes a scaled one).
 */
export function placeAnchored(rect: AnchoredRect, game: Rect, min = MIN_OVERLAY_SIZE): Rect {
  const unit = game.height;
  const width = Math.min(game.width, Math.max(min, Math.round(rect.width * unit)));
  const height = Math.min(game.height, Math.max(min, Math.round(rect.height * unit)));
  // The offset is rounded together with the rest, so a centred rectangle on an odd pixel lands on the pixel it came from.
  const dx = rect.x * unit;
  const dy = rect.y * unit;
  const left = Math.round(rect.h === "left" ? dx : rect.h === "right" ? game.width - width - dx : (game.width - width) / 2 + dx);
  const top = Math.round(rect.v === "top" ? dy : rect.v === "bottom" ? game.height - height - dy : (game.height - height) / 2 + dy);
  return {
    x: game.x + clamp(left, 0, game.width - width),
    y: game.y + clamp(top, 0, game.height - height),
    width,
    height,
  };
}

/** The index (0 first, 1 second, 2 third) of the smallest distance; the earlier one wins a tie. */
function nearest(first: number, second: number, third: number): number {
  if (first <= second && first <= third) return 0;
  return second <= third ? 1 : 2;
}

/**
 * The anchored rectangle of a rectangle on screen inside the game window `game`: it anchors to the nearest edge or the
 * centre on each axis (a tie goes to left and top, then right and bottom).
 */
export function anchorOf(rect: Rect, game: Rect): AnchoredRect {
  if (game.width <= 0 || game.height <= 0) return { ...DEFAULT_RECT };
  const unit = game.height;
  const left = rect.x - game.x;
  const top = rect.y - game.y;
  const right = game.width - left - rect.width;
  const bottom = game.height - top - rect.height;
  const centreX = left + rect.width / 2 - game.width / 2;
  const centreY = top + rect.height / 2 - game.height / 2;
  const horizontal = nearest(Math.abs(left), Math.abs(right), Math.abs(centreX));
  const vertical = nearest(Math.abs(top), Math.abs(bottom), Math.abs(centreY));
  return normalizeAnchored({
    h: (["left", "right", "center"] as const)[horizontal],
    v: (["top", "bottom", "middle"] as const)[vertical],
    x: [left, right, centreX][horizontal]! / unit,
    y: [top, bottom, centreY][vertical]! / unit,
    width: rect.width / unit,
    height: rect.height / unit,
  })!;
}

/** A legacy rectangle that makes sense, or null (what version 2 files held). */
export function normalizeLegacy(rect: unknown): LegacyRect | null {
  if (typeof rect !== "object" || rect === null) return null;
  const { x, y, width, height } = rect as Record<string, unknown>;
  if (![x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const w = clamp(width as number, 0.02, 1);
  const h = clamp(height as number, 0.02, 1);
  return { x: clamp(x as number, 0, 1 - w), y: clamp(y as number, 0, 1 - h), width: w, height: h };
}

/** Where a legacy rectangle lands in a window of this size (the way every Tavora before the layout placed it). */
export function placeLegacy(rel: LegacyRect, game: Rect, min = MIN_OVERLAY_SIZE): Rect {
  const width = Math.min(game.width, Math.max(min, Math.round(rel.width * game.width)));
  const height = Math.min(game.height, Math.max(min, Math.round(rel.height * game.height)));
  const x = clamp(game.x + Math.round(rel.x * game.width), game.x, game.x + game.width - width);
  const y = clamp(game.y + Math.round(rel.y * game.height), game.y, game.y + game.height - height);
  return { x, y, width, height };
}

/**
 * Converts a legacy rectangle once, so it lands where it was on a window of `size`: it is placed the old way and then
 * anchored to its nearest edges.
 */
export function migrateLegacy(rel: LegacyRect, size: { width: number; height: number }): AnchoredRect {
  const game = { x: 0, y: 0, width: size.width, height: size.height };
  return anchorOf(placeLegacy(rel, game), game);
}
