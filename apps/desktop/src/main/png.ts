// A PNG is checked chunk by chunk before it is decoded, so a broken or hostile file is turned away
// before any image code in the main process sees it.

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface PngLimits {
  /** Longest side in pixels. */
  maxSide: number;
  /** Width times height. */
  maxPixels: number;
}

export type PngCheck = { ok: true; width: number; height: number } | { ok: false; reason: string };

/**
 * Whether these bytes are a complete, well-formed PNG: the signature, then chunks that each have a right
 * checksum, starting with the header and ending with the end marker, with picture data in between and the
 * size within the limits. It does not decode anything.
 */
export function checkPng(bytes: Uint8Array, limits: PngLimits): PngCheck {
  const bad = (reason: string): PngCheck => ({ ok: false, reason });
  if (bytes.length < 33 || !SIGNATURE.every((byte, index) => bytes[index] === byte)) return bad("not a PNG file");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawData = false;
  let first = true;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) return bad("a part of the file is cut off");
    if (crc32(bytes, offset + 4, offset + 8 + length) !== view.getUint32(offset + 8 + length)) return bad("a part of the file is damaged");
    if (first) {
      if (type !== "IHDR" || length !== 13) return bad("the file does not start with a PNG header");
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      if (width < 1 || height < 1) return bad("the picture has no size");
      if (width > limits.maxSide || height > limits.maxSide || width * height > limits.maxPixels) return bad("the picture is too large");
      first = false;
    } else if (type === "IDAT") {
      sawData = true;
    } else if (type === "IEND") {
      return sawData && end === bytes.length ? { ok: true, width, height } : bad("the file has no picture data or has extra data at the end");
    }
    offset = end;
  }
  return bad("the file is cut off");
}
