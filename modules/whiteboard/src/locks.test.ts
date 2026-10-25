import { describe, expect, it } from "vitest";
import { lockSpots, spotsKey } from "./locks";

const picture = (extra: Partial<{ id: string; type: string; isDeleted: boolean; locked: boolean; x: number; y: number; width: number; height: number; angle: number }> = {}) => ({
  id: "p",
  type: "image",
  locked: false,
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  angle: 0,
  ...extra,
});
const view = { scrollX: 0, scrollY: 0, zoom: 1, width: 800, height: 600 };

describe("lockSpots", () => {
  it("puts the lock just inside the top-right corner", () => {
    expect(lockSpots([picture({ locked: true })], view)).toEqual([{ id: "p", locked: true, x: 286, y: 64 }]);
  });

  it("follows the board's scroll and zoom", () => {
    expect(lockSpots([picture()], { ...view, scrollX: -50, scrollY: 10, zoom: 2 })).toEqual([{ id: "p", locked: false, x: 486, y: 134 }]);
  });

  it("turns with the picture", () => {
    // Half a turn: the top-right corner is now at the bottom left.
    expect(lockSpots([picture({ angle: Math.PI })], view)).toEqual([{ id: "p", locked: false, x: 114, y: 136 }]);
  });

  it("leaves out other elements, deleted and tiny pictures, and pictures off the board", () => {
    const spots = lockSpots(
      [picture({ id: "box", type: "rectangle" }), picture({ id: "gone", isDeleted: true }), picture({ id: "tiny", width: 30, height: 30 }), picture({ id: "away", x: 2000 })],
      view,
    );
    expect(spots).toEqual([]);
  });
});

describe("spotsKey", () => {
  it("changes when a lock moves or is switched", () => {
    const [spot] = lockSpots([picture()], view);
    expect(spotsKey([spot!])).not.toBe(spotsKey([{ ...spot!, x: spot!.x + 1 }]));
    expect(spotsKey([spot!])).not.toBe(spotsKey([{ ...spot!, locked: true }]));
  });
});
