import { describe, expect, it } from "vitest";
import { shareOut } from "./dock";

describe("shareOut", () => {
  it("shares room evenly when every minimum fits", () => {
    expect(shareOut(1000, [320, 320, 320])).toEqual([1000 / 3, 1000 / 3, 1000 / 3]);
  });

  it("gives tight members their minimum and shares the rest", () => {
    expect(shareOut(1000, [500, 100, 100])).toEqual([500, 250, 250]);
  });

  it("settles on minimums when there is exactly enough room", () => {
    expect(shareOut(960, [320, 640])).toEqual([320, 640]);
  });
});
