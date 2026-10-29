import { describe, expect, it } from "vitest";
import type { DockviewApi, Position } from "dockview-vue";
import { dropReorders, fromDockview, GUIDE, groupConstraints, heightSpans, leastAlong, maximizedPanel, MISSING_MODULE_SIZE, PANEL_COMPONENT, panelInfo, placePanel, resolveDropPosition, resolveOuterEdge, TAB_HEIGHT, toDockview, widthSpans, type GroupShape, type Sizes } from "./dock";
import type { HostViewState, PanelView, SavedLayout } from "../shared/host-api";

describe("what docking knows about a panel", () => {
  const panel = (moduleId: string, panelType: string | null = null): PanelView => ({ instanceId: "p", moduleId, panelType, name: "Discord", status: "unavailable", waiting: false, content: null });
  const module = { id: "a.notes", name: "Notes", minWidth: 300, minHeight: 200, panels: [{ id: "big", minWidth: 500, minHeight: 400 }] } as unknown as HostViewState["modules"][number];

  it("takes the room its module or panel type asks for, plus the card border", () => {
    expect(panelInfo(panel("a.notes"), [module])).toMatchObject({ minWidth: 302, minHeight: 202, module: { id: "a.notes", name: "Notes" } });
    expect(panelInfo(panel("a.notes", "big"), [module])).toMatchObject({ minWidth: 502, minHeight: 402 });
  });

  it("still has a size when its module is not installed, so it can be docked", () => {
    expect(panelInfo(panel("wellbrained.discord"), [module])).toEqual({ title: "Discord", minWidth: MISSING_MODULE_SIZE.minWidth + 2, minHeight: MISSING_MODULE_SIZE.minHeight + 2 });
    expect(panelInfo(undefined, [module])).toBeUndefined();
  });
});
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

  it("keeps the group the user worked in, so new panels go there after a restart", () => {
    const focused: SavedLayout = { ...layout, root: { ...layout.root, children: [layout.root.children[0]!, { ...layout.root.children[1]!, focused: true } as SavedLayout["root"]["children"][number]] } };
    const json = toDockview(focused, info);
    expect(json.activeGroup).toBe("group-2");
    expect(fromDockview(json)).toEqual(focused);
  });
});

