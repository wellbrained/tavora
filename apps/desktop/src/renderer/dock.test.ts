import { describe, expect, it } from "vitest";
import type { Position } from "dockview-vue";
import { GUIDE, resolveDropPosition, resolveOuterEdge, shareOut } from "./dock";
import { LAYOUT_TEMPLATES, templateRects } from "../shared/layout-templates";

describe("shareOut", () => {
  it("shares room evenly when every minimum fits", () => {
    expect(shareOut(1000, [320, 320, 320])).toEqual([1000 / 3, 1000 / 3, 1000 / 3]);
  });

  it("gives tight members their minimum and shares the rest", () => {
    expect(shareOut(1000, [500, 100, 100])).toEqual([500, 250, 250]);
  });

  it("settles on minimums when there is exactly enough room", () => {
    expect(shareOut(960, [320, 640])).toEqual([320, 640]);
  });
});

describe("resolveDropPosition", () => {
  const all = new Set<Position>(["top", "bottom", "left", "right", "center"]);
  const step = GUIDE.cell + GUIDE.gap;

  it("takes the guide cell under the pointer", () => {
    expect(resolveDropPosition(400, 300, 800, 600, all)).toBe("center");
    expect(resolveDropPosition(400 + step, 300, 800, 600, all)).toBe("right");
    expect(resolveDropPosition(400 - step, 300, 800, 600, all)).toBe("left");
    expect(resolveDropPosition(400, 300 - step, 800, 600, all)).toBe("top");
    expect(resolveDropPosition(400, 300 + step, 800, 600, all)).toBe("bottom");
  });

  it("drops beside the nearest edge when close to it, else as a tab", () => {
    expect(resolveDropPosition(20, 300, 800, 600, all)).toBe("left");
    expect(resolveDropPosition(780, 40, 800, 600, all)).toBe("right");
    expect(resolveDropPosition(600, 580, 800, 600, all)).toBe("bottom");
    expect(resolveDropPosition(250, 200, 800, 600, all)).toBe("center");
  });

  it("offers only the zones a target accepts", () => {
    expect(resolveDropPosition(400, 300, 800, 600, new Set<Position>(["left", "right"]))).toBeNull();
    expect(resolveDropPosition(400 + step, 300, 800, 600, new Set<Position>(["center"]))).toBe("center");
  });

  it("keeps the dock's outer edges thin", () => {
    expect(resolveOuterEdge(5, 300, 800, 600, all)).toBe("left");
    expect(resolveOuterEdge(100, 300, 800, 600, new Set<Position>(["left", "right"]))).toBeNull();
  });
});

describe("templateRects", () => {
  it("covers the whole area once for every template", () => {
    for (const template of LAYOUT_TEMPLATES) {
      const area = templateRects(template).reduce((sum, rect) => sum + rect.width * rect.height, 0);
      expect(area).toBeCloseTo(1);
    }
  });

  it("places a main area and two stacked beside it", () => {
    const rects = templateRects(LAYOUT_TEMPLATES.find((template) => template.id === "main-stacked")!);
    expect(rects).toEqual([
      { x: 0, y: 0, width: 0.6, height: 1 },
      { x: 0.6, y: 0, width: 0.4, height: 0.5 },
      { x: 0.6, y: 0.5, width: 0.4, height: 0.5 },
    ]);
  });
});
