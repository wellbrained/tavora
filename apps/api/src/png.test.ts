import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeRgbaPng, encodePng, icoToPng, inspectPng, MAX_ICON_BYTES } from "./png.ts";

/** A w×h picture with a different colour per pixel, as RGBA. */
const picture = (w: number, h: number, alpha = 255) =>
  Uint8Array.from({ length: w * h * 4 }, (_, i) => (i % 4 === 3 ? alpha : (i * 37) % 256));

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Rewrites a chunk's checksum after a test changed its bytes. */
function fixCrc(png: Uint8Array, at: number): void {
  const length = view(png).getUint32(at);
  view(png).setUint32(at + 8 + length, crc32(png.subarray(at + 4, at + 8 + length)));
}

describe("inspectPng", () => {
  const png = encodePng(8, 4, picture(8, 4));

  it("reads the size of a well-formed PNG", () => {
    expect(inspectPng(png)).toEqual({ width: 8, height: 4 });
  });

  it("round-trips pixels through encodePng", () => {
    const decoded = decodeRgbaPng(png)!;
    expect(decoded).toMatchObject({ width: 8, height: 4 });
    expect(decoded.rgba).toEqual(picture(8, 4));
  });

  it("refuses a wrong signature, a damaged checksum, a cut file and trailing bytes", () => {
    const wrongSignature = png.slice();
    wrongSignature[1] = 0x51;
    const damaged = png.slice();
    damaged[30] = damaged[30]! ^ 0xff;
    const trailing = new Uint8Array(png.byteLength + 3);
    trailing.set(png);
    for (const bad of [wrongSignature, damaged, png.slice(0, png.byteLength - 5), png.slice(0, 40), trailing, new Uint8Array(0)]) {
      expect(inspectPng(bad)).toBeNull();
    }
  });

  it("refuses pictures over 256 px, empty pictures and files over the size limit", () => {
    expect(inspectPng(encodePng(256, 256, picture(256, 256)))).toEqual({ width: 256, height: 256 });
    const big = encodePng(8, 4, picture(8, 4));
    view(big).setUint32(16, 257);
    fixCrc(big, 8);
    expect(inspectPng(big)).toBeNull();
    const empty = encodePng(8, 4, picture(8, 4));
    view(empty).setUint32(16, 0);
    fixCrc(empty, 8);
    expect(inspectPng(empty)).toBeNull();
    // Noise does not compress: a 256 px picture of it is far over 200 KB.
    let state = 123456789;
    const noise = Uint8Array.from({ length: 256 * 256 * 4 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state & 0xff;
    });
    expect(encodePng(256, 256, noise).byteLength).toBeGreaterThan(MAX_ICON_BYTES);
    expect(inspectPng(encodePng(256, 256, noise))).toBeNull();
  });

  it("refuses a PNG with no image data or without its IHDR first", () => {
    const parts = (types: string[]) => {
      const chunks = types.map((type) => {
        const data = type === "IHDR" ? Uint8Array.from([0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0]) : new Uint8Array(0);
        const out = new Uint8Array(12 + data.byteLength);
        view(out).setUint32(0, data.byteLength);
        for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        view(out).setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
        return out;
      });
      const all = new Uint8Array(8 + chunks.reduce((sum, c) => sum + c.byteLength, 0) + 40);
      all.set(png.subarray(0, 8));
      let at = 8;
      for (const c of chunks) (all.set(c, at), (at += c.byteLength));
      return all.slice(0, at);
    };
    expect(inspectPng(parts(["IHDR", "IEND"]))).toBeNull();
    expect(inspectPng(parts(["IDAT", "IHDR", "IEND"]))).toBeNull();
  });
});

