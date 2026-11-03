import { describe, expect, it } from "vitest";
import { placeAnchored, REFERENCE_HEIGHT, type AnchoredRect } from "./overlay-anchor";
import { fillScale, fitTextFrame, heightScale, sameFrame, TEXT_FRAME_PADDING } from "./overlay-text-frame";

const U = REFERENCE_HEIGHT;
const P = TEXT_FRAME_PADDING;
/** A frame from canvas px (1080 high), anchored top left. */
const frame = (x: number, y: number, width: number, height: number, h: AnchoredRect["h"] = "left", v: AnchoredRect["v"] = "top"): AnchoredRect => ({ h, v, x: x / U, y: y / U, width: width / U, height: height / U });
const px = (rect: AnchoredRect) => placeAnchored(rect, { x: 0, y: 0, width: 1920, height: 1080 }, 1);

describe("a frame that grows with its text", () => {
  it("is the text at scale 1 with the room around it", () => {
    const next = fitTextFrame(frame(100, 100, 10, 10), { width: 200, height: 50 }, 1, "left");
    expect(px(next)).toEqual({ x: 100, y: 100 - (50 + 2 * P - 10) / 2, width: 200 + 2 * P, height: 50 + 2 * P });
  });

  it("grows by the scale the user gave it", () => {
    const at = frame(100, 100, 2 * 200 + 2 * P, 2 * 50 + 2 * P);
    expect(fillScale(at, { width: 200, height: 50 })).toBeCloseTo(2);
    // A step bigger: the text is 25 % bigger, the frame keeps the scale of 2.
    const next = fitTextFrame(at, { width: 250, height: 62.5 }, heightScale(at, { width: 200, height: 50 }), "left");
    expect(px(next).width).toBe(500 + 2 * P);
    expect(px(next).height).toBe(125 + 2 * P);
  });

  it("keeps the aligned side where it is", () => {
    const at = frame(500, 100, 200 + 2 * P, 50 + 2 * P);
    const wider = { width: 300, height: 50 };
    const left = px(fitTextFrame(at, wider, 1, "left"));
    const right = px(fitTextFrame(at, wider, 1, "right"));
    const center = px(fitTextFrame(at, wider, 1, "center"));
    expect(left.x).toBe(500);
    expect(right.x + right.width).toBe(500 + 200 + 2 * P);
    expect(center.x + center.width / 2).toBe(500 + (200 + 2 * P) / 2);
  });

  it("keeps the aligned side for frames anchored to the right and the centre too", () => {
    for (const h of ["left", "center", "right"] as const) {
      // The same spot on screen, anchored three ways.
      const screen = { x: 900, width: 216 };
      const x = h === "left" ? screen.x : h === "right" ? 1920 - screen.x - screen.width : screen.x + screen.width / 2 - 960;
      const at: AnchoredRect = { h, v: "middle", x: x / U, y: 0, width: screen.width / U, height: 66 / U };
      const next = px(fitTextFrame(at, { width: 300, height: 50 }, 1, "right"));
      expect(next.x + next.width).toBe(screen.x + screen.width);
      expect(next.y + next.height / 2).toBe(540);
    }
  });

  it("fits a frame saved before around the text where it was drawn, at the same size", () => {
    // Today's page drew a "." filling the height of a 500 × 66 frame, centred.
    const old = frame(100, 100, 500, 66);
    const need = { width: 14, height: 50 };
    const scale = fillScale(old, need);
    expect(scale).toBeCloseTo(1);
    const next = px(fitTextFrame(old, need, scale, "center"));
    expect(next.width).toBe(14 + 2 * P);
    expect(next.x + next.width / 2).toBe(350);
    expect(next.height).toBe(66);
  });

  it("keeps a frame saved too tall for its text at the scale its width allowed", () => {
    const old = frame(0, 200, 216, 400);
    const scale = fillScale(old, { width: 200, height: 50 });
    expect(scale).toBeCloseTo(1);
    expect(px(fitTextFrame(old, { width: 200, height: 50 }, scale, "left")).height).toBe(66);
  });

  it("tells frames apart only by a whole pixel", () => {
    const a = frame(100, 100, 200, 50);
    expect(sameFrame(a, { ...a, width: a.width + 0.2 / U })).toBe(true);
    expect(sameFrame(a, { ...a, width: a.width + 1 / U })).toBe(false);
  });
});
