// A lossless picture of a panel. JPEG blurred text and shifted colours, so a panel visibly changed when its picture
// stood in for it; Electron's own toPNG compresses on the main thread and is slow for big panels. This one only
// reorders the pixels here and compresses on a worker thread (zlib's async deflate), at the fastest level.
import { crc32, deflate } from "node:zlib";
import { promisify } from "node:util";

const deflateAsync = promisify(deflate);
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(data, crc32(head.subarray(4))), 0);
  return Buffer.concat([head, data, tail]);
}

/**
 * A PNG of a bitmap as Chromium hands it out (`NativeImage.toBitmap`: BGRA, alpha premultiplied, rows maybe padded).
 * Null when the bitmap does not match the size.
 */
export async function encodePng(bgra: Uint8Array, width: number, height: number): Promise<Buffer | null> {
  if (width < 1 || height < 1 || bgra.length < width * height * 4 || bgra.length % height !== 0) return null;
  const stride = bgra.length / height;
  const row = width * 4 + 1;
  const raw = Buffer.allocUnsafe(row * height);
  for (let y = 0; y < height; y++) {
    let out = y * row;
    // Filter type 0 (none) for every row: the fastest, and pictures of panels compress well without one.
    raw[out++] = 0;
    for (let at = y * stride, end = at + width * 4; at < end; at += 4, out += 4) {
      const a = bgra[at + 3]!;
      if (a === 255 || a === 0) {
        raw[out] = bgra[at + 2]!;
        raw[out + 1] = bgra[at + 1]!;
        raw[out + 2] = bgra[at]!;
      } else {
        raw[out] = Math.min(255, Math.round((bgra[at + 2]! * 255) / a));
        raw[out + 1] = Math.min(255, Math.round((bgra[at + 1]! * 255) / a));
        raw[out + 2] = Math.min(255, Math.round((bgra[at]! * 255) / a));
      }
      raw[out + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // 8 bits per channel, colour type 6 (RGBA), deflate, no filter method extras, no interlace.
  header.set([8, 6, 0, 0, 0], 8);
  const data = await deflateAsync(raw, { level: 1 });
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", data), chunk("IEND", Buffer.alloc(0))]);
}
