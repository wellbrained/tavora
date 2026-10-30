import { afterEach, describe, expect, it, vi } from "vitest";
import { createLockWatcher, lockSpots, spotsKey, type LockSpot } from "./locks";

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

describe("the lock watcher", () => {
  /** A page where the locks at some points are covered, and animation frames run when asked. */
  function page(covered: Set<string> = new Set()) {
    const shown: LockSpot[][] = [];
    const frames = new Map<number, () => void>();
    let frame = 0;
    const watcher = createLockWatcher({
      drawingAt: (x, y) => !covered.has(`${x},${y}`),
      origin: () => ({ left: 100, top: 50 }),
      onSpots: (spots) => shown.push(spots),
      frame: { request: (run) => (frames.set(++frame, run), frame), cancel: (id) => void frames.delete(id) },
    });
    const runFrames = () => {
      for (const [id, run] of [...frames]) {
        frames.delete(id);
        run();
      }
    };
    return { watcher, shown, covered, runFrames };
  }
  const spot = (id: string, x = 10, y = 10): LockSpot => ({ id, locked: false, x, y });

  afterEach(() => vi.useRealTimers());

  it("shows the locks that are on the drawing, and only tells the page when they change", () => {
    const { watcher, shown } = page();
    watcher.update([spot("a"), spot("b", 20, 20)], "pen#0");
    expect(shown).toHaveLength(1);
    expect(shown[0]!.map((entry) => entry.id)).toEqual(["a", "b"]);
    watcher.update([spot("a"), spot("b", 20, 20)], "pen#0");
    watcher.recheck();
    expect(shown).toHaveLength(1);
    watcher.update([spot("a", 11, 10), spot("b", 20, 20)], "pen#0");
    expect(shown).toHaveLength(2);
  });

  it("leaves out a lock under one of Excalidraw's menus, measured from where the board starts", () => {
    const { watcher, shown } = page(new Set(["110,60"]));
    watcher.update([spot("a"), spot("b", 20, 20)], "pen#0");
    expect(shown.at(-1)!.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("looks again later at a lock that was only covered for a moment", () => {
    vi.useFakeTimers();
    const { watcher, shown, covered, runFrames } = page(new Set(["110,60"]));
    watcher.update([spot("a")], "pen#0");
    expect(shown).toEqual([]);
    covered.clear();
    vi.advanceTimersByTime(400);
    expect(shown.at(-1)!.map((entry) => entry.id)).toEqual(["a"]);
    runFrames();
  });

  it("looks once more on the next frame, after the menus have drawn themselves", () => {
    const { watcher, shown, covered, runFrames } = page();
    watcher.update([spot("a")], "pen#0");
    covered.add("110,60");
    runFrames();
    expect(shown.at(-1)).toEqual([]);
  });

  it("only asks the page what is where when the locks or their surroundings changed", () => {
    const calls: string[] = [];
    const watcher = createLockWatcher({ drawingAt: (x, y) => (calls.push(`${x},${y}`), true), origin: () => ({ left: 0, top: 0 }), onSpots: () => undefined, frame: { request: () => 1, cancel: () => undefined } });
    watcher.update([spot("a")], "pen#0");
    const asked = calls.length;
    watcher.update([spot("a")], "pen#0");
    expect(calls).toHaveLength(asked);
    watcher.update([spot("a")], "pen#1");
    expect(calls.length).toBeGreaterThan(asked);
  });

  it("looks again on request, and stops when disposed", () => {
    vi.useFakeTimers();
    const { watcher, shown, covered } = page(new Set(["110,60"]));
    watcher.update([spot("a")], "pen#0");
    covered.clear();
    watcher.recheck();
    expect(shown.at(-1)!.map((entry) => entry.id)).toEqual(["a"]);
    covered.add("110,60");
    watcher.recheck();
    watcher.dispose();
    covered.clear();
    vi.advanceTimersByTime(1000);
    expect(shown.at(-1)).toEqual([]);
  });
});
