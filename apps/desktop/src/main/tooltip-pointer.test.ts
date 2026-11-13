import { describe, expect, it } from "vitest";
import { BOX_MAX, POINTER_FRESH_MS, pointerOverAnchor } from "./tooltip-pointer";

const now = 10_000;
const pointer = (x: number, y: number, at = now) => ({ x, y, at });
// A 9 Kings Kingdom plot: 86 px wide, the card's point at the middle of its right edge.
const box = { x: 10, y: 20, width: 86, height: 86 };
const plot = { at: { x: 96, y: 63 }, box };

describe("pointerOverAnchor", () => {
  it("takes a pointer anywhere over a big anchor, far from at", () => {
    expect(pointerOverAnchor(pointer(18, 63), plot, now)).toBe(true);
    expect(pointerOverAnchor(pointer(12, 22), plot, now)).toBe(true);
    // Within the 8 px margin.
    expect(pointerOverAnchor(pointer(3, 112), plot, now)).toBe(true);
    // The same pointer without the box is 78 px from at: refused, as before.
    expect(pointerOverAnchor(pointer(18, 63), { at: plot.at }, now)).toBe(false);
  });

  it("refuses a pointer outside the box and its margin", () => {
    expect(pointerOverAnchor(pointer(1, 63), plot, now)).toBe(false);
    expect(pointerOverAnchor(pointer(50, 116), plot, now)).toBe(false);
    // Near at but outside the box: the box decides, not the 40 px rule.
    expect(pointerOverAnchor(pointer(130, 63), plot, now)).toBe(false);
  });

  it("falls back to the 40 px rule for a box it can't use", () => {
    const huge = { at: { x: 1000, y: 300 }, box: { x: 0, y: 0, width: 1000, height: 600 } };
    expect(BOX_MAX).toBeLessThan(1000);
    expect(pointerOverAnchor(pointer(20, 300), huge, now)).toBe(false);
    expect(pointerOverAnchor(pointer(970, 300), huge, now)).toBe(true);
    // at not on the box: a box somewhere else says nothing about this card.
    const elsewhere = { at: { x: 400, y: 400 }, box };
    expect(pointerOverAnchor(pointer(50, 60), elsewhere, now)).toBe(false);
    expect(pointerOverAnchor(pointer(390, 410), elsewhere, now)).toBe(true);
    // No size.
    expect(pointerOverAnchor(pointer(20, 63), { at: { x: 10, y: 63 }, box: { x: 10, y: 20, width: 0, height: 86 } }, now)).toBe(true);
    expect(pointerOverAnchor(pointer(60, 63), { at: { x: 10, y: 63 }, box: { x: 10, y: 20, width: 0, height: 86 } }, now)).toBe(false);
  });

  it("allows a pixel of rounding between at and the box", () => {
    expect(pointerOverAnchor(pointer(18, 63), { at: { x: 96.8, y: 63.4 }, box }, now)).toBe(true);
  });

  it("needs a fresh pointer report", () => {
    expect(pointerOverAnchor(null, plot, now)).toBe(false);
    expect(pointerOverAnchor(pointer(18, 63, now - POINTER_FRESH_MS), plot, now)).toBe(false);
    expect(pointerOverAnchor(pointer(18, 63, now - POINTER_FRESH_MS + 1), plot, now)).toBe(true);
  });
});
