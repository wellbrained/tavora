// A frame whose overlay text grows with the text (OverlaySource `fit: "text"`): the frame is as big as the text at the scale
// the user gave it by dragging a corner, plus the room the page keeps around it. When the text changes size (a longer
// line, a bigger step), Tavora resizes the frame and keeps the scale; the side the text is aligned to stays where it is.
//
// The page draws the text at the scale that fills its frame (the kit's overlay text, "grow"), so a frame kept to this size
// shows the text exactly as big as the scale says. A frame saved before (any shape) shows its text as it always did: the
// first scale is the one that fills it, and the frame is then fitted around the text where the text was drawn.
import { normalizeAnchored, REFERENCE_HEIGHT, type AnchoredRect } from "./overlay-anchor";

/** The room the page keeps around its text on every side, in canvas units (FIT_PADDING in the modules' sources). */
export const TEXT_FRAME_PADDING = 8;

export type TextAlign = "left" | "center" | "right";
type Size = { width: number; height: number };

const PAD = TEXT_FRAME_PADDING / REFERENCE_HEIGHT;
/** The smallest and biggest scale a frame keeps, so a broken size can't make it vanish or fill the world. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 20;
const clamp = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/** The scale the text is drawn at in this frame: the one that fills it, as the page draws it. */
export function fillScale(rect: AnchoredRect, need: Size): number {
  const width = (rect.width - 2 * PAD) / (need.width / REFERENCE_HEIGHT);
  const height = (rect.height - 2 * PAD) / (need.height / REFERENCE_HEIGHT);
  return clamp(Math.min(width, height));
}

/**
 * The frame around a text of `need` (pixels at 1080p) at `scale`, where `rect` is. The aligned side stays put (the middle for
 * centre), and the middle of its height: a frame anchored to the right edge with right-aligned text grows to the left.
 */
export function fitTextFrame(rect: AnchoredRect, need: Size, scale: number, align: TextAlign): AnchoredRect {
  const width = (need.width / REFERENCE_HEIGHT) * scale + 2 * PAD;
  const height = (need.height / REFERENCE_HEIGHT) * scale + 2 * PAD;
  const dw = width - rect.width;
  const dh = height - rect.height;
  // How far the frame's left edge moves to the left (the anchored offset follows from it).
  const left = align === "left" ? 0 : align === "right" ? dw : dw / 2;
  const x = rect.h === "left" ? rect.x - left : rect.h === "right" ? rect.x - (dw - left) : rect.x + dw / 2 - left;
  // Its top moves up by half the change in height, so the middle stays.
  const y = rect.v === "top" ? rect.y - dh / 2 : rect.v === "bottom" ? rect.y - dh / 2 : rect.y;
  return normalizeAnchored({ ...rect, x, y, width, height }) ?? rect;
}

/** Whether two frames are the same to the pixel at 1080p, so a frame isn't saved again for a rounding. */
export function sameFrame(a: AnchoredRect, b: AnchoredRect): boolean {
  const near = (p: number, q: number) => Math.abs(p - q) * REFERENCE_HEIGHT < 0.5;
  return a.h === b.h && a.v === b.v && near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}
