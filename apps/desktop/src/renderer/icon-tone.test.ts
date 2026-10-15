import { describe, expect, it } from "vitest";
import { toneOfPixels } from "./icon-tone";

/** A 32 x 32 picture whose pixel at (x, y) is given by `at`. */
const picture = (at: (x: number, y: number) => [number, number, number, number]) =>
  Uint8ClampedArray.from({ length: 32 * 32 * 4 }, (_, i) => at(Math.floor(i / 4) % 32, Math.floor(i / 128))[i % 4]!);

describe("toneOfPixels", () => {
  it("lets a picture with no see-through parts fill the tile", () => {
    expect(toneOfPixels(picture(() => [160, 130, 210, 255]))).toBe("opaque");
  });

  it("still counts a rounded square, with only its corners see-through, as filling the tile", () => {
    const corner = (x: number, y: number) => (x < 3 && y < 3) || (x > 28 && y < 3) || (x < 3 && y > 28) || (x > 28 && y > 28);
    expect(toneOfPixels(picture((x, y) => (corner(x, y) ? [0, 0, 0, 0] : [40, 40, 40, 255])))).toBe("opaque");
  });

  it("puts a dark logo on a light backdrop, and a light logo on a dark one", () => {
    const logo = (colour: [number, number, number]) => picture((x, y) => (x > 8 && x < 24 && y > 8 && y < 24 ? [...colour, 255] : [0, 0, 0, 0]));
    expect(toneOfPixels(logo([30, 20, 20]))).toBe("onLight");
    expect(toneOfPixels(logo([245, 245, 245]))).toBe("onDark");
  });

  it("uses the dark backdrop when nothing can be judged", () => {
    expect(toneOfPixels(picture(() => [0, 0, 0, 0]))).toBe("onDark");
    expect(toneOfPixels([])).toBe("onDark");
  });
});
