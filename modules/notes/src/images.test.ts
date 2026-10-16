import { describe, expect, it } from "vitest";
import { fitSize, isAcceptedType } from "./images";
import { clampWidth } from "./ImageNode";

describe("fitSize", () => {
  it("shrinks so the longest side fits, keeping the shape", () => {
    expect(fitSize(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitSize(1000, 4000, 1600)).toEqual({ width: 400, height: 1600 });
  });

  it("never makes a picture larger", () => {
    expect(fitSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1600, 1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it("keeps at least one pixel", () => {
    expect(fitSize(100000, 10, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe("isAcceptedType", () => {
  it("takes the four kinds and nothing else", () => {
    for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) expect(isAcceptedType(type)).toBe(true);
    for (const type of ["image/bmp", "image/svg+xml", "text/plain", ""]) expect(isAcceptedType(type)).toBe(false);
  });
});

describe("clampWidth", () => {
  it("snaps to steps of five, and full width means the picture's own size", () => {
    expect(clampWidth(47)).toBe(45);
    expect(clampWidth(52.6)).toBe(55);
    expect(clampWidth(97.5)).toBeNull();
    expect(clampWidth(140)).toBeNull();
  });

  it("never gets tiny", () => {
    expect(clampWidth(1)).toBe(10);
    expect(clampWidth(-30)).toBe(10);
  });
});
