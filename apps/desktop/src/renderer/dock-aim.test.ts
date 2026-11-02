import { describe, expect, it } from "vitest";
import { aimAt, EDGE_ZONE, OUTER_ZONE, zone, type Aim } from "./dock-aim";

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
