import { describe, expect, it } from "vitest";
import { stackAbove, type Windows } from "./window-order";

/** Windows' order of windows, top first, with the always-on-top ones marked; placeBelow moves one as Windows does. */
function desk(order: number[], topmost: number[] = []) {
  const calls: [number, number][] = [];
  const windows: Windows = {
    above: (window) => {
      const index = order.indexOf(window);
      return index > 0 ? order[index - 1]! : 0;
    },
    topmost: (window) => topmost.includes(window),
    placeBelow: (window, after) => {
      calls.push([window, after]);
      order.splice(order.indexOf(window), 1);
      // HWND_TOP among the usual windows: right below the last always-on-top one.
      const at = after === 0 ? order.filter((one) => topmost.includes(one)).length : order.indexOf(after) + 1;
      order.splice(at, 0, window);
    },
  };
  return { order, calls, windows };
}

const GAME = 10;
const BROWSER = 20;
const OTHER_TOPMOST = 30;
const [A, B] = [1, 2];

describe("stackAbove", () => {
  it("puts the overlays right below the browser over the game, so the browser covers them", () => {
    // The overlays were always on top; now usual windows at the top, the browser in front of the game.
    const { order, windows } = desk([A, B, BROWSER, GAME]);
    stackAbove(windows, GAME, [A, B]);
    expect(order).toEqual([BROWSER, A, B, GAME]);
  });

  it("goes to the top of the usual windows when the game has none above it, never below an always-on-top one", () => {
    const { order, windows } = desk([OTHER_TOPMOST, GAME, A, B], [OTHER_TOPMOST]);
    stackAbove(windows, GAME, [A, B]);
    expect(order).toEqual([OTHER_TOPMOST, A, B, GAME]);
  });

  it("moves nothing when they are stacked so already, and fixes their order when it isn't", () => {
    const already = desk([BROWSER, A, B, GAME]);
    stackAbove(already.windows, GAME, [A, B]);
    expect(already.calls).toEqual([]);

    const swapped = desk([BROWSER, B, A, GAME]);
    stackAbove(swapped.windows, GAME, [A, B]);
    expect(swapped.order).toEqual([BROWSER, A, B, GAME]);
  });

  it("does nothing without overlays", () => {
    const { calls, windows } = desk([BROWSER, GAME]);
    stackAbove(windows, GAME, []);
    expect(calls).toEqual([]);
  });
});
