// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { IMAGE_LIMITS, imageScale, renderToImage } from "./render-to-image";

describe("imageScale", () => {
  it("draws twice as sharp, unless that goes past a side or the pixel budget", () => {
    expect(imageScale(400, 300)).toBe(2);
    expect(imageScale(400, 300, 3)).toBe(3);
    // A long strip: the side decides.
    expect(imageScale(8192, 100)).toBe(1);
    // A big square: the pixel budget decides.
    const square = imageScale(5000, 5000);
    expect(5000 * square * 5000 * square).toBeLessThanOrEqual(IMAGE_LIMITS.pixels + 1);
    expect(square).toBeLessThan(2);
  });
});

describe("renderToImage", () => {
  it("refuses a picture without a size", async () => {
    const draw = () => {};
    await expect(renderToImage({ width: 0, height: 10, draw })).rejects.toThrow();
    await expect(renderToImage({ width: 10, height: Number.NaN, draw })).rejects.toThrow();
    await expect(renderToImage({ width: Number.POSITIVE_INFINITY, height: 10, draw })).rejects.toThrow();
  });
});
