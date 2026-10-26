import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECT,
  MAX_CONTENT_SCALE,
  MIN_CONTENT_SCALE,
  MIN_OVERLAY_SIZE,
  anchorOf,
  contentScale,
  migrateLegacy,
  normalizeAnchored,
  pageZoom,
  normalizeLegacy,
  placeAnchored,
  placeLegacy,
  type AnchoredRect,
  type LegacyRect,
  type Rect,
} from "./overlay-anchor";

const game = (width: number, height: number, x = 0, y = 0): Rect => ({ x, y, width, height });
const near = (a: Rect, b: Rect, by = 0) => {
  for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(a[key] - b[key]), key).toBeLessThanOrEqual(by);
};

describe("placeAnchored", () => {
  it("places a corner overlay by offsets and size in units of the height", () => {
    const rect: AnchoredRect = { h: "left", v: "top", x: 0.1, y: 0.05, width: 0.3, height: 0.2 };
    expect(placeAnchored(rect, game(1920, 1080))).toEqual({ x: 108, y: 54, width: 324, height: 216 });
  });

  it("measures a right and bottom anchor from the right and bottom edges", () => {
    const rect: AnchoredRect = { h: "right", v: "bottom", x: 0.1, y: 0.05, width: 0.3, height: 0.2 };
    expect(placeAnchored(rect, game(1920, 1080))).toEqual({ x: 1920 - 324 - 108, y: 1080 - 216 - 54, width: 324, height: 216 });
  });

  it("measures a centre anchor from the middle of the window", () => {
    const rect: AnchoredRect = { h: "center", v: "middle", x: 0, y: 0, width: 0.5, height: 0.25 };
    expect(placeAnchored(rect, game(1920, 1080))).toEqual({ x: 690, y: 405, width: 540, height: 270 });
  });

  it("adds the game window's own position", () => {
    const rect: AnchoredRect = { h: "left", v: "top", x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    expect(placeAnchored(rect, game(1280, 720, 100, 50))).toMatchObject({ x: 100 + 72, y: 50 + 72 });
  });

  it("keeps a corner and a size when the window gets wider (16:9 to 21:9)", () => {
    const left: AnchoredRect = { h: "left", v: "top", x: 0.05, y: 0.04, width: 0.3, height: 0.2 };
    const right: AnchoredRect = { ...left, h: "right" };
    const wide = placeAnchored(left, game(2520, 1080));
    const normal = placeAnchored(left, game(1920, 1080));
    expect(wide).toEqual(normal);
    expect(placeAnchored(right, game(2520, 1080))).toEqual({ ...normal, x: 2520 - 324 - 54 });
  });

  it("scales offsets and size with the height", () => {
    const rect: AnchoredRect = { h: "left", v: "top", x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const small = placeAnchored(rect, game(1280, 720));
    const big = placeAnchored(rect, game(2560, 1440));
    expect(big.width).toBe(small.width * 2);
    expect(big.x).toBe(small.x * 2);
  });

  it("stays inside the window and above the smallest size", () => {
    const edge = placeAnchored({ h: "right", v: "bottom", x: -0.5, y: -0.5, width: 0.3, height: 0.3 }, game(1000, 500));
    expect(edge.x + edge.width).toBeLessThanOrEqual(1000);
    expect(edge.y + edge.height).toBeLessThanOrEqual(500);
    expect(placeAnchored({ h: "left", v: "top", x: 0, y: 0, width: 0.02, height: 0.02 }, game(400, 300))).toMatchObject({ width: MIN_OVERLAY_SIZE, height: MIN_OVERLAY_SIZE });
    expect(placeAnchored({ h: "left", v: "top", x: 0, y: 0, width: 3, height: 3 }, game(30, 30))).toEqual({ x: 0, y: 0, width: 30, height: 30 });
  });

  it("takes a smaller minimum for a small canvas", () => {
    expect(placeAnchored({ h: "left", v: "top", x: 0, y: 0, width: 0.02, height: 0.02 }, game(400, 300), 4)).toMatchObject({ width: 6, height: 6 });
  });
});

describe("anchorOf", () => {
  it("anchors to the nearest corner", () => {
    const g = game(1920, 1080);
    expect(anchorOf({ x: 100, y: 50, width: 300, height: 200 }, g)).toMatchObject({ h: "left", v: "top" });
    expect(anchorOf({ x: 1920 - 400, y: 1080 - 250, width: 300, height: 200 }, g)).toMatchObject({ h: "right", v: "bottom" });
    expect(anchorOf({ x: 1500, y: 50, width: 300, height: 200 }, g)).toMatchObject({ h: "right", v: "top" });
  });

  it("anchors to the centre of an axis when the item sits in the middle", () => {
    const g = game(1920, 1080);
    expect(anchorOf({ x: 810, y: 20, width: 300, height: 100 }, g)).toMatchObject({ h: "center", v: "top" });
    expect(anchorOf({ x: 20, y: 490, width: 100, height: 100 }, g)).toMatchObject({ h: "left", v: "middle" });
  });

  it("measures offsets in units of the height", () => {
    const anchored = anchorOf({ x: 108, y: 54, width: 324, height: 216 }, game(1920, 1080));
    expect(anchored.x).toBeCloseTo(0.1);
    expect(anchored.y).toBeCloseTo(0.05);
    expect(anchored.width).toBeCloseTo(0.3);
    expect(anchored.height).toBeCloseTo(0.2);
  });

  it("is the same wherever the game window is on the screen", () => {
    expect(anchorOf({ x: 208, y: 154, width: 324, height: 216 }, game(1920, 1080, 100, 100))).toEqual(anchorOf({ x: 108, y: 54, width: 324, height: 216 }, game(1920, 1080)));
  });

  it("gives the default for a window without a size", () => {
    expect(anchorOf({ x: 0, y: 0, width: 10, height: 10 }, game(0, 0))).toEqual(DEFAULT_RECT);
  });

  it("round trips: placing what was anchored gives the same pixels", () => {
    for (const size of [game(1920, 1080), game(2560, 1440), game(1280, 720), game(3440, 1440), game(1600, 1200, 40, 30)]) {
      for (const rect of [
        { x: 10, y: 10, width: 300, height: 160 },
        { x: size.width - 410, y: size.height - 260, width: 400, height: 250 },
        { x: Math.round((size.width - 300) / 2), y: 7, width: 300, height: 90 },
        { x: 3, y: Math.round((size.height - 500) / 2), width: 120, height: 500 },
      ]) {
        const onScreen = { ...rect, x: rect.x + size.x, y: rect.y + size.y };
        near(placeAnchored(anchorOf(onScreen, size), size), onScreen);
      }
    }
  });
});

describe("normalizeAnchored", () => {
  it("takes a good rectangle as it is", () => {
    const rect: AnchoredRect = { h: "right", v: "middle", x: 0.2, y: -0.1, width: 0.3, height: 0.25 };
    expect(normalizeAnchored(rect)).toEqual(rect);
  });

  it("refuses unknown anchors and numbers that aren't finite", () => {
    expect(normalizeAnchored({ h: "top", v: "top", x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(normalizeAnchored({ h: "left", v: "up", x: 0, y: 0, width: 1, height: 1 })).toBeNull();
    expect(normalizeAnchored({ h: "left", v: "top", x: "0", y: 0, width: 1, height: 1 })).toBeNull();
    expect(normalizeAnchored({ h: "left", v: "top", x: Number.NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(normalizeAnchored(null)).toBeNull();
    expect(normalizeAnchored("x")).toBeNull();
  });

  it("clamps sizes and offsets that are out of range", () => {
    const rect = normalizeAnchored({ h: "left", v: "top", x: 99, y: -99, width: 0, height: 99 })!;
    expect(rect.x).toBe(6);
    expect(rect.y).toBe(-6);
    expect(rect.width).toBe(0.005);
    expect(rect.height).toBe(4);
  });
});

describe("contentScale", () => {
  it("is 1 at 1080p and follows the height", () => {
    expect(contentScale(1080)).toBe(1);
    expect(contentScale(1440)).toBeCloseTo(1.333, 2);
    expect(contentScale(720)).toBeCloseTo(0.667, 2);
  });

  it("stays in range and copes with nonsense", () => {
    expect(contentScale(100)).toBe(MIN_CONTENT_SCALE);
    expect(contentScale(100_000)).toBe(MAX_CONTENT_SCALE);
    expect(contentScale(0)).toBe(1);
    expect(contentScale(Number.NaN)).toBe(1);
  });
});

describe("pageZoom", () => {
  it("keeps a factor in Chromium's range and copes with nonsense", () => {
    expect(pageZoom(1)).toBe(1);
    expect(pageZoom(0.1)).toBe(0.25);
    expect(pageZoom(0.25)).toBe(0.25);
    expect(pageZoom(5)).toBe(5);
    expect(pageZoom(12)).toBe(5);
    expect(pageZoom(Number.NaN)).toBe(1);
  });
});

describe("migrateLegacy", () => {
  const sizes = [game(1920, 1080), game(2560, 1440), game(1280, 720), game(3440, 1440), game(1024, 768), game(1920, 1200)];
  const legacy: LegacyRect[] = [
    { x: 0.02, y: 0.03, width: 0.2, height: 0.16 },
    { x: 0.7, y: 0.6, width: 0.25, height: 0.3 },
    { x: 0.4, y: 0.01, width: 0.2, height: 0.1 },
    { x: 0.01, y: 0.45, width: 0.1, height: 0.2 },
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0.5, width: 0.02, height: 0.02 },
    { x: 0.98, y: 0.98, width: 0.02, height: 0.02 },
  ];

  it("lands on the very same pixels as the old rectangle did on the window size it was saved for", () => {
    for (const size of sizes) {
      for (const old of legacy) {
        near(placeAnchored(migrateLegacy(old, size), size), placeLegacy(old, size));
      }
    }
  });

  it("is pixel-identical for any rectangle on any window size, odd pixels and tiny sizes included", () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const windows = [game(1921, 1081), game(1366, 768), game(801, 601), game(5120, 1440), game(7680, 4320), game(333, 777), game(2560, 1081)];
    for (const size of windows) {
      for (let i = 0; i < 300; i++) {
        const old = normalizeLegacy({ x: random(), y: random(), width: 0.02 + random() * 0.98, height: 0.02 + random() * 0.98 })!;
        expect(placeAnchored(migrateLegacy(old, size), size)).toEqual(placeLegacy(old, size));
      }
    }
  });

  it("is pixel-identical for centred rectangles on odd pixels", () => {
    const size = game(1920, 1080);
    const old = { x: (1920 - 541) / 2 / 1920, y: (1080 - 301) / 2 / 1080, width: 541 / 1920, height: 301 / 1080 };
    expect(placeAnchored(migrateLegacy(old, size), size)).toEqual(placeLegacy(old, size));
  });

  it("anchors a rectangle in a corner to that corner", () => {
    expect(migrateLegacy({ x: 0.7, y: 0.6, width: 0.25, height: 0.3 }, game(1920, 1080))).toMatchObject({ h: "right", v: "bottom" });
    expect(migrateLegacy({ x: 0.02, y: 0.03, width: 0.2, height: 0.16 }, game(1920, 1080))).toMatchObject({ h: "left", v: "top" });
  });

  it("keeps the corner and the size in a 21:9 window as the 16:9 window had it", () => {
    for (const old of legacy) {
      const narrow = game(1920, 1080);
      const wide = game(2520, 1080);
      const migrated = migrateLegacy(old, narrow);
      const placedNarrow = placeAnchored(migrated, narrow);
      const placedWide = placeAnchored(migrated, wide);
      expect(placedWide.width).toBe(placedNarrow.width);
      expect(placedWide.height).toBe(placedNarrow.height);
      expect(placedWide.y).toBe(placedNarrow.y);
      if (migrated.h === "left") expect(placedWide.x).toBe(placedNarrow.x);
      if (migrated.h === "right") expect(placedWide.x + placedWide.width).toBe(wide.width - (narrow.width - placedNarrow.x - placedNarrow.width));
    }
  });

  it("is the old placement for a window on another screen position (only the shape counts)", () => {
    const old = { x: 0.3, y: 0.2, width: 0.2, height: 0.2 };
    expect(migrateLegacy(old, { width: 1920, height: 1080 })).toEqual(migrateLegacy(old, game(1920, 1080, 500, 500)));
  });
});

describe("normalizeLegacy", () => {
  it("clamps like the old store did", () => {
    expect(normalizeLegacy({ x: -1, y: 2, width: 5, height: 0 })).toEqual({ x: 0, y: 0.98, width: 1, height: 0.02 });
    expect(normalizeLegacy({ x: 0.9, y: 0, width: 0.5, height: 0.5 })).toMatchObject({ x: 0.5 });
    expect(normalizeLegacy({ x: "0", y: 0, width: 1, height: 1 })).toBeNull();
    expect(normalizeLegacy(null)).toBeNull();
  });
});
