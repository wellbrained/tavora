import { describe, expect, it } from "vitest";
import { initialLayoutBounds, reusable } from "./window-state";

const first = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 2560, height: 1400 };
const saved = { bounds: { x: 2000, y: 100, width: 900, height: 600 }, maximized: false };

describe("initialLayoutBounds", () => {
  it("opens where the user left it, while that screen is still there", () => {
    expect(reusable(saved, [first, second])).toBe(true);
    expect(initialLayoutBounds(saved, [first, second], first, { x: 0, y: 0, width: 1920, height: 1080 })).toEqual(saved);
  });

  it("opens on a screen the game isn't on, when there is one", () => {
    const state = initialLayoutBounds(null, [first, second], first, { x: 100, y: 100, width: 1280, height: 720 });
    expect(state.bounds.x).toBeGreaterThanOrEqual(second.x);
    expect(state.bounds.x + state.bounds.width).toBeLessThanOrEqual(second.x + second.width);
    // And the other way round.
    const other = initialLayoutBounds(null, [first, second], first, { x: 2000, y: 0, width: 1920, height: 1080 });
    expect(other.bounds.x + other.bounds.width).toBeLessThanOrEqual(first.width);
  });

  it("opens on the main screen with one screen, or when the game is not known", () => {
    expect(initialLayoutBounds(null, [first], first, { x: 0, y: 0, width: 1920, height: 1080 }).bounds.x).toBeGreaterThanOrEqual(0);
    expect(initialLayoutBounds(null, [first, second], first, null).bounds.x + 1).toBeLessThanOrEqual(first.width);
  });

  it("forgets a place that is on a screen that went away", () => {
    expect(reusable(saved, [first])).toBe(false);
    expect(initialLayoutBounds(saved, [first], first, null).bounds.x).toBeLessThan(first.width);
  });

  it("never saves a window too small to use", () => {
    expect(reusable({ bounds: { x: 0, y: 0, width: 100, height: 100 }, maximized: false }, [first])).toBe(false);
    expect(reusable({ bounds: { x: 0.5, y: 0, width: 900, height: 600 }, maximized: false }, [first])).toBe(false);
    expect(reusable(null, [first])).toBe(false);
  });
});
