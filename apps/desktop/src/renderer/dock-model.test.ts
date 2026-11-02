import { describe, expect, it } from "vitest";
import type { SerializedDockview } from "dockview-vue";
import { groupRects, NEW_GROUP, planDrop, type Dragged, type DropTarget } from "./dock-model";

// Sizes below are as dockview saves them. With no gap (margin 0) they are the sizes the groups are drawn at.
type Node = SerializedDockview["grid"]["root"];
const leaf = (id: string, views: string[], size: number): Node => ({ type: "leaf", data: { id, views, activeView: views[0] }, size }) as Node;
const split = (size: number, ...data: Node[]): Node => ({ type: "branch", size, data }) as Node;
const dock = (root: Node, width: number, height: number, orientation: "HORIZONTAL" | "VERTICAL" = "HORIZONTAL"): SerializedDockview =>
  ({ grid: { root, width, height, orientation }, panels: {} }) as unknown as SerializedDockview;

/** What every panel asks for: 300 x 200 of content, 36 of tab bar on top. */
const info = (id: string) => ({ title: id, minWidth: 300, minHeight: 200 });
const roomy = (id: string) => ({ title: id, minWidth: 100, minHeight: 100 });

const three = () => dock(split(600, leaf("g1", ["a"], 400), leaf("g2", ["b"], 400), leaf("g3", ["c"], 400)), 1200, 600);
const drag = (groupId: string, panelId: string | null = null): Dragged => ({ groupId, panelId });
const plan = (layout: SerializedDockview, dragged: Dragged, target: DropTarget, panelInfo = roomy, margin = 0) => planDrop(layout, dragged, target, panelInfo, margin);
function ok(result: ReturnType<typeof planDrop>) {
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}
const widths = (result: ReturnType<typeof planDrop>) => Object.fromEntries(Object.entries(ok(result).rects).map(([id, r]) => [id, [r.x, r.width]]));

describe("a new column or row beside a group", () => {
  it("halves the group it lands next to and gives the room of the old spot back", () => {
    const result = ok(plan(three(), drag("g1", "a"), { kind: "split", group: "g3", side: "right" }, roomy));
    // a's spot closes (b and c share the width), then c splits in two. A lone group moved within its row keeps its size.
    expect(result.newGroup).toBe(false);
    expect(result.group).toBe("g1");
    expect(widths(result)).toEqual({ g2: [0, 400], g3: [400, 400], g1: [800, 400] });
    expect(result.landing).toEqual({ x: 800, y: 0, width: 400, height: 600 });
  });

  it("makes a new column from a panel that leaves tabs behind", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x"], 600), leaf("g2", ["b"], 600)), 1200, 600);
    const result = ok(plan(layout, drag("g1", "x"), { kind: "split", group: "g2", side: "left" }));
    expect(result.newGroup).toBe(true);
    expect(result.group).toBe(NEW_GROUP);
    expect(widths(result)).toEqual({ g1: [0, 600], [NEW_GROUP]: [600, 300], g2: [900, 300] });
    expect(result.landing).toEqual({ x: 600, y: 0, width: 300, height: 600 });
    const groups = (result.layout.grid.root.data as Node[]).map((node) => (node.data as { views: string[] }).views);
    expect(groups).toEqual([["a"], ["x"], ["b"]]);
  });

  it("makes a new row on top: the group it lands on is wrapped with it and they share the height", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x"], 600), leaf("g2", ["b"], 600)), 1200, 600);
    const result = ok(plan(layout, drag("g1", "x"), { kind: "split", group: "g2", side: "top" }));
    expect(result.rects[NEW_GROUP]).toEqual({ x: 600, y: 0, width: 600, height: 300 });
    expect(result.rects.g2).toEqual({ x: 600, y: 300, width: 600, height: 300 });
    expect(result.rects.g1).toEqual({ x: 0, y: 0, width: 600, height: 600 });
  });

  it("lets the siblings of a closing group share its room equally", () => {
    // a leaves a 1200 wide row of 200 | 400 | 600; b and c each get half, then b splits for a.
    const layout = dock(split(600, leaf("g1", ["a"], 200), leaf("g2", ["b"], 400), leaf("g3", ["c"], 600)), 1200, 600);
    const result = ok(plan(layout, drag("g1", "a"), { kind: "split", group: "g2", side: "bottom" }));
    expect(result.rects.g2).toEqual({ x: 0, y: 0, width: 600, height: 300 });
    expect(result.rects.g1).toEqual({ x: 0, y: 300, width: 600, height: 300 });
    expect(result.rects.g3).toEqual({ x: 600, y: 0, width: 600, height: 600 });
  });

  it("swaps two neighbours without resizing either", () => {
    const layout = dock(split(600, leaf("g1", ["a"], 300), leaf("g2", ["b"], 900)), 1200, 600);
    const result = ok(plan(layout, drag("g1", "a"), { kind: "split", group: "g2", side: "right" }));
    expect(widths(result)).toEqual({ g2: [0, 900], g1: [900, 300] });
  });

  it("leaves a gap between the cards: the rectangles are the ones dockview draws", () => {
    const result = ok(plan(three(), drag("g1", "a"), { kind: "split", group: "g3", side: "right" }, roomy, 8));
    const [g2, g3, g1] = [result.rects.g2!, result.rects.g3!, result.rects.g1!];
    expect(g3.x - (g2.x + g2.width)).toBeCloseTo(8);
    expect(g1.x - (g3.x + g3.width)).toBeCloseTo(8);
    expect(g1.x + g1.width).toBeCloseTo(1200);
  });
});

