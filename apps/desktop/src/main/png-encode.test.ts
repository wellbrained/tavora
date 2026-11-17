import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { checkPng } from "./png";
import { encodePng } from "./png-encode";

describe("encodePng", () => {
  it("writes a well-formed PNG with the pixels in RGBA order, padded rows and premultiplied alpha undone", async () => {
    // Two rows of two pixels, each row padded to 12 bytes: opaque red, see-through, half-transparent white, opaque blue.
    const bgra = Uint8Array.from([
      0, 0, 255, 255, /* */ 0, 0, 0, 0, /* pad */ 9, 9, 9, 9,
      128, 128, 128, 128, /* */ 255, 0, 0, 255, /* pad */ 9, 9, 9, 9,
    ]);
    const png = await encodePng(bgra, 2, 2);
    expect(png).not.toBeNull();
    expect(checkPng(png!, { maxSide: 10, maxPixels: 100 })).toEqual({ ok: true, width: 2, height: 2 });
    // IDAT starts after the signature (8) and IHDR (25): length, type, data.
    const length = png!.readUInt32BE(33);
    const raw = inflateSync(png!.subarray(41, 41 + length));
    expect([...raw]).toEqual([0, 255, 0, 0, 255, 0, 0, 0, 0, /* */ 0, 255, 255, 255, 128, 0, 0, 255, 255]);
  });

  it("gives nothing for a bitmap that does not match its size", async () => {
    expect(await encodePng(new Uint8Array(12), 2, 2)).toBeNull();
    expect(await encodePng(new Uint8Array(0), 0, 0)).toBeNull();
  });
});
