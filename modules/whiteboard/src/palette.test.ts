import { describe, expect, it } from "vitest";
import { clampPlace, DEFAULT_PALETTE, palettePlace } from "./Palette";

const board = { left: 0, top: 40, right: 800, bottom: 600 };
const home = { left: 16, top: 100, right: 216, bottom: 500 };

describe("palettePlace", () => {
  it("reads a stored place and falls back for anything else", () => {
    expect(palettePlace({ x: 12, y: -4, collapsed: true, more: true })).toEqual({ x: 12, y: -4, collapsed: true, more: true });
    expect(palettePlace(undefined)).toEqual(DEFAULT_PALETTE);
    expect(palettePlace({ x: "1", y: Number.NaN, collapsed: "yes" })).toEqual(DEFAULT_PALETTE);
  });
});

describe("clampPlace", () => {
  it("leaves a place on the board as it is", () => {
    expect(clampPlace(300, 50, home, board)).toEqual({ x: 300, y: 50 });
  });

  it("keeps the whole width and the handle on the board", () => {
    expect(clampPlace(-500, -500, home, board)).toEqual({ x: -16, y: -60 });
    expect(clampPlace(5000, 5000, home, board)).toEqual({ x: 584, y: 460 });
  });

  it("pins a palette wider than the board to its left edge", () => {
    expect(clampPlace(100, 0, home, { ...board, right: 150 })).toEqual({ x: -16, y: 0 });
  });
});
