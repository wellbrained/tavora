import { describe, expect, it } from "vitest";
import { carryOn, holdScale, OVERLAY_TEXT_DEFAULTS, OVERLAY_TEXT_PAUSES, pauseStep, planText, readOverlayTextSettings, SCROLL_SPEED, scrollRound } from "./plan";

const box = (width: number, height: number) => ({ width, height });
const plan = (mode: "grow" | "fixed", overflow: "scroll" | "shrink" | "clip", room: { width: number; height: number }, natural: { width: number; height: number }, reducedMotion = false) =>
  planText({ mode, overflow, room, natural, reducedMotion });

describe("planText: grows with the text", () => {
  it("scales the text with its box, keeping its shape", () => {
    expect(plan("grow", "scroll", box(200, 100), box(100, 50))).toEqual({ kind: "fit", scale: 2 });
    expect(plan("grow", "scroll", box(50, 25), box(100, 50))).toEqual({ kind: "fit", scale: 0.5 });
  });

  it("takes the side with less room when the box is another shape (a frame from before)", () => {
    expect(plan("grow", "scroll", box(500, 50), box(20, 50))).toEqual({ kind: "fit", scale: 1 });
    expect(plan("grow", "clip", box(100, 400), box(100, 50))).toEqual({ kind: "fit", scale: 1 });
  });

  it("never scrolls or cuts a growing text", () => {
    expect(plan("grow", "scroll", box(10, 50), box(400, 50)).kind).toBe("fit");
    expect(plan("grow", "clip", box(10, 50), box(400, 50)).kind).toBe("fit");
  });
});

describe("planText: a fixed box", () => {
  it("keeps a short text at its size: a dot in a big box stays a dot", () => {
    expect(plan("fixed", "scroll", box(500, 50), box(12, 50))).toEqual({ kind: "fit", scale: 1 });
    expect(plan("fixed", "shrink", box(500, 200), box(12, 50))).toEqual({ kind: "fit", scale: 1 });
  });

  it("doesn't scroll a text that fits, even exactly", () => {
    expect(plan("fixed", "scroll", box(300, 50), box(300, 50)).kind).toBe("fit");
    expect(plan("fixed", "scroll", box(300, 50), box(300.4, 50)).kind).toBe("fit");
  });

  it("scrolls a text too long", () => {
    expect(plan("fixed", "scroll", box(300, 50), box(301, 50))).toEqual({ kind: "scroll", scale: 1 });
  });

  it("shrinks a text too long until it fits, and never makes it bigger", () => {
    expect(plan("fixed", "shrink", box(300, 50), box(600, 50))).toEqual({ kind: "fit", scale: 0.5 });
    expect(plan("fixed", "shrink", box(300, 20), box(600, 50))).toEqual({ kind: "fit", scale: 0.4 });
    expect(plan("fixed", "shrink", box(600, 20), box(300, 50))).toEqual({ kind: "fit", scale: 0.4 });
  });

  it("cuts off a text too long", () => {
    expect(plan("fixed", "clip", box(300, 50), box(600, 50))).toEqual({ kind: "clip", scale: 1 });
  });

  it("cuts off instead of scrolling for reduced motion", () => {
    expect(plan("fixed", "scroll", box(300, 50), box(600, 50), true)).toEqual({ kind: "clip", scale: 1 });
    expect(plan("fixed", "shrink", box(300, 50), box(600, 50), true)).toEqual({ kind: "fit", scale: 0.5 });
  });

  it("starts and stops scrolling as the text gets longer and shorter", () => {
    const kinds = [100, 400, 250, 301, 300].map((width) => plan("fixed", "scroll", box(300, 50), box(width, 50)).kind);
    expect(kinds).toEqual(["fit", "scroll", "fit", "scroll", "fit"]);
  });

  it("scrolls once the box is made narrower than the text, and stops when it is wide again", () => {
    expect(plan("fixed", "scroll", box(500, 50), box(400, 50)).kind).toBe("fit");
    expect(plan("fixed", "scroll", box(300, 50), box(400, 50)).kind).toBe("scroll");
    expect(plan("fixed", "scroll", box(450, 50), box(400, 50)).kind).toBe("fit");
  });

  it("is safe with nothing to show", () => {
    expect(plan("fixed", "scroll", box(300, 50), box(0, 0))).toEqual({ kind: "fit", scale: 1 });
    expect(plan("grow", "scroll", box(0, 0), box(100, 50)).kind).toBe("fit");
  });
});

describe("scrollRound", () => {
  it("runs the text's width and the gap at the speed, after the pause", () => {
    expect(scrollRound(800, "normal", 2)).toEqual({ duration: (800 / SCROLL_SPEED.normal) * 1000 + 2000, still: 2000 / 12000 });
    expect(scrollRound(800, "fast", 0)).toEqual({ duration: 5000, still: 0 });
    expect(scrollRound(800, "slow", 0).duration).toBeGreaterThan(scrollRound(800, "normal", 0).duration);
  });
});

describe("carryOn", () => {
  it("keeps its place in the round when the text ticks", () => {
    expect(carryOn({ time: 3000, duration: 10_000 }, 11_000, false)).toBeCloseTo(3300);
    // Several rounds in: the place in the round now.
    expect(carryOn({ time: 23_000, duration: 10_000 }, 10_000, false)).toBeCloseTo(3000);
  });

  it("starts from the beginning for a new text, or a first round", () => {
    expect(carryOn({ time: 3000, duration: 10_000 }, 10_000, true)).toBe(0);
    expect(carryOn(null, 10_000, false)).toBe(0);
  });
});

describe("holdScale", () => {
  it("keeps the scale a moment while the box catches up with a wider text", () => {
    expect(holdScale(0.8, 1, 1, true)).toBe(1);
  });

  it("shows the new scale at once once the moment is over, or when the box itself changed", () => {
    expect(holdScale(0.8, 1, 1, false)).toBe(0.8);
    expect(holdScale(0.8, 1, 0.8, true)).toBe(0.8);
    expect(holdScale(1.2, 1, 1.2, true)).toBe(1.2);
    expect(holdScale(0.8, null, 1, true)).toBe(0.8);
  });
});

describe("saved settings", () => {
  it("reads what was saved, and the defaults for what is missing or broken", () => {
    expect(readOverlayTextSettings(undefined)).toEqual(OVERLAY_TEXT_DEFAULTS);
    expect(readOverlayTextSettings({ mode: "fixed", overflow: "clip", speed: "fast", pause: 0, softEdges: false })).toEqual({ mode: "fixed", overflow: "clip", speed: "fast", pause: 0, softEdges: false });
    expect(readOverlayTextSettings({ mode: "huge", overflow: 3, pause: "x", softEdges: "yes" })).toEqual(OVERLAY_TEXT_DEFAULTS);
  });

  it("puts a pause on its nearest step", () => {
    expect(pauseStep(1.2)).toBe(1);
    expect(pauseStep(9)).toBe(5);
    expect(pauseStep(-1)).toBe(0);
    expect(pauseStep(Number.NaN)).toBe(2);
    expect(OVERLAY_TEXT_PAUSES).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  });

  it("defaults to growing with the text; a fixed box scrolls, at normal speed, pauses 2 s, with soft edges", () => {
    expect(OVERLAY_TEXT_DEFAULTS).toEqual({ mode: "grow", overflow: "scroll", speed: "normal", pause: 2, softEdges: true });
  });
});
