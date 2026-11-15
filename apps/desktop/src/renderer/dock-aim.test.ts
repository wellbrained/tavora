import { describe, expect, it } from "vitest";
import { aimAt, EDGE_ZONE, OUTER_ZONE, sameTarget, spots, stepToward, zone, type Aim, type Spot } from "./dock-aim";
import type { DropTarget } from "./dock-model";

// Two groups side by side in a 1000 x 600 dock: a at 0..500, b at 500..1000.
const aim: Aim = {
  width: 1000,
  height: 600,
  rects: { a: { x: 0, y: 0, width: 500, height: 600 }, b: { x: 500, y: 0, width: 500, height: 600 } },
  slots: { a: [{ left: 0, width: 100 }, { left: 100, width: 100 }], b: [] },
};

describe("a group's content", () => {
  it("makes a new column in the left or right 30 %, a new row in the top or bottom 30 %", () => {
    expect(aimAt(aim, 750, 300)).toEqual({ kind: "tab", group: "b" });
    expect(aimAt(aim, 500 + 500 * 0.25, 300)).toEqual({ kind: "split", group: "b", side: "left" });
    expect(aimAt(aim, 500 + 500 * 0.8, 300)).toEqual({ kind: "split", group: "b", side: "right" });
    expect(aimAt(aim, 750, 36 + 564 * 0.2)).toEqual({ kind: "split", group: "b", side: "top" });
    expect(aimAt(aim, 750, 36 + 564 * 0.8)).toEqual({ kind: "split", group: "b", side: "bottom" });
  });

  it("takes the nearest edge in a corner", () => {
    expect(zone(0.1, 0.25)).toBe("left");
    expect(zone(0.25, 0.1)).toBe("top");
    expect(zone(0.5, 0.5)).toBeNull();
    expect(EDGE_ZONE).toBe(0.3);
  });
});

describe("a tab strip", () => {
  it("picks the slot by the middle of the tabs that stay", () => {
    expect(aimAt(aim, 40, 24)).toEqual({ kind: "tab", group: "a", index: 0 });
    expect(aimAt(aim, 120, 24)).toEqual({ kind: "tab", group: "a", index: 1 });
    expect(aimAt(aim, 400, 24)).toEqual({ kind: "tab", group: "a", index: 2 });
  });

  it("keeps the first and last slots where the strip runs to the dock's edge", () => {
    expect(aimAt(aim, 3, 24)).toEqual({ kind: "tab", group: "a", index: 0 });
    expect(aimAt(aim, 997, 24)).toEqual({ kind: "tab", group: "b", index: 0 });
    expect(aimAt(aim, 3, 60)).toEqual({ kind: "edge", side: "left" });
    expect(aimAt(aim, 40, 3)).toEqual({ kind: "edge", side: "top" });
  });

  it("puts a group without tabs at index 0", () => {
    expect(aimAt(aim, 700, 24)).toEqual({ kind: "tab", group: "b", index: 0 });
  });
});

describe("the dock's edges", () => {
  it("aim at the whole dock's edge within a thin strip, over the groups' own zones", () => {
    expect(aimAt(aim, OUTER_ZONE - 1, 300)).toEqual({ kind: "edge", side: "left" });
    expect(aimAt(aim, 1000 - 3, 300)).toEqual({ kind: "edge", side: "right" });
    expect(aimAt(aim, 700, 4)).toEqual({ kind: "edge", side: "top" });
    expect(aimAt(aim, 700, 598)).toEqual({ kind: "edge", side: "bottom" });
    expect(aimAt(aim, OUTER_ZONE + 5, 300)).toEqual({ kind: "split", group: "a", side: "left" });
  });

  it("aim at nothing outside the dock", () => {
    expect(aimAt(aim, -5, 100)).toBeNull();
    expect(aimAt(aim, 500, 700)).toBeNull();
  });
});

describe("the keyboard's places", () => {
  const all = spots(aim);
  const at = (target: DropTarget): Spot => all.find((spot) => sameTarget(spot.target, target))!;

  it("are every place the pointer can aim at, once each, in reading order, each with a point that aims there", () => {
    expect(all.map((spot) => spot.target)).toEqual([
      { kind: "edge", side: "top" },
      { kind: "edge", side: "left" },
      { kind: "tab", group: "a", index: 0 },
      { kind: "tab", group: "a", index: 1 },
      { kind: "tab", group: "a", index: 2 },
      { kind: "split", group: "a", side: "top" },
      { kind: "split", group: "a", side: "left" },
      { kind: "tab", group: "a" },
      { kind: "split", group: "a", side: "right" },
      { kind: "split", group: "a", side: "bottom" },
      { kind: "tab", group: "b", index: 0 },
      { kind: "split", group: "b", side: "top" },
      { kind: "split", group: "b", side: "left" },
      { kind: "tab", group: "b" },
      { kind: "split", group: "b", side: "right" },
      { kind: "split", group: "b", side: "bottom" },
      { kind: "edge", side: "right" },
      { kind: "edge", side: "bottom" },
    ]);
    for (const spot of all) expect(aimAt(aim, spot.x, spot.y)).toEqual(spot.target);
  });

  it("find the dock's edge beside a tab strip that runs to it", () => {
    // Two rows: the lower group's tab strip lies across the middle of the dock's left and right edges.
    const rows: Aim = { width: 1000, height: 600, rects: { a: { x: 0, y: 0, width: 1000, height: 300 }, b: { x: 0, y: 300, width: 1000, height: 300 } }, slots: { a: [], b: [] } };
    const targets = spots(rows).map((spot) => spot.target);
    expect(targets).toContainEqual({ kind: "edge", side: "left" });
    expect(targets).toContainEqual({ kind: "edge", side: "right" });
  });

  it("reach the splits of a narrow group at the dock's edge, past the dock's edge strip", () => {
    const narrow: Aim = { width: 1000, height: 600, rects: { a: { x: 0, y: 0, width: 60, height: 600 }, b: { x: 60, y: 0, width: 940, height: 600 } }, slots: { a: [], b: [] } };
    const found = spots(narrow);
    expect(found.map((spot) => spot.target)).toContainEqual({ kind: "split", group: "a", side: "left" });
    for (const spot of found) expect(aimAt(narrow, spot.x, spot.y)).toEqual(spot.target);
  });

  it("step with the arrow keys to the nearest place that way, straight ahead first", () => {
    const right = (from: Spot) => stepToward(all, from, "right")!;
    let spot = at({ kind: "tab", group: "a" });
    const seen: DropTarget[] = [];
    for (let step = 0; step < 5; step++) seen.push((spot = right(spot)).target);
    expect(seen).toEqual([
      { kind: "split", group: "a", side: "right" },
      { kind: "split", group: "b", side: "left" },
      { kind: "tab", group: "b" },
      { kind: "split", group: "b", side: "right" },
      { kind: "edge", side: "right" },
    ]);
    expect(stepToward(all, spot, "right")).toBeNull();
    expect(stepToward(all, at({ kind: "split", group: "a", side: "left" }), "left")!.target).toEqual({ kind: "edge", side: "left" });
    expect(stepToward(all, at({ kind: "tab", group: "a" }), "top")!.target).toEqual({ kind: "split", group: "a", side: "top" });
    expect(stepToward(all, at({ kind: "tab", group: "a", index: 0 }), "right")!.target).toEqual({ kind: "tab", group: "a", index: 1 });
    expect(stepToward(all, at({ kind: "tab", group: "a", index: 1 }), "left")!.target).toEqual({ kind: "tab", group: "a", index: 0 });
  });
});
