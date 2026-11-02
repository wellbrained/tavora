// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrollToCentered, stopScroll } from "./smooth-scroll";

// jsdom has no layout, so the boxes are given by hand: a 400 high panel on the screen from 100, 2000 of content, and a
// 40 high row 800 down it. Centered, the panel scrolls to 800 + 20 - 200 = 620.

function box(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) };
}

function setup(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce && query.includes("reduce"), media: query }));
  const scroller = document.createElement("div");
  const row = document.createElement("div");
  scroller.getBoundingClientRect = () => box(100, 400);
  row.getBoundingClientRect = () => box(900 - scroller.scrollTop, 40);
  Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
  scroller.scrollTop = 0;
  return { scroller, row };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("scrollToCentered", () => {
  it("glides to the row in the motion time and then says so", async () => {
    const { scroller, row } = setup(false);
    let done = false;
    void scrollToCentered(scroller, row).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(150);
    // Part of the way (an ease-out is past the middle after half the time), not yet there.
    expect(scroller.scrollTop).toBeGreaterThan(300);
    expect(scroller.scrollTop).toBeLessThan(620);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(scroller.scrollTop).toBe(620);
    expect(done).toBe(true);
  });

  it("jumps at once under reduced motion", async () => {
    const { scroller, row } = setup(true);
    await scrollToCentered(scroller, row);
    expect(scroller.scrollTop).toBe(620);
  });

  it("stopScroll ends a glide where it is, and it does not go on", async () => {
    const { scroller, row } = setup(false);
    let done = false;
    void scrollToCentered(scroller, row).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    const where = scroller.scrollTop;
    expect(where).toBeGreaterThan(0);
    stopScroll();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(scroller.scrollTop).toBe(where);
  });

  it("a new glide takes over from a running one", async () => {
    const { scroller, row } = setup(false);
    const first = scrollToCentered(scroller, row);
    await vi.advanceTimersByTimeAsync(100);
    const second = scrollToCentered(scroller, row);
    await first;
    await vi.advanceTimersByTimeAsync(400);
    await second;
    expect(scroller.scrollTop).toBe(620);
  });

  it("the user scrolling takes it over", async () => {
    const { scroller, row } = setup(false);
    let done = false;
    void scrollToCentered(scroller, row).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    const where = scroller.scrollTop;
    scroller.dispatchEvent(new Event("wheel"));
    await vi.advanceTimersByTimeAsync(400);
    expect(done).toBe(true);
    expect(scroller.scrollTop).toBe(where);
  });
});
