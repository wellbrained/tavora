import { describe, expect, it } from "vitest";
import { pictureSize } from "./module-icon";

/**
 * The service (apps/api/src/png.ts) and the app (module-icon.ts) each read a WebP's size from its header, and a picture
 * one accepts must not be refused by the other. The same fixtures run through both. The service is loaded by a path the
 * desktop typecheck does not follow.
 */
const api = (await import(/* @vite-ignore */ new URL("../../../api/src/png.ts", import.meta.url).href)) as {
  webpSize(bytes: Uint8Array): { width: number; height: number } | null;
};

/** A WebP file: a RIFF header around one chunk. `riffSize` and `chunkLength` default to the true sizes. */
function webp(kind: string, chunk: Buffer, options: { riffSize?: number; chunkLength?: number; tail?: number; magic?: string } = {}): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(options.chunkLength ?? chunk.length);
  const body = Buffer.concat([Buffer.from(`${options.magic ?? "WEBP"}${kind}`, "latin1"), length, chunk, Buffer.alloc(options.tail ?? 0)]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(options.riffSize ?? body.length);
  return Buffer.concat([Buffer.from("RIFF"), size, body]);
}

function vp8l(width: number, height: number, signature = 0x2f, length = 5): Buffer {
  const chunk = Buffer.alloc(Math.max(length, 5));
  chunk[0] = signature;
  chunk.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  return chunk.subarray(0, length);
}

function vp8(width: number, height: number, start = [0x9d, 0x01, 0x2a], length = 10): Buffer {
  const chunk = Buffer.alloc(Math.max(length, 10));
  chunk.set(start, 3);
  chunk.writeUInt16LE(width, 6);
  chunk.writeUInt16LE(height, 8);
  return chunk.subarray(0, length);
}

function vp8x(width: number, height: number, length = 10): Buffer {
  const chunk = Buffer.alloc(Math.max(length, 10));
  chunk.writeUIntLE(width - 1, 4, 3);
  chunk.writeUIntLE(height - 1, 7, 3);
  return chunk.subarray(0, length);
}

const GOOD = {
  "VP8L": webp("VP8L", vp8l(64, 48)),
  "VP8": webp("VP8 ", vp8(64, 48)),
  "VP8X": webp("VP8X", vp8x(64, 48)),
  "VP8L at the 14-bit limit": webp("VP8L", vp8l(16384, 16384)),
  "VP8 at the 14-bit limit": webp("VP8 ", vp8(16383, 16383)),
  "VP8X at the 24-bit limit": webp("VP8X", vp8x(16_777_216, 16_777_216)),
  "VP8 with scale bits": webp("VP8 ", Buffer.concat([vp8(64, 48).subarray(0, 6), Buffer.from([0x40, 0xc0, 0x30, 0x40])])),
  "VP8L with more data after the header": webp("VP8L", Buffer.concat([vp8l(7, 9), Buffer.alloc(20, 1)])),
} satisfies Record<string, Buffer>;

const BAD = {
  "empty": Buffer.alloc(0),
  "short": Buffer.from("RIFF"),
  "19 bytes": Buffer.concat([webp("VP8L", vp8l(1, 1)).subarray(0, 19)]),
  "not RIFF": Buffer.concat([Buffer.from("RIFX"), webp("VP8L", vp8l(1, 1)).subarray(4)]),
  "not WEBP": webp("VP8L", vp8l(1, 1), { magic: "WEBQ" }),
  "RIFF size too big": webp("VP8L", vp8l(1, 1), { riffSize: 9999 }),
  "RIFF size too small": webp("VP8L", vp8l(1, 1), { riffSize: 12 }),
  "RIFF size one short": webp("VP8L", vp8l(1, 1), { riffSize: 24 }),
  "bytes after the RIFF size": webp("VP8L", vp8l(1, 1), { tail: 4, riffSize: 4 + 4 + 4 + 5 }),
  "chunk longer than the file": webp("VP8L", vp8l(1, 1), { chunkLength: 1000 }),
  "VP8L bad signature": webp("VP8L", vp8l(1, 1, 0x00)),
  "VP8L chunk of 4 bytes": webp("VP8L", vp8l(1, 1, 0x2f, 4)),
  "VP8 bad start code": webp("VP8 ", vp8(8, 8, [0x00, 0x00, 0x00])),
  "VP8 zero width": webp("VP8 ", vp8(0, 8)),
  "VP8 zero height": webp("VP8 ", vp8(8, 0)),
  "VP8 chunk of 9 bytes": webp("VP8 ", vp8(8, 8, [0x9d, 0x01, 0x2a], 9)),
  "VP8X chunk of 9 bytes": webp("VP8X", vp8x(8, 8, 9)),
  "unknown chunk": webp("ICCP", Buffer.alloc(20)),
  "ALPH first": webp("ALPH", Buffer.alloc(20)),
  "a header and nothing else": Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]),
} satisfies Record<string, Buffer>;

describe("WebP size readers (service and app)", () => {
  it.each(Object.entries(GOOD))("read %s the same", (_name, bytes) => {
    const fromApi = api.webpSize(bytes);
    expect(fromApi).not.toBeNull();
    const fromApp = pictureSize(bytes);
    expect(fromApp).toEqual({ type: "webp", ...fromApi });
  });

  it.each(Object.entries(BAD))("refuse %s in both", (_name, bytes) => {
    expect(api.webpSize(bytes)).toBeNull();
    expect(pictureSize(bytes)).toBeNull();
  });

  it("read the known sizes", () => {
    expect(api.webpSize(GOOD.VP8L)).toEqual({ width: 64, height: 48 });
    expect(api.webpSize(GOOD.VP8)).toEqual({ width: 64, height: 48 });
    expect(api.webpSize(GOOD.VP8X)).toEqual({ width: 64, height: 48 });
    expect(api.webpSize(GOOD["VP8X at the 24-bit limit"])).toEqual({ width: 16_777_216, height: 16_777_216 });
  });
});