/** A DIB frame: 40-byte header, bottom-up colour rows, then the 1-bit mask rows (1 = see-through). */
function dib(width: number, height: number, bits: 24 | 32, pixelAt: (x: number, y: number) => [number, number, number, number], maskAt: (x: number, y: number) => number = () => 0) {
  const colorStride = Math.ceil((width * bits) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const data = new Uint8Array(40 + colorStride * height + maskStride * height);
  const v = view(data);
  v.setUint32(0, 40, true);
  v.setInt32(4, width, true);
  v.setInt32(8, height * 2, true);
  v.setUint16(12, 1, true);
  v.setUint16(14, bits, true);
  for (let y = 0; y < height; y += 1) {
    const row = 40 + (height - 1 - y) * colorStride;
    const maskRow = 40 + colorStride * height + (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const at = row + x * (bits / 8);
      data[at] = b;
      data[at + 1] = g;
      data[at + 2] = r;
      if (bits === 32) data[at + 3] = a;
      if (maskAt(x, y)) data[maskRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return data;
}

/** An .ico with these frames, in this order; a size of 256 is stored as 0, as in real files. */
function ico(...frames: Array<{ size: number; data: Uint8Array; height?: number }>): Uint8Array {
  const header = 6 + frames.length * 16;
  const out = new Uint8Array(header + frames.reduce((sum, f) => sum + f.data.byteLength, 0));
  const v = view(out);
  v.setUint16(2, 1, true);
  v.setUint16(4, frames.length, true);
  let offset = header;
  frames.forEach((f, i) => {
    const at = 6 + i * 16;
    out[at] = f.size >= 256 ? 0 : f.size;
    out[at + 1] = (f.height ?? f.size) >= 256 ? 0 : (f.height ?? f.size);
    v.setUint32(at + 8, f.data.byteLength, true);
    v.setUint32(at + 12, offset, true);
    out.set(f.data, offset);
    offset += f.data.byteLength;
  });
  return out;
}

describe("icoToPng", () => {
  const pixel = (x: number, y: number): [number, number, number, number] => [(x * 40) % 256, (y * 60) % 256, (x + y) * 20, 255];

  it("returns a frame that already is a PNG exactly as it is", () => {
    const png = encodePng(16, 16, picture(16, 16));
    expect(icoToPng(ico({ size: 16, data: png }))).toEqual(png);
  });

  it("re-wraps a 32 bit bitmap frame without changing a pixel, alpha included", () => {
    const frame = dib(6, 5, 32, (x, y) => [x * 30, y * 40, 7, (x + y) % 2 ? 255 : 128]);
    const out = decodeRgbaPng(icoToPng(ico({ size: 6, height: 5, data: frame }))!)!;
    expect(out).toMatchObject({ width: 6, height: 5 });
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        expect([...out.rgba.subarray((y * 6 + x) * 4, (y * 6 + x) * 4 + 4)]).toEqual([x * 30, y * 40, 7, (x + y) % 2 ? 255 : 128]);
      }
    }
  });

  it("takes transparency from the mask for a 24 bit frame and for a 32 bit frame with no alpha", () => {
    const masked = (x: number) => (x < 2 ? 1 : 0);
    for (const bits of [24, 32] as const) {
      const frame = dib(4, 4, bits, (x, y) => [...pixel(x, y).slice(0, 3), 0] as [number, number, number, number], (x) => masked(x));
      const out = decodeRgbaPng(icoToPng(ico({ size: 4, data: frame }))!)!;
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) expect(out.rgba[(y * 4 + x) * 4 + 3]).toBe(x < 2 ? 0 : 255);
      }
      expect([...out.rgba.subarray(8, 11)]).toEqual(pixel(2, 0).slice(0, 3));
    }
  });

  it("uses the biggest frame, and a 256 px frame stored as 0", () => {
    const small = dib(4, 4, 32, pixel);
    const big = dib(256, 256, 32, (x, y) => [x, y, 0, 255]);
    const out = decodeRgbaPng(icoToPng(ico({ size: 4, data: small }, { size: 256, data: big }))!)!;
    expect(out).toMatchObject({ width: 256, height: 256 });
    expect([...out.rgba.subarray((3 * 256 + 5) * 4, (3 * 256 + 5) * 4 + 4)]).toEqual([5, 3, 0, 255]);
  });

  it("falls back to a smaller frame when the biggest cannot be read", () => {
    const broken = new Uint8Array(500).fill(7);
    const fine = encodePng(8, 8, picture(8, 8));
    expect(icoToPng(ico({ size: 64, data: broken }, { size: 8, data: fine }))).toEqual(fine);
  });

  it("gives null for anything that is not a readable icon", () => {
    const frame = dib(4, 4, 32, pixel);
    const palette = frame.slice();
    view(palette).setUint16(14, 8, true);
    const compressed = frame.slice();
    view(compressed).setUint32(16, 1, true);
    const huge = frame.slice();
    view(huge).setInt32(4, 100000, true);
    const cases = [
      new Uint8Array(0),
      new Uint8Array(100),
      new TextEncoder().encode("not an icon at all, just some text bytes"),
      ico({ size: 4, data: palette }),
      ico({ size: 4, data: compressed }),
      ico({ size: 4, data: huge }),
      ico({ size: 4, data: frame.slice(0, 50) }),
      ico({ size: 4, data: new Uint8Array(0) }),
      encodePng(4, 4, picture(4, 4)),
    ];
    for (const bytes of cases) expect(icoToPng(bytes)).toBeNull();
    const lying = ico({ size: 4, data: frame });
    view(lying).setUint32(6 + 12, 99999, true);
    expect(icoToPng(lying)).toBeNull();
  });
});