describe("tall and wide panels", () => {
  // A module with a layout for each shape: grid above the controls, or beside them.
  const both: Sizes = { minWidth: 320, minHeight: 440, wide: { minWidth: 500, minHeight: 300 } };
  const info = (sizes: Record<string, Sizes>) => (id: string) => (sizes[id] ? { title: id, ...sizes[id] } : undefined);
  const group = (width: number, height: number, ...ids: string[]): GroupShape => ({ width, height: height + TAB_HEIGHT, panels: ids.map((id) => ({ id })) });

  it("knows the wide minimum of a module or panel type, plus the card border", () => {
    const view = (panelType: string | null): PanelView => ({ instanceId: "p", moduleId: "a.sudoku", panelType, name: "Sudoku", status: "ready", waiting: false, content: null });
    const module = { id: "a.sudoku", name: "Sudoku", minWidth: 320, minHeight: 440, wide: { minWidth: 500, minHeight: 300 }, panels: [{ id: "small", minWidth: 200, minHeight: 200 }] } as unknown as HostViewState["modules"][number];
    expect(panelInfo(view(null), [module])).toMatchObject({ minWidth: 322, minHeight: 442, wide: { minWidth: 502, minHeight: 302 } });
    expect(panelInfo(view("small"), [module])).not.toHaveProperty("wide");
  });

  it("lets a drag pass the square where both layouts fit", () => {
    expect(widthSpans(both, 600)).toEqual([{ min: 320, max: Infinity }]);
    expect(heightSpans(both, 600)).toEqual([{ min: 300, max: Infinity }]);
  });

  it("stops a drag at the square where the other layout doesn't fit yet", () => {
    // 450 tall: tall up to 450 wide, wide only from 500, nothing between.
    expect(widthSpans(both, 450)).toEqual([
      { min: 320, max: 450 },
      { min: 500, max: Infinity },
    ]);
    // 450 wide is too narrow for the wide layout, so the panel stays at least square.
    expect(heightSpans(both, 450)).toEqual([{ min: 450, max: Infinity }]);
  });

  it("allows only the layout whose minimum fits", () => {
    expect(widthSpans(both, 350)).toEqual([{ min: 500, max: Infinity }]);
    expect(widthSpans(both, 200)).toEqual([]);
    expect(heightSpans(both, 300)).toEqual([]);
  });

  it("keeps one minimum for any shape when a module has no wide layout", () => {
    const one: Sizes = { minWidth: 500, minHeight: 300 };
    expect(widthSpans(one, 800)).toEqual([{ min: 500, max: Infinity }]);
    expect(heightSpans(one, 500)).toEqual([{ min: 300, max: Infinity }]);
    expect(widthSpans(one, 200)).toEqual([]);
  });

  it("gives a group the stretch that holds its size, and no end where there is none", () => {
    const sizes = info({ g: both });
    expect(groupConstraints(group(400, 450, "g"), sizes)).toEqual({ minimumWidth: 320, maximumWidth: 450, minimumHeight: 440 + TAB_HEIGHT, maximumHeight: Number.MAX_SAFE_INTEGER });
    expect(groupConstraints(group(600, 450, "g"), sizes)).toEqual({ minimumWidth: 500, maximumWidth: Number.MAX_SAFE_INTEGER, minimumHeight: 300 + TAB_HEIGHT, maximumHeight: Number.MAX_SAFE_INTEGER });
  });

  it("falls back to the smallest each side could be before the group is laid out", () => {
    expect(groupConstraints(group(0, -TAB_HEIGHT, "g"), info({ g: both }))).toEqual({ minimumWidth: 320, maximumWidth: Number.MAX_SAFE_INTEGER, minimumHeight: 300 + TAB_HEIGHT, maximumHeight: Number.MAX_SAFE_INTEGER });
  });

  it("makes a group of tabs fit every panel in it", () => {
    const sizes = info({ g: both, notes: { minWidth: 400, minHeight: 200 } });
    expect(groupConstraints(group(420, 450, "g", "notes"), sizes)).toMatchObject({ minimumWidth: 400, maximumWidth: 450 });
  });

  it("finds the least room a panel needs beside or below a group", () => {
    const sizes = info({ g: both });
    // Beside a 450 tall group: tall from 320 wide.
    expect(leastAlong(["g"], true, 450 + TAB_HEIGHT, sizes)).toBe(320);
    // Beside a 350 tall one only the wide layout fits.
    expect(leastAlong(["g"], true, 350 + TAB_HEIGHT, sizes)).toBe(500);
    // Below a 600 wide group: wide from 300 tall, plus the tab bar.
    expect(leastAlong(["g"], false, 600, sizes)).toBe(300 + TAB_HEIGHT);
    expect(leastAlong(["g"], true, 200 + TAB_HEIGHT, sizes)).toBe(Infinity);
  });
});

describe("placing a new panel", () => {
  const fake = (groups: { id: string; width: number; height: number; panels: string[] }[], active?: string) => {
    const added: unknown[] = [];
    const items = groups.map((group) => ({ ...group, panels: group.panels.map((id) => ({ id })) }));
    const api = {
      groups: items,
      activeGroup: items.find((group) => group.id === active),
      getGroup: (id: string) => items.find((group) => group.id === id),
      addPanel: (options: unknown) => added.push(options),
    } as unknown as DockviewApi;
    return { api, added };
  };
  const info = () => ({ title: "Sudoku", minWidth: 320, minHeight: 440 });

  it("goes in as a tab in the active group, so nothing else moves", () => {
    const { api, added } = fake(
      [
        { id: "left", width: 300, height: 800, panels: ["a"] },
        { id: "right", width: 1200, height: 800, panels: ["b"] },
      ],
      "left",
    );
    placePanel(api, "new", info);
    expect(added).toEqual([{ id: "new", component: PANEL_COMPONENT, title: "Sudoku", position: { referenceGroup: "left", direction: "within" } }]);
  });

  it("takes an empty slot first", () => {
    const { api, added } = fake(
      [
        { id: "left", width: 300, height: 800, panels: ["a"] },
        { id: "slot", width: 600, height: 800, panels: [] },
      ],
      "left",
    );
    placePanel(api, "new", info);
    expect(added).toMatchObject([{ position: { referenceGroup: "slot" } }]);
  });

  it("goes into the biggest group when none is active", () => {
    const { api, added } = fake([
      { id: "small", width: 300, height: 800, panels: ["a"] },
      { id: "big", width: 1200, height: 800, panels: ["b"] },
    ]);
    placePanel(api, "new", info);
    expect(added).toMatchObject([{ position: { referenceGroup: "big" } }]);
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
