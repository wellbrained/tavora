// The Overlay layout's canvas math, with no screen or Electron in it: the grid, snapping a dragged or resized item to
// the grid, the canvas edges, the centre lines and the edges of other items, and nudging with the arrow keys.
// Everything is in canvas units: the game window at a reference height of REFERENCE_HEIGHT (1080) and its own width, so
// the same numbers work at any size the canvas is drawn at.
import { MIN_OVERLAY_SIZE, REFERENCE_HEIGHT, type Rect } from "./overlay-anchor";

/** The grid menu: how many cells fit in the window's height; Off has none. */
export const GRID_SETTINGS = ["fine", "normal", "coarse", "off"] as const;
export type GridSetting = (typeof GRID_SETTINGS)[number];
export const DEFAULT_GRID: GridSetting = "normal";

const CELLS: Record<GridSetting, number> = { fine: 72, normal: 36, coarse: 18, off: 0 };

/** The size of one grid cell in canvas units (30 at Normal); 0 with the grid off. */
export function gridCell(setting: GridSetting, height = REFERENCE_HEIGHT): number {
  return CELLS[setting] === 0 ? 0 : height / CELLS[setting];
}

export function isGridSetting(value: unknown): value is GridSetting {
  return typeof value === "string" && (GRID_SETTINGS as readonly string[]).includes(value);
}

export interface Canvas {
  width: number;
  height: number;
}

/** A line shown while an item snaps to something: the axis it is on, where, and how far it runs. */
export interface Guide {
  axis: "x" | "y";
  at: number;
}

export interface SnapOptions {
  /** One grid cell; 0 for none. */
  cell: number;
  /** How close (canvas units) an edge must come to a guide to snap to it. */
  threshold: number;
  /** Alt is held: nothing snaps. */
  free: boolean;
}

export interface Edges {
  left?: boolean;
  right?: boolean;
  top?: boolean;
  bottom?: boolean;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The places on one axis an edge can snap to: the canvas's edges and centre line, and the edges of the other items. */
function targets(axis: "x" | "y", canvas: Canvas, others: readonly Rect[]): number[] {
  const size = axis === "x" ? canvas.width : canvas.height;
  const list = [0, size / 2, size];
  for (const other of others) {
    if (axis === "x") list.push(other.x, other.x + other.width);
    else list.push(other.y, other.y + other.height);
  }
  return list;
}

/** The nearest target within `threshold` of any of `values`, as how far to move and the target; null when none is near. */
function nearestTarget(values: readonly number[], places: readonly number[], threshold: number): { shift: number; at: number } | null {
  let best: { shift: number; at: number } | null = null;
  for (const value of values) {
    for (const at of places) {
      const shift = at - value;
      if (Math.abs(shift) <= threshold && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, at };
    }
  }
  return best;
}

const snapToGrid = (value: number, cell: number) => Math.round(value / cell) * cell;

/** The same grid counted from the far edge of the canvas, so a right or bottom edge can sit on the canvas edge's own lines. */
const snapToGridFromEnd = (value: number, cell: number, size: number) => size - Math.round((size - value) / cell) * cell;

/** How far an item moves to sit on the grid: by its start edge from the start of the canvas, or by its end edge from the end, whichever is nearer. */
function gridShift(start: number, length: number, size: number, cell: number): number {
  const fromStart = snapToGrid(start, cell) - start;
  const fromEnd = snapToGridFromEnd(start + length, cell, size) - (start + length);
  return Math.abs(fromEnd) < Math.abs(fromStart) ? fromEnd : fromStart;
}

/** Where a dragged item ends up: `rect` is where the pointer put it, `others` are the rectangles of the other items. */
export function snapMove(rect: Rect, canvas: Canvas, others: readonly Rect[], options: SnapOptions): { rect: Rect; guides: Guide[] } {
  let { x, y } = rect;
  const guides: Guide[] = [];
  if (!options.free) {
    const hitX = nearestTarget([x, x + rect.width / 2, x + rect.width], targets("x", canvas, others), options.threshold);
    if (hitX) {
      x += hitX.shift;
      guides.push({ axis: "x", at: hitX.at });
    } else if (options.cell > 0) x += gridShift(x, rect.width, canvas.width, options.cell);
    const hitY = nearestTarget([y, y + rect.height / 2, y + rect.height], targets("y", canvas, others), options.threshold);
    if (hitY) {
      y += hitY.shift;
      guides.push({ axis: "y", at: hitY.at });
    } else if (options.cell > 0) y += gridShift(y, rect.height, canvas.height, options.cell);
  }
  return {
    rect: {
      x: clamp(Math.round(x), 0, Math.max(0, canvas.width - rect.width)),
      y: clamp(Math.round(y), 0, Math.max(0, canvas.height - rect.height)),
      width: rect.width,
      height: rect.height,
    },
    guides,
  };
}

/** Where a resized item ends up: `rect` is what the pointer made of it, `edges` the ones being pulled. */
export function snapResize(rect: Rect, edges: Edges, canvas: Canvas, others: readonly Rect[], options: SnapOptions, min = MIN_OVERLAY_SIZE): { rect: Rect; guides: Guide[] } {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  const guides: Guide[] = [];
  const snapEdge = (axis: "x" | "y", value: number): number => {
    if (options.free) return value;
    const hit = nearestTarget([value], targets(axis, canvas, others), options.threshold);
    if (hit) {
      guides.push({ axis, at: hit.at });
      return hit.at;
    }
    if (options.cell <= 0) return value;
    // A right or bottom edge counts its grid from the far side of the canvas.
    const far = (axis === "x" && value === right) || (axis === "y" && value === bottom);
    return far ? snapToGridFromEnd(value, options.cell, axis === "x" ? canvas.width : canvas.height) : snapToGrid(value, options.cell);
  };
  if (edges.left) left = snapEdge("x", left);
  if (edges.right) right = snapEdge("x", right);
  if (edges.top) top = snapEdge("y", top);
  if (edges.bottom) bottom = snapEdge("y", bottom);
  if (edges.left) left = clamp(Math.round(left), 0, right - min);
  if (edges.right) right = clamp(Math.round(right), left + min, canvas.width);
  if (edges.top) top = clamp(Math.round(top), 0, bottom - min);
  if (edges.bottom) bottom = clamp(Math.round(bottom), top + min, canvas.height);
  return { rect: { x: left, y: top, width: right - left, height: bottom - top }, guides };
}

/** An arrow key moves the item by one cell (one unit with the grid off), five with Shift; it stays on the canvas. */
export function nudge(rect: Rect, direction: "left" | "right" | "up" | "down", canvas: Canvas, cell: number, big: boolean): Rect {
  const step = (cell > 0 ? cell : 1) * (big ? 5 : 1);
  const dx = direction === "left" ? -step : direction === "right" ? step : 0;
  const dy = direction === "up" ? -step : direction === "down" ? step : 0;
  return {
    ...rect,
    x: clamp(Math.round(rect.x + dx), 0, Math.max(0, canvas.width - rect.width)),
    y: clamp(Math.round(rect.y + dy), 0, Math.max(0, canvas.height - rect.height)),
  };
}

/** The canvas for a game window of this shape: the reference height and the width that matches. */
export function canvasFor(aspect: number): Canvas {
  const valid = Number.isFinite(aspect) && aspect > 0.2 && aspect < 8 ? aspect : 16 / 9;
  return { width: Math.round(REFERENCE_HEIGHT * valid), height: REFERENCE_HEIGHT };
}
