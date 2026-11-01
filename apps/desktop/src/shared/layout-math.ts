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

/** How far an item moves to sit on the grid drawn on the canvas: by its start edge or by its end edge (right, bottom), whichever is nearer. */
function gridShift(start: number, length: number, cell: number): number {
  const byStart = snapToGrid(start, cell) - start;
  const byEnd = snapToGrid(start + length, cell) - (start + length);
  return Math.abs(byEnd) < Math.abs(byStart) ? byEnd : byStart;
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
    } else if (options.cell > 0) x += gridShift(x, rect.width, options.cell);
    const hitY = nearestTarget([y, y + rect.height / 2, y + rect.height], targets("y", canvas, others), options.threshold);
    if (hitY) {
      y += hitY.shift;
      guides.push({ axis: "y", at: hitY.at });
    } else if (options.cell > 0) y += gridShift(y, rect.height, options.cell);
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
    return options.cell > 0 ? snapToGrid(value, options.cell) : value;
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

/** The box around several rectangles (frames selected together); null for none. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Frames moved together by (dx, dy): only as far as the whole group stays on the canvas, so they keep their places to each
 * other. (The box of the group can be snapped or nudged first, and the difference passed here.)
 */
export function moveGroup(rects: readonly Rect[], dx: number, dy: number, canvas: Canvas): Rect[] {
  const box = boundsOf(rects);
  if (!box) return [];
  const x = clamp(Math.round(box.x + dx), 0, Math.max(0, canvas.width - box.width)) - box.x;
  const y = clamp(Math.round(box.y + dy), 0, Math.max(0, canvas.height - box.height)) - box.y;
  return rects.map((rect) => ({ ...rect, x: rect.x + x, y: rect.y + y }));
}

/** Whether two rectangles touch or overlap (a rubber band selects every frame it touches). */
export function touches(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

/** The canvas for a game window of this shape: the reference height and the width that matches. */
export function canvasFor(aspect: number): Canvas {
  const valid = Number.isFinite(aspect) && aspect > 0.2 && aspect < 8 ? aspect : 16 / 9;
  return { width: Math.round(REFERENCE_HEIGHT * valid), height: REFERENCE_HEIGHT };
}
