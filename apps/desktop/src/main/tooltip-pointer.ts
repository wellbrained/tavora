import type { TooltipAnchor } from "@tavora/sdk/protocol";

/** The pointer the panel's preload last reported, in panel CSS px, and when. */
export type ReportedPointer = { x: number; y: number; at: number };

/** How old the last pointer report may be. */
export const POINTER_FRESH_MS = 2_000;
/** Without a box: how close (in x and in y) the pointer must be to `at`. */
export const POINTER_NEAR = 40;
/** With a box: how far outside it the pointer may be (its edge, a border, rounding). */
export const BOX_MARGIN = 8;
/**
 * The biggest box Tavora takes, per side. Hover cards are for things (a cell, a card, a marker, a row's item), and the
 * card shows at the box's right edge: past this size the card would open far from the pointer, and the box stops
 * saying where the user points (a whole map or list). Such a box falls back to the 40 px rule.
 */
export const BOX_MAX = 600;

/** A box the pointer rule can use: a real size, at most BOX_MAX a side, and `at` on it (1 px for rounding). */
function usableBox(anchor: Pick<TooltipAnchor, "at" | "box">): TooltipAnchor["box"] | null {
  const b = anchor.box, at = anchor.at;
  if (!b || !(b.width > 0 && b.height > 0 && b.width <= BOX_MAX && b.height <= BOX_MAX)) return null;
  const on = at.x >= b.x - 1 && at.x <= b.x + b.width + 1 && at.y >= b.y - 1 && at.y <= b.y + b.height + 1;
  return on ? b : null;
}

/**
 * Whether a hover card (`ui.tooltip.show` without a pin, `ui.tooltip.move`) follows the user's pointer: a fresh report
 * within POINTER_NEAR of `at`, or over the anchor's box (plus BOX_MARGIN) when the module sent a usable one. The box only
 * adds room, so a small anchor keeps the 40 px it always had.
 */
export function pointerOverAnchor(pointer: ReportedPointer | null, anchor: Pick<TooltipAnchor, "at" | "box">, now = Date.now()): boolean {
  if (!pointer || now - pointer.at >= POINTER_FRESH_MS) return false;
  const b = usableBox(anchor);
  if (b && pointer.x >= b.x - BOX_MARGIN && pointer.x <= b.x + b.width + BOX_MARGIN && pointer.y >= b.y - BOX_MARGIN && pointer.y <= b.y + b.height + BOX_MARGIN) return true;
  return Math.abs(pointer.x - anchor.at.x) < POINTER_NEAR && Math.abs(pointer.y - anchor.at.y) < POINTER_NEAR;
}
