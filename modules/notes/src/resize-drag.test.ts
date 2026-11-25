import { describe, expect, it, vi } from "vitest";
import { createResizeDrag } from "./resize-drag";

function setup() {
  const shown: number[] = [];
  const commit = vi.fn();
  const drag = createResizeDrag({ sizeAt: (started, by) => Math.min(400, Math.max(100, started + by)), show: (size) => shown.push(size), commit });
  return { drag, shown, commit };
}

describe("a resize drag", () => {
  it("follows the pointer and keeps the size when it is let go", () => {
    const { drag, shown, commit } = setup();
    drag.start(10, 200);
    drag.move(60);
    expect(shown).toEqual([250]);
    drag.end();
    expect(commit).toHaveBeenCalledWith(250);
  });

  it("goes back to the size it started at, and keeps nothing, when the system takes the pointer away", () => {
    const { drag, shown, commit } = setup();
    drag.start(10, 200);
    drag.move(80);
    drag.cancel();
    expect(shown).toEqual([270, 200]);
    drag.end();
    expect(commit).not.toHaveBeenCalled();
  });

  it("does nothing for moves and ends without a start", () => {
    const { drag, shown, commit } = setup();
    drag.move(5);
    drag.end();
    drag.cancel();
    expect([shown, commit.mock.calls]).toEqual([[], []]);
  });
});
