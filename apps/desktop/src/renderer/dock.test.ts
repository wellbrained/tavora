import { describe, expect, it } from "vitest";
import type { Position } from "dockview-vue";
import { dropReorders, fromDockview, GUIDE, maximizedPanel, resolveDropPosition, resolveOuterEdge, shareOut, toDockview } from "./dock";
import type { SavedLayout } from "../shared/host-api";
import { gridName, gridTemplate, LAYOUT_TEMPLATES, templateRects } from "../shared/layout-templates";

describe("the maximized group", () => {
  const layout: SavedLayout = {
    width: 1000,
    height: 600,
    direction: "row",
    root: {
      kind: "split",
      size: 600,
      children: [
        { kind: "group", size: 400, panels: ["a"], active: "a" },
        { kind: "group", size: 600, panels: ["b", "c"], active: "c" },
      ],
    },
  };
  const info = () => ({ title: "x", minWidth: 0, minHeight: 0 });

  it("is marked on the group of the panel given, and found again", () => {
    const saved = fromDockview(toDockview(layout, info), "b");
    expect(saved?.root.children[1]).toMatchObject({ panels: ["b", "c"], maximized: true });
    expect(saved?.root.children[0]).not.toHaveProperty("maximized");
    expect(maximizedPanel(saved)).toBe("c");
  });

  it("is not there when no group fills the workspace", () => {
    const saved = fromDockview(toDockview(layout, info));
    expect(saved).toEqual(layout);
    expect(maximizedPanel(saved)).toBeNull();
  });
});

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

describe("dropReorders", () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const a = box(0, 0, 300, 600);
  const c = box(620, 0, 300, 600);

  it("is true for a lone panel moved beside a group in its row", () => {
    expect(dropReorders(a, true, c, "right")).toBe(true);
    expect(dropReorders(a, true, c, "left")).toBe(true);
  });

  it("is false when the dragged panel leaves others behind, or as a tab", () => {
    expect(dropReorders(a, false, c, "right")).toBe(false);
    expect(dropReorders(a, true, c, "center")).toBe(false);
  });

  it("is false when the groups are not in the same row or column", () => {
    expect(dropReorders(box(0, 0, 300, 290), true, c, "right")).toBe(false);
    expect(dropReorders(a, true, c, "bottom")).toBe(false);
    expect(dropReorders(box(0, 0, 300, 290), true, box(0, 310, 300, 290), "bottom")).toBe(true);
  });
});

describe("gridTemplate", () => {
  it("lays out even columns and rows", () => {
    expect(templateRects(gridTemplate(3, 2))).toHaveLength(6);
    expect(templateRects(gridTemplate(1, 4)).map((rect) => rect.y)).toEqual([0, 0.25, 0.5, 0.75]);
    expect([gridName(1, 1), gridName(4, 1), gridName(1, 3), gridName(3, 2)]).toEqual(["1 slot", "4 columns", "3 rows", "3 × 2 grid"]);
  });
});

describe("templateRects", () => {
  it("covers the whole area once for every template", () => {
    for (const template of [...LAYOUT_TEMPLATES, gridTemplate(3, 2), gridTemplate(1, 4), gridTemplate(5, 1)]) {
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
