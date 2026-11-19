import { describe, expect, it } from "vitest";
import { keepMiddle, viewOf } from "./view";

const shown = (width: number, height: number, scrollX = 0, scrollY = 0, zoom = 1) => ({ width, height, scrollX, scrollY, zoom: { value: zoom } });

describe("keepMiddle", () => {
  it("waits while the board has no size yet", () => {
    expect(keepMiddle(null, shown(0, 0))).toBeNull();
    expect(keepMiddle({ width: 800, height: 600 }, shown(0, 0))).toBeNull();
  });

  it("remembers the first size without moving anything", () => {
    expect(keepMiddle(null, shown(800, 600, 10, 20))).toEqual({ size: { width: 800, height: 600 } });
  });

  it("does nothing while the size stays the same", () => {
    expect(keepMiddle({ width: 800, height: 600 }, shown(800, 600))).toBeNull();
  });

  it("keeps the middle in place when the board grows or shrinks", () => {
    expect(keepMiddle({ width: 600, height: 400 }, shown(800, 600, 10, 20))).toEqual({ size: { width: 800, height: 600 }, scroll: { scrollX: 110, scrollY: 120 } });
    expect(keepMiddle({ width: 800, height: 600 }, shown(600, 400, 110, 120))).toEqual({ size: { width: 600, height: 400 }, scroll: { scrollX: 10, scrollY: 20 } });
  });

  it("counts the change in board units at the zoom shown", () => {
    expect(keepMiddle({ width: 600, height: 400 }, shown(800, 600, 0, 0, 2))!.scroll).toEqual({ scrollX: 50, scrollY: 50 });
  });
});

describe("viewOf", () => {
  it("keeps the size only once the board has one", () => {
    expect(viewOf(shown(800, 600, 1, 2, 3))).toEqual({ scrollX: 1, scrollY: 2, zoom: 3, width: 800, height: 600 });
    expect(viewOf(shown(0, 0, 1, 2, 3))).toEqual({ scrollX: 1, scrollY: 2, zoom: 3 });
  });
});
