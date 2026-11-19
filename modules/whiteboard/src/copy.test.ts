import { describe, expect, it } from "vitest";
import { copyScale, elementsToCopy, MAX_PIXELS, MAX_SIDE, SHARP_SCALE, pictureName } from "./copy";

describe("elementsToCopy", () => {
  it("copies the whole board, without deleted elements", () => {
    const board = [{ id: "picture", isDeleted: false }, { id: "box", isDeleted: false }, { id: "gone", isDeleted: true }];
    expect(elementsToCopy(board).map((element) => element.id)).toEqual(["picture", "box"]);
  });
});

describe("copyScale", () => {
  it("copies an ordinary drawing at twice its size", () => {
    expect(copyScale(800, 600)).toBe(SHARP_SCALE);
  });

  it("keeps the longest side within the limit", () => {
    const scale = copyScale(20_000, 500);
    expect(20_000 * scale).toBeCloseTo(MAX_SIDE);
  });

  it("keeps the number of pixels within the limit", () => {
    const scale = copyScale(6000, 6000);
    expect(6000 * scale * 6000 * scale).toBeLessThanOrEqual(MAX_PIXELS + 1);
    expect(6000 * scale).toBeLessThanOrEqual(MAX_SIDE);
  });

  it("falls back to 1 for an empty size", () => {
    expect(copyScale(0, 100)).toBe(1);
    expect(copyScale(Number.NaN, 100)).toBe(1);
  });
});

describe("pictureName", () => {
  it("is the board's name and when it was saved", () => {
    expect(pictureName("Board 1", new Date(2026, 9, 7, 9, 5))).toBe("Board 1 2026-10-07 09-05");
  });
});
