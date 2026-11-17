// A lossless picture of a panel. JPEG blurred text and shifted colours, so a panel visibly changed when its picture
// stood in for it; Electron's own toPNG compresses on the main thread and is slow for big panels. This one only
// reorders the pixels here and compresses on a worker thread (zlib's async deflate), at the fastest level.
import { crc32, deflate } from "node:zlib";
import { promisify } from "node:util";

const deflateAsync = promisify(deflate);
const LITTLE_ENDIAN = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
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
  const rgba = toRgba(bgra, width, height, stride);
  const row = width * 4 + 1;
  const raw = Buffer.allocUnsafe(row * height);
  for (let y = 0; y < height; y++) {
    // Filter type 0 (none) for every row: the fastest, and pictures of panels compress well without one.
    raw[y * row] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // 8 bits per channel, colour type 6 (RGBA), deflate, no filter method extras, no interlace.
  header.set([8, 6, 0, 0, 0], 8);
  const data = await deflateAsync(raw, { level: 1 });
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", data), chunk("IEND", Buffer.alloc(0))]);
}

/** The pixels in RGBA order with straight alpha, rows packed. A whole pixel at a time where it can: a big panel has millions. */
function toRgba(bgra: Uint8Array, width: number, height: number, stride: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const words = new Uint32Array(out.buffer);
  // Aligned for a word view (a copy when it is not); a padded stride stays a whole number of pixels.
  const source = bgra.byteOffset % 4 === 0 ? bgra : bgra.slice();
  const fast = LITTLE_ENDIAN && stride % 4 === 0;
  const input = fast ? new Uint32Array(source.buffer, source.byteOffset, source.length / 4) : null;
  for (let y = 0; y < height; y++) {
    for (let x = 0, at = y * stride, to = y * width; x < width; x++, at += 4, to++) {
      const a = source[at + 3]!;
      if (input && (a === 255 || a === 0)) {
        // B G R A in memory is 0xAARRGGBB; R G B A is 0xAABBGGRR.
        const v = input[at / 4]!;
        words[to] = ((v & 0xff00ff00) | ((v >>> 16) & 0xff) | ((v & 0xff) << 16)) >>> 0;
        continue;
      }
      // Chromium's alpha is premultiplied; PNG's is not.
      const scale = a === 255 || a === 0 ? 1 : 255 / a;
      out[to * 4] = Math.min(255, Math.round(source[at + 2]! * scale));
      out[to * 4 + 1] = Math.min(255, Math.round(source[at + 1]! * scale));
      out[to * 4 + 2] = Math.min(255, Math.round(source[at]! * scale));
      out[to * 4 + 3] = a;
    }
  }
  return out;
}
