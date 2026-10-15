import { describe, expect, it } from "vitest";
import { toneOfBitmap } from "./icon-tone";

/** A 32 x 32 bitmap (blue, green, red, alpha; colours multiplied by alpha) whose pixel at (x, y) is given by `at` as [red, green, blue, alpha]. */
const bitmap = (at: (x: number, y: number) => [number, number, number, number]) =>
  Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => {
    const [red, green, blue, alpha] = at(Math.floor(i / 4) % 32, Math.floor(i / 128));
    return [(blue * alpha) / 255, (green * alpha) / 255, (red * alpha) / 255, alpha][i % 4]!;
  });

describe("toneOfBitmap", () => {
  it("lets a picture with no see-through parts fill the tile", () => {
    expect(toneOfBitmap(bitmap(() => [160, 130, 210, 255]))).toBe("opaque");
  });

  it("still counts a rounded square, with only its corners see-through, as filling the tile", () => {
    const corner = (x: number, y: number) => (x < 4 && y < 4) || (x > 27 && y < 4) || (x < 4 && y > 27) || (x > 27 && y > 27);
    expect(toneOfBitmap(bitmap((x, y) => (corner(x, y) ? [0, 0, 0, 0] : [40, 40, 40, 255])))).toBe("opaque");
  });

  it("puts a dark logo on a light backdrop, and a light logo on a dark one", () => {
    const logo = (colour: [number, number, number]) => bitmap((x, y) => (x > 8 && x < 24 && y > 8 && y < 24 ? [...colour, 255] : [0, 0, 0, 0]));
    expect(toneOfBitmap(logo([30, 20, 20]))).toBe("onLight");
    expect(toneOfBitmap(logo([245, 245, 245]))).toBe("onDark");
  });

  it("judges a half see-through logo by its real colour, not the multiplied one", () => {
    // White at half opacity is stored as mid grey; it is still a light logo.
    expect(toneOfBitmap(bitmap((x, y) => (x > 4 && x < 28 && y > 4 && y < 28 ? [255, 255, 255, 200] : [0, 0, 0, 0])))).toBe("onDark");
  });

  it("uses the dark backdrop when nothing can be judged", () => {
    expect(toneOfBitmap(bitmap(() => [0, 0, 0, 0]))).toBe("onDark");
    expect(toneOfBitmap([])).toBe("onDark");
  });
});
