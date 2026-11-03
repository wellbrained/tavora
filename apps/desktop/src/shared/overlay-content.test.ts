import { describe, expect, it } from "vitest";
import { MIN_OVERLAY_SIZE, REFERENCE_HEIGHT, type AnchoredRect } from "./overlay-anchor";
import { CONTENT_PADDING, adoptRect, contentFrameSize, contentScaleFor, fillScale, followRect, resizeContentRect } from "./overlay-content";

const P = CONTENT_PADDING;
const units = (pixels: number) => pixels / REFERENCE_HEIGHT;
const text = { width: 200, height: 50 };

describe("frames that follow their content", () => {
  it("are as big as the content times their scale, with the room around it", () => {
    expect(contentFrameSize(text, 1)).toEqual({ width: 200 + 2 * P, height: 50 + 2 * P });
    expect(contentFrameSize(text, 2)).toEqual({ width: 400 + 2 * P, height: 100 + 2 * P });
    // A dot is no smaller than a frame can be, so it can still be grabbed.
    expect(contentFrameSize({ width: 6, height: 50 }, 1).width).toBe(MIN_OVERLAY_SIZE);
  });

  it("never scale below the smallest frame, nor to nothing or NaN", () => {
    expect(contentScaleFor(0.01, text)).toBeCloseTo((MIN_OVERLAY_SIZE - 2 * P) / 50);
    expect(contentScaleFor(Number.NaN, text)).toBe(1);
    expect(contentScaleFor(1000, text)).toBe(10);
  });

  it("grow and shrink with the content and keep their scale and anchors", () => {
    const right: AnchoredRect = { h: "right", v: "bottom", x: 0.02, y: 0.03, width: units(416), height: units(116) };
    const longer = followRect(right, { width: 260, height: 50 }, 2);
    // Still tied to the right edge, the same distance away: it grows to the left.
    expect(longer).toMatchObject({ h: "right", v: "bottom", x: 0.02, y: 0.03 });
    expect(longer.width).toBeCloseTo(units(520 + 2 * P));
    expect(longer.height).toBeCloseTo(units(116));
  });

  it("take over a frame from before at the scale its content filled it, around the same centre", () => {
    // 500 × 50 with a 200 × 50 text: the text filled it at (50 - 16) / 50 = 0.68, and stays that big where it was.
    const before: AnchoredRect = { h: "left", v: "top", x: units(100), y: units(40), width: units(500), height: units(50) };
    const { rect, scale } = adoptRect(before, text);
    expect(scale).toBeCloseTo(fillScale({ width: 500, height: 50 }, text));
    expect(scale).toBeCloseTo(0.68);
    const width = 200 * 0.68 + 2 * P;
    expect(rect.width).toBeCloseTo(units(width));
    expect(rect.height).toBeCloseTo(units(50));
    expect(rect.x).toBeCloseTo(units(100 + (500 - width) / 2));
    expect(rect.y).toBeCloseTo(units(40));
    // A centred frame keeps its offset from the centre.
    expect(adoptRect({ ...before, h: "center", x: 0.1 }, text).rect.x).toBe(0.1);
  });
});

describe("resizing a frame that follows its content", () => {
  const before = { x: 100, y: 100, width: 216, height: 66 };

  it("scales from a corner drag and keeps the opposite corner", () => {
    // The bottom right corner pulled out to about twice the size.
    const { rect, scale } = resizeContentRect(before, { x: 100, y: 100, width: 420, height: 120 }, text, 1);
    expect(scale).toBeCloseTo((420 - 2 * P) / 200);
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(100);
    expect(rect.width).toBeCloseTo(200 * scale + 2 * P);
    expect(rect.height).toBeCloseTo(50 * scale + 2 * P);
    // The top left corner: the bottom right stays.
    const left = resizeContentRect(before, { x: 50, y: 80, width: 266, height: 86 }, text, 1);
    expect(left.rect.x + left.rect.width).toBeCloseTo(316);
    expect(left.rect.y + left.rect.height).toBeCloseTo(166);
  });

  it("scales from one edge too, keeping the content's shape around the middle of the other side", () => {
    const { rect, scale } = resizeContentRect(before, { x: 100, y: 100, width: 416, height: 66 }, text, 1);
    expect(scale).toBeCloseTo(2);
    expect(rect.height).toBeCloseTo(116);
    expect(rect.y + rect.height / 2).toBeCloseTo(133);
  });

  it("keeps the scale for a move", () => {
    expect(resizeContentRect(before, { ...before, x: 300 }, text, 1.5)).toEqual({ rect: { ...before, x: 300 }, scale: 1.5 });
  });

  it("works in screen pixels of a bigger window", () => {
    // A 2160 px high game: two screen pixels to a pixel of the 1080 px window.
    const { scale, rect } = resizeContentRect({ x: 0, y: 0, width: 432, height: 132 }, { x: 0, y: 0, width: 832, height: 232 }, text, 1, 2);
    expect(scale).toBeCloseTo(2);
    expect(rect.width).toBeCloseTo((200 * 2 + 2 * P) * 2);
  });
});
