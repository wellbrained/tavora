// Frames that follow their content (an overlay source with `grows`, OBS's text source without a bounding box): the frame
// is as big as the content says it is (`OverlaySource.size`) times a scale the user gives it by dragging a corner, with
// the room CONTENT_PADDING around it. When the content gets bigger or smaller (a longer text, a bigger step), the frame
// does too and keeps its scale; Reset size puts the scale back to 100 %. The scale is saved with the frame; the page
// takes it from the frame's height (the OverlayText kit piece), so a text drawn into it is laid out again at the real
// size, never stretched.
//
// Everything here is in pixels of a 1080 px high game window (REFERENCE_HEIGHT), the units of the layout canvas and of a
// source's size; an AnchoredRect keeps its numbers in units of the window's height.
import { MIN_OVERLAY_SIZE, REFERENCE_HEIGHT, type AnchoredRect, type Rect } from "./overlay-anchor";

/** Room kept around a source's content on every side, in pixels of a 1080 px high window; the page keeps the same room. */
export const CONTENT_PADDING = 8;
/** How far a frame that follows its content may be scaled. */
export const MIN_CONTENT_SCALE = 0.25;
export const MAX_CONTENT_SCALE = 10;

export type Size = { width: number; height: number };

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

/**
 * A scale a frame may have: in range, and never so small that the frame would be below the smallest size (the page then
 * takes its scale from a frame taller than the content asks for). 1 for anything that isn't a number.
 */
export function contentScaleFor(scale: number, natural: Size, min = MIN_OVERLAY_SIZE): number {
  const floor = natural.height > 0 ? (min - 2 * CONTENT_PADDING) / natural.height : MIN_CONTENT_SCALE;
  const value = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return Math.min(MAX_CONTENT_SCALE, Math.max(MIN_CONTENT_SCALE, floor, value));
}

/** The frame for content of `natural` size at `scale`, with the room around it; never below the smallest size. */
export function contentFrameSize(natural: Size, scale: number, min = MIN_OVERLAY_SIZE): Size {
  return { width: Math.max(min, natural.width * scale + 2 * CONTENT_PADDING), height: Math.max(min, natural.height * scale + 2 * CONTENT_PADDING) };
}

/** The scale content has when it fills a frame of this size (how a frame from before, which didn't follow its content, showed it). */
export function fillScale(frame: Size, natural: Size): number {
  if (!(natural.width > 0) || !(natural.height > 0)) return 1;
  return Math.min((frame.width - 2 * CONTENT_PADDING) / natural.width, (frame.height - 2 * CONTENT_PADDING) / natural.height);
}

const units = (pixels: number) => pixels / REFERENCE_HEIGHT;

/** The saved position of a frame that follows content of `natural` size at `scale`: the size changes, the anchors stay (a frame tied to the right edge grows to the left). */
export function followRect(rect: AnchoredRect, natural: Size, scale: number): AnchoredRect {
  const size = contentFrameSize(natural, scale);
  return { ...rect, width: units(size.width), height: units(size.height) };
}

/**
 * A frame from before that starts to follow its content: the scale that shows the content as big as it was (it filled
 * the frame), and the frame hugging it around the same centre, so it looks the same where it was.
 */
export function adoptRect(rect: AnchoredRect, natural: Size): { rect: AnchoredRect; scale: number } {
  const scale = contentScaleFor(fillScale({ width: rect.width * REFERENCE_HEIGHT, height: rect.height * REFERENCE_HEIGHT }, natural), natural);
  const size = contentFrameSize(natural, scale);
  const width = units(size.width);
  const height = units(size.height);
  // An edge anchor is the distance of that edge: it moves in by half of what the frame gives up. A centre stays.
  const x = rect.h === "center" ? rect.x : rect.x + (rect.width - width) / 2;
  const y = rect.v === "middle" ? rect.y : rect.y + (rect.height - height) / 2;
  return { rect: { ...rect, x, y, width, height }, scale };
}

/**
 * A frame that follows its content, after a drag made it `after` (from `before`; any pixels, `unit` of them to a pixel
 * of a 1080 px high window). The size gives the scale (from the side that changed most, when both did), and the frame
 * takes the size of that scale, on the edges the drag didn't move; a side whose two edges both stayed keeps its centre.
 * A move keeps the scale.
 */
export function resizeContentRect(before: Rect, after: Rect, natural: Size, scale: number, unit = 1, min = MIN_OVERLAY_SIZE): { rect: Rect; scale: number } {
  if (near(before.width, after.width) && near(before.height, after.height)) return { rect: after, scale };
  const widthBy = Math.abs(after.width / before.width - 1);
  const heightBy = Math.abs(after.height / before.height - 1);
  const pad = 2 * CONTENT_PADDING * unit;
  const wanted = widthBy > heightBy ? (after.width - pad) / (natural.width * unit) : (after.height - pad) / (natural.height * unit);
  const next = contentScaleFor(wanted, natural, min);
  const size = contentFrameSize(natural, next, min);
  const width = size.width * unit;
  const height = size.height * unit;
  const place = (start: number, end: number, from: number, to: number, length: number) => {
    const startKept = near(start, from);
    const endKept = near(end, to);
    if (startKept && !endKept) return from;
    if (endKept && !startKept) return to - length;
    return (from + to) / 2 - length / 2;
  };
  return {
    rect: {
      x: place(before.x, before.x + before.width, after.x, after.x + after.width, width),
      y: place(before.y, before.y + before.height, after.y, after.y + after.height, height),
      width,
      height,
    },
    scale: next,
  };
}