describe("a tab", () => {
  it("is added to the end of the group's tabs, and the group it left closes", () => {
    const result = ok(plan(three(), drag("g2", "b"), { kind: "tab", group: "g1" }));
    expect(result.group).toBe("g1");
    expect(result.tabIndex).toBe(1);
    expect(widths(result)).toEqual({ g1: [0, 600], g3: [600, 600] });
    expect((result.layout.grid.root.data as Node[]).map((node) => (node.data as { views: string[] }).views)).toEqual([["a", "b"], ["c"]]);
  });

  it("goes to the index asked for, counting the other tabs", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x", "y"], 600), leaf("g2", ["b"], 600)), 1200, 600);
    const result = ok(plan(layout, drag("g2", "b"), { kind: "tab", group: "g1", index: 1 }));
    expect(result.tabIndex).toBe(1);
    expect((result.layout.grid.root.data as Node[])[0]!.data).toMatchObject({ views: ["a", "b", "x", "y"] });
  });

  it("reorders the tabs of its own group without touching the layout", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x", "y"], 600), leaf("g2", ["b"], 600)), 1200, 600);
    const result = ok(plan(layout, drag("g1", "a"), { kind: "tab", group: "g1", index: 2 }));
    expect((result.layout.grid.root.data as Node[])[0]!.data).toMatchObject({ views: ["x", "y", "a"] });
    expect(widths(result)).toEqual({ g1: [0, 600], g2: [600, 600] });
  });

  it("is a no-op in its own group at its own place", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x"], 600), leaf("g2", ["b"], 600)), 1200, 600);
    expect(plan(layout, drag("g1", "a"), { kind: "tab", group: "g1", index: 0 })).toEqual({ ok: false, reason: "same-spot" });
    expect(plan(layout, drag("g2", "b"), { kind: "tab", group: "g2" })).toEqual({ ok: false, reason: "same-spot" });
  });

  it("moves all the tabs of a group when the group itself is dragged", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x"], 600), leaf("g2", ["b"], 600)), 1200, 600);
    const result = ok(plan(layout, drag("g1"), { kind: "tab", group: "g2" }));
    expect((result.layout.grid.root.data as Node[]).length).toBe(1);
    expect((result.layout.grid.root.data as Node[])[0]!.data).toMatchObject({ views: ["b", "a", "x"] });
  });
});

describe("the outer edges of the dock", () => {
  it("make a full-height column", () => {
    const result = ok(plan(three(), drag("g3", "c"), { kind: "edge", side: "left" }));
    expect(result.newGroup).toBe(true);
    expect(result.landing.height).toBe(600);
    expect(result.landing.x).toBe(0);
    expect(Object.values(result.rects).map((r) => r.width)).toEqual([400, 400, 400]);
  });

  it("make a full-width row", () => {
    const result = ok(plan(three(), drag("g1", "a"), { kind: "edge", side: "bottom" }));
    expect(result.landing.width).toBe(1200);
    expect(result.landing.y + result.landing.height).toBe(600);
    expect(result.layout.grid.orientation).toBe("VERTICAL");
    // The two groups left share the row above.
    expect(result.rects.g2).toMatchObject({ y: 0, width: 600 });
    expect(result.rects.g3).toMatchObject({ x: 600, y: 0, width: 600 });
  });

  it("take a panel out of a group that keeps its other tabs", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x"], 600), leaf("g2", ["b"], 600)), 1200, 600);
    const result = ok(plan(layout, drag("g1", "x"), { kind: "edge", side: "right" }));
    expect(result.rects.g1).toBeDefined();
    expect(result.landing.height).toBe(600);
    expect(result.landing.x + result.landing.width).toBe(1200);
  });
});

