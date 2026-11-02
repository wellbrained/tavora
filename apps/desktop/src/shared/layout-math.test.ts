import { describe, expect, it } from "vitest";
import { boundsOf, canvasFor, gridCell, isGridSetting, moveGroup, nudge, snapMove, snapResize, touches, type SnapOptions } from "./layout-math";

const canvas = { width: 1920, height: 1080 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const grid: SnapOptions = { cell: 30, threshold: 8, free: false };
const noGrid: SnapOptions = { cell: 0, threshold: 8, free: false };

describe("grid", () => {
  it("has a cell of 1/36 of the height at Normal, half at Fine, double at Coarse, none when off", () => {
    expect(gridCell("normal")).toBe(30);
    expect(gridCell("fine")).toBe(15);
    expect(gridCell("coarse")).toBe(60);
    expect(gridCell("off")).toBe(0);
  });

  it("knows its settings", () => {
    expect(isGridSetting("fine")).toBe(true);
    expect(isGridSetting("huge")).toBe(false);
    expect(isGridSetting(3)).toBe(false);
  });
});

describe("canvasFor", () => {
  it("is 1080 high and as wide as the window's shape says", () => {
    expect(canvasFor(16 / 9)).toEqual({ width: 1920, height: 1080 });
    expect(canvasFor(21 / 9)).toEqual({ width: 2520, height: 1080 });
    expect(canvasFor(4 / 3)).toEqual({ width: 1440, height: 1080 });
  });

  it("uses 16:9 for a shape that makes no sense", () => {
    expect(canvasFor(0)).toEqual({ width: 1920, height: 1080 });
    expect(canvasFor(Number.NaN)).toEqual({ width: 1920, height: 1080 });
    expect(canvasFor(500)).toEqual({ width: 1920, height: 1080 });
  });
});

describe("snapMove", () => {
  it("snaps the top left corner to the grid", () => {
    expect(snapMove(rect(47, 61, 210, 90), canvas, [], grid).rect).toMatchObject({ x: 60, y: 60 });
    expect(snapMove(rect(44, 74, 210, 90), canvas, [], grid).rect).toMatchObject({ x: 30, y: 60 });
  });

  it("snaps the right or bottom edge to the grid when that edge is nearer", () => {
    // 250 wide: its left edge is 14 off a line, its right edge only 6.
    expect(snapMove(rect(1004, 100, 250, 100), canvas, [], grid).rect).toMatchObject({ x: 1010 });
    // 100 high: its top is 14 off a line, its bottom 4.
    expect(snapMove(rect(100, 616, 120, 100), canvas, [], grid).rect).toMatchObject({ y: 620 });
  });

  it("keeps the right edge on the grid drawn on the canvas, also when its width is not a whole number of cells", () => {
    const wide = { width: 1728, height: 1080 };
    const result = snapMove(rect(1304, 100, 250, 100), wide, [], grid).rect;
    expect((result.x + result.width) % 30).toBe(0);
  });

  it("places freely with the grid off", () => {
    expect(snapMove(rect(47, 61, 200, 100), canvas, [], noGrid).rect).toMatchObject({ x: 47, y: 61 });
  });

  it("places freely when Alt is held (free), without guides", () => {
    const result = snapMove(rect(3, 5, 200, 100), canvas, [], { ...grid, free: true });
    expect(result.rect).toMatchObject({ x: 3, y: 5 });
    expect(result.guides).toEqual([]);
  });

  it("snaps to the canvas edges and shows a guide", () => {
    const result = snapMove(rect(4, 1076 - 100 + 3, 200, 100), canvas, [], noGrid);
    expect(result.rect).toMatchObject({ x: 0, y: 980 });
    expect(result.guides).toEqual(expect.arrayContaining([{ axis: "x", at: 0 }, { axis: "y", at: 1080 }]));
  });

  it("snaps the right edge to the canvas's right edge", () => {
    expect(snapMove(rect(1715, 100, 200, 100), canvas, [], noGrid).rect.x).toBe(1720);
  });

  it("snaps the centre of the item to the centre lines", () => {
    const result = snapMove(rect(862, 100, 200, 100), canvas, [], noGrid);
    expect(result.rect.x).toBe(860);
    expect(result.guides).toContainEqual({ axis: "x", at: 960 });
  });

  it("snaps to the edges of other items", () => {
    const other = rect(500, 300, 200, 100);
    const result = snapMove(rect(706, 301, 100, 100), canvas, [other], noGrid);
    expect(result.rect).toMatchObject({ x: 700, y: 300 });
    expect(result.guides).toEqual(expect.arrayContaining([{ axis: "x", at: 700 }, { axis: "y", at: 300 }]));
  });

  it("prefers a guide over the grid", () => {
    const other = rect(512, 300, 200, 100);
    expect(snapMove(rect(515, 40, 100, 100), canvas, [other], grid).rect.x).toBe(512);
  });

  it("falls back to the grid when no guide is near", () => {
    const other = rect(500, 300, 200, 100);
    expect(snapMove(rect(1000, 40, 100, 100), canvas, [other], grid).rect).toMatchObject({ x: 990, y: 30 });
  });

  it("keeps the item on the canvas", () => {
    expect(snapMove(rect(-50, -50, 200, 100), canvas, [], grid).rect).toMatchObject({ x: 0, y: 0 });
    expect(snapMove(rect(5000, 5000, 200, 100), canvas, [], grid).rect).toMatchObject({ x: 1720, y: 980 });
  });

  it("keeps the size", () => {
    expect(snapMove(rect(47, 61, 213, 97), canvas, [], grid).rect).toMatchObject({ width: 213, height: 97 });
  });
});

describe("snapResize", () => {
  it("snaps the pulled edges to the grid and leaves the others", () => {
    const result = snapResize(rect(60, 60, 217, 103), { right: true, bottom: true }, canvas, [], grid).rect;
    expect(result).toEqual(rect(60, 60, 210, 90));
  });

  it("snaps a pulled left edge and keeps the right edge where it is", () => {
    const result = snapResize(rect(47, 60, 213, 100), { left: true }, canvas, [], grid).rect;
    expect(result.x).toBe(60);
    expect(result.x + result.width).toBe(260);
  });

  it("snaps to the canvas edge and to another item with a guide", () => {
    const other = rect(500, 0, 100, 100);
    const result = snapResize(rect(100, 100, 395, 100), { right: true }, canvas, [other], noGrid);
    expect(result.rect.width).toBe(400);
    expect(result.guides).toContainEqual({ axis: "x", at: 500 });
    expect(snapResize(rect(100, 100, 1817, 100), { right: true }, canvas, [], noGrid).rect.width).toBe(1820);
  });

  it("resizes freely when Alt is held", () => {
    expect(snapResize(rect(60, 60, 217, 103), { right: true, bottom: true }, canvas, [], { ...grid, free: true }).rect).toEqual(rect(60, 60, 217, 103));
  });

  it("never gets smaller than the smallest size, and stays on the canvas", () => {
    expect(snapResize(rect(100, 100, 10, 10), { right: true, bottom: true }, canvas, [], grid).rect).toMatchObject({ width: 48, height: 48 });
    const left = snapResize(rect(250, 100, 100, 100), { left: true }, canvas, [], { ...noGrid, free: true }).rect;
    expect(left.x).toBe(250);
    expect(snapResize(rect(100, 100, 5000, 5000), { right: true, bottom: true }, canvas, [], grid).rect).toMatchObject({ width: 1820, height: 980 });
    expect(snapResize(rect(100, 100, 100, 100), { left: true, top: true }, canvas, [], { ...noGrid, free: true }).rect.x).toBe(100);
  });
});

describe("nudge", () => {
  it("moves by one cell, five with Shift", () => {
    expect(nudge(rect(100, 100, 50, 50), "right", canvas, 30, false)).toMatchObject({ x: 130, y: 100 });
    expect(nudge(rect(100, 100, 50, 50), "left", canvas, 30, true)).toMatchObject({ x: -50 < 0 ? 0 : -50 });
    expect(nudge(rect(400, 400, 50, 50), "down", canvas, 30, true)).toMatchObject({ y: 550 });
    expect(nudge(rect(400, 400, 50, 50), "up", canvas, 30, false)).toMatchObject({ y: 370 });
  });

  it("moves one unit with the grid off, five with Shift", () => {
    expect(nudge(rect(100, 100, 50, 50), "right", canvas, 0, false).x).toBe(101);
    expect(nudge(rect(100, 100, 50, 50), "down", canvas, 0, true).y).toBe(105);
  });

  it("stays on the canvas", () => {
    expect(nudge(rect(1865, 0, 50, 50), "right", canvas, 30, false).x).toBe(1870);
    expect(nudge(rect(0, 0, 50, 50), "up", canvas, 30, false).y).toBe(0);
  });
});

describe("frames together", () => {
  const canvas = { width: 1920, height: 1080 };
  const a = { x: 100, y: 100, width: 200, height: 100 };
  const b = { x: 400, y: 300, width: 100, height: 100 };

  it("finds the box around them", () => {
    expect(boundsOf([a, b])).toEqual({ x: 100, y: 100, width: 400, height: 300 });
    expect(boundsOf([])).toBeNull();
  });

  it("moves them by the same amount, only as far as the whole group stays on the canvas", () => {
    expect(moveGroup([a, b], 50, -20, canvas)).toEqual([
      { ...a, x: 150, y: 80 },
      { ...b, x: 450, y: 280 },
    ]);
    // b would leave the canvas on the right: both stop where b reaches the edge, still 300 apart.
    const [left, right] = moveGroup([a, b], 5000, 0, canvas);
    expect(right!.x + right!.width).toBe(1920);
    expect(right!.x - left!.x).toBe(300);
    expect(moveGroup([a, b], -500, -500, canvas)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("tells which frames a box touches", () => {
    expect(touches({ x: 0, y: 0, width: 100, height: 100 }, a)).toBe(true);
    expect(touches({ x: 0, y: 0, width: 99, height: 99 }, a)).toBe(false);
  });
});