describe("a drop that is refused", () => {
  it("says too small when a panel would get less room than it asks for", () => {
    // 3 columns of 300 are as many as 900 wide holds; a fourth column does not fit.
    const layout = dock(split(600, leaf("g1", ["a"], 300), leaf("g2", ["b"], 300), leaf("g3", ["c", "x"], 300)), 900, 600);
    expect(plan(layout, drag("g3", "x"), { kind: "split", group: "g1", side: "right" }, info)).toEqual({ ok: false, reason: "too-small" });
    expect(plan(layout, drag("g3", "x"), { kind: "edge", side: "left" }, info)).toEqual({ ok: false, reason: "too-small" });
  });

  it("lets the same drop through where there is room", () => {
    const layout = dock(split(600, leaf("g1", ["a"], 450), leaf("g2", ["b"], 450), leaf("g3", ["c", "x"], 300)), 1200, 600);
    expect(plan(layout, drag("g3", "x"), { kind: "split", group: "g1", side: "right" }, info).ok).toBe(true);
  });

  it("lets a panel split off its own group when the group keeps another tab and both fit", () => {
    // One group of two tabs, 700 wide: each panel needs 300, so side by side (600) fits.
    const layout = dock(split(600, leaf("g1", ["a", "x"], 700)), 700, 600);
    for (const side of ["left", "right"] as const) {
      const result = ok(plan(layout, drag("g1", "x"), { kind: "split", group: "g1", side }, info));
      expect(result.newGroup).toBe(true);
      expect(Object.keys(result.rects)).toHaveLength(2);
    }
    for (const side of ["top", "bottom"] as const) expect(plan(layout, drag("g1", "x"), { kind: "split", group: "g1", side }, info).ok).toBe(true);
  });

  it("refuses that split only when the two would not fit", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x"], 500)), 500, 600);
    expect(plan(layout, drag("g1", "x"), { kind: "split", group: "g1", side: "right" }, info)).toEqual({ ok: false, reason: "too-small" });
  });

  it("counts the room of a group's own panel only once, in a row with neighbours", () => {
    const layout = dock(split(600, leaf("g1", ["a", "x"], 500), leaf("g2", ["b"], 300)), 800, 600);
    expect(plan(layout, drag("g1", "x"), { kind: "split", group: "g1", side: "right" }, info).ok).toBe(false);
    const wide = dock(split(600, leaf("g1", ["a", "x"], 700), leaf("g2", ["b"], 600)), 1300, 600);
    expect(plan(wide, drag("g1", "x"), { kind: "split", group: "g1", side: "right" }, info).ok).toBe(true);
  });

  it("says same spot, not too small, for a lone panel dropped on its own edge or its own tab slot", () => {
    const layout = dock(split(600, leaf("g1", ["a"], 300), leaf("g2", ["b", "x"], 300)), 600, 600);
    expect(plan(layout, drag("g1", "a"), { kind: "split", group: "g1", side: "right" }, info)).toEqual({ ok: false, reason: "same-spot" });
    expect(plan(layout, drag("g2", "x"), { kind: "tab", group: "g2", index: 1 }, info)).toEqual({ ok: false, reason: "same-spot" });
  });

  it("says same spot when nothing would change", () => {
    expect(plan(three(), drag("g2", "b"), { kind: "split", group: "g2", side: "left" })).toEqual({ ok: false, reason: "same-spot" });
    // Dropping to the right of the left neighbour is where it already is.
    expect(plan(three(), drag("g2", "b"), { kind: "split", group: "g1", side: "right" })).toEqual({ ok: false, reason: "same-spot" });
  });

  it("says unknown for a group or panel that is not there", () => {
    expect(plan(three(), drag("nope", "a"), { kind: "tab", group: "g1" })).toEqual({ ok: false, reason: "unknown" });
    expect(plan(three(), drag("g1", "zzz"), { kind: "tab", group: "g2" })).toEqual({ ok: false, reason: "unknown" });
    expect(plan(three(), drag("g1", "a"), { kind: "tab", group: "nope" })).toEqual({ ok: false, reason: "unknown" });
  });
});

describe("the model", () => {
  it("never changes the layout it is given", () => {
    const layout = three();
    const copy = JSON.stringify(layout);
    plan(layout, drag("g1", "a"), { kind: "split", group: "g3", side: "top" });
    plan(layout, drag("g1", "a"), { kind: "edge", side: "top" });
    expect(JSON.stringify(layout)).toBe(copy);
  });

  it("gives back a layout it can be asked about again", () => {
    const first = ok(plan(three(), drag("g1", "a"), { kind: "split", group: "g3", side: "top" }));
    const second = plan(first.layout, drag("g2", "b"), { kind: "tab", group: first.group });
    expect(second.ok).toBe(true);
  });

  it("tells where every group is now", () => {
    expect(groupRects(three(), 0)).toEqual({ g1: { x: 0, y: 0, width: 400, height: 600 }, g2: { x: 400, y: 0, width: 400, height: 600 }, g3: { x: 800, y: 0, width: 400, height: 600 } });
  });
});
