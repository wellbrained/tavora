import { crc32, deflateSync, inflateSync } from "node:zlib";

/**
 * Just enough PNG and ICO handling for game icons: check that a file really is
 * a small PNG, and turn an .ico into a PNG without changing a pixel. Nothing
 * here runs, decodes images for display or trusts a header further than it is
 * checked.
 */

export const MAX_ICON_PIXELS = 256;
export const MAX_ICON_BYTES = 200 * 1024;

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export interface PngInfo {
  width: number;
  height: number;
}

/**
 * The size of a PNG, or null unless the file is a well-formed PNG within the
 * icon limits: signature, a first IHDR chunk, every chunk's checksum right,
 * data present, and an IEND chunk at the very end.
 */
/** `maxBytes` and `maxPixels` are the icon limits unless a caller (a profile picture, a screenshot) allows more. */
export function inspectPng(bytes: Uint8Array, maxBytes = MAX_ICON_BYTES, maxPixels = MAX_ICON_PIXELS): PngInfo | null {
  if (bytes.byteLength < 45 || bytes.byteLength > maxBytes) return null;
  if (!SIGNATURE.every((byte, i) => bytes[i] === byte)) return null;
  const v = view(bytes);
  let at = 8;
  let info: PngInfo | null = null;
  let sawData = false;
  for (let first = true; at + 12 <= bytes.byteLength; first = false) {
    const length = v.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const end = at + 12 + length;
    if (length > bytes.byteLength || end > bytes.byteLength) return null;
    if (v.getUint32(end - 4) !== crc32(bytes.subarray(at + 4, end - 4))) return null;
    if (first) {
      if (type !== "IHDR" || length !== 13) return null;
      const width = v.getUint32(at + 8);
      const height = v.getUint32(at + 12);
      if (width < 1 || height < 1 || width > maxPixels || height > maxPixels) return null;
      info = { width, height };
    } else if (type === "IDAT") {
      sawData = true;
    } else if (type === "IEND") {
      return end === bytes.byteLength && length === 0 && sawData ? info : null;
    }
    at = end;
  }
  return null;
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.byteLength);
  const v = view(out);
  v.setUint32(0, data.byteLength);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.byteLength, crc32(out.subarray(4, 8 + data.byteLength)));
  return out;
};

const KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);

/**
 * A PNG with only the chunks that make the picture (header, palette,
 * transparency, image data, end), so text, metadata and anything hidden in
 * other chunks is gone and not one pixel changes. Null when the file is not a
 * well-formed small PNG.
 */
export function stripPng(bytes: Uint8Array, maxBytes = MAX_ICON_BYTES): Uint8Array | null {
  if (!inspectPng(bytes, maxBytes)) return null;
  const v = view(bytes);
  const kept: Uint8Array[] = [SIGNATURE];
  for (let at = 8; at < bytes.byteLength; ) {
    const length = v.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    if (KEEP.has(type)) kept.push(bytes.subarray(at, at + 12 + length));
    at += 12 + length;
  }
  const out = new Uint8Array(kept.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of kept) {
    out.set(part, at);
    at += part.byteLength;
  }
  return inspectPng(out) ? out : null;
}

/**
 * Whether a file is a well-formed WebP by its RIFF header: the RIFF size matches the file, it says WEBP,
 * and its first chunk is one of the three image kinds and fits. Nothing is decoded.
 */
export function isWebp(bytes: Uint8Array, maxBytes: number): boolean {
  if (bytes.byteLength < 20 || bytes.byteLength > maxBytes) return false;
  const text = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (text(0, 4) !== "RIFF" || text(8, 12) !== "WEBP") return false;
  const v = view(bytes);
  if (v.getUint32(4, true) + 8 !== bytes.byteLength) return false;
  return ["VP8 ", "VP8L", "VP8X"].includes(text(12, 16)) && 20 + v.getUint32(16, true) <= bytes.byteLength;
}

/** An 8-bit RGBA PNG from top-down rows of pixels. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const header = new Uint8Array(13);
  view(header).setUint32(0, width);
  view(header).setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const parts = [SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/** Decodes the pixels of a PNG made by `encodePng`; used by tests and by nothing that handles uploads. */
export function decodeRgbaPng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  const info = inspectPng(bytes);
  if (!info || bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) return null;
  const v = view(bytes);
  const data: Uint8Array[] = [];
  for (let at = 8; at < bytes.byteLength; ) {
    const length = v.getUint32(at);
    if (String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!) === "IDAT") data.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = 1 + info.width * 4;
  const rgba = new Uint8Array(info.width * info.height * 4);
  for (let y = 0; y < info.height; y += 1) {
    if (raw[y * stride] !== 0) return null;
    rgba.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * info.width * 4);
  }
  return { width: info.width, height: info.height, rgba };
}

interface IcoFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

function icoFrames(ico: Uint8Array): IcoFrame[] {
  if (ico.byteLength < 22 || ico.byteLength > 4 * 1024 * 1024) return [];
  const v = view(ico);
  if (v.getUint16(0, true) !== 0 || v.getUint16(2, true) !== 1) return [];
  const count = v.getUint16(4, true);
  if (count < 1 || count > 64 || 6 + count * 16 > ico.byteLength) return [];
  const frames: IcoFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16;
    const size = v.getUint32(at + 8, true);
    const offset = v.getUint32(at + 12, true);
    if (size === 0 || offset < 6 + count * 16 || offset + size > ico.byteLength) continue;
    frames.push({ width: ico[at]! || 256, height: ico[at + 1]! || 256, data: ico.subarray(offset, offset + size) });
  }
  return frames;
}

/** A legacy bitmap frame (32 or 24 bits per pixel, with its transparency mask) as RGBA rows, top-down. */
function decodeDib(data: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (data.byteLength < 40) return null;
  const v = view(data);
  const headerSize = v.getUint32(0, true);
  const width = v.getInt32(4, true);
  const doubled = v.getInt32(8, true);
  const planes = v.getUint16(12, true);
  const bits = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  const height = doubled / 2;
  if (headerSize !== 40 || planes !== 1 || compression !== 0 || (bits !== 32 && bits !== 24)) return null;
  if (width < 1 || width > MAX_ICON_PIXELS || !Number.isInteger(height) || height < 1 || height > MAX_ICON_PIXELS) return null;
  const colorStride = Math.ceil((width * bits) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  if (headerSize + colorStride * height + maskStride * height > data.byteLength) return null;
  const color = headerSize;
  const mask = color + colorStride * height;
  const rgba = new Uint8Array(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const source = color + (height - 1 - y) * colorStride;
    for (let x = 0; x < width; x += 1) {
      const from = source + x * (bits / 8);
      const to = (y * width + x) * 4;
      rgba[to] = data[from + 2]!;
      rgba[to + 1] = data[from + 1]!;
      rgba[to + 2] = data[from]!;
      rgba[to + 3] = bits === 32 ? data[from + 3]! : 255;
      if (bits === 32 && data[from + 3] !== 0) anyAlpha = true;
    }
  }
  // Without real alpha (24 bit, or a 32 bit frame whose alpha is all zero) the mask decides what is see-through.
  if (!anyAlpha) {
    for (let y = 0; y < height; y += 1) {
      const row = mask + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x += 1) {
        const transparent = (data[row + (x >> 3)]! >> (7 - (x & 7))) & 1;
        rgba[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  }
  return { width, height, rgba };
}

/**
 * The biggest frame of an .ico as a PNG: a frame that already is a PNG is
 * returned as it is, a bitmap frame is re-wrapped losslessly. Null when there
 * is no frame within the icon limits that can be read.
 */
export function icoToPng(ico: Uint8Array): Uint8Array | null {
  const frames = icoFrames(ico)
    .filter((frame) => frame.width <= MAX_ICON_PIXELS && frame.height <= MAX_ICON_PIXELS)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  for (const frame of frames) {
    if (SIGNATURE.every((byte, i) => frame.data[i] === byte)) {
      if (inspectPng(frame.data)) return frame.data.slice();
      continue;
    }
    const bitmap = decodeDib(frame.data);
    if (bitmap) {
      const png = encodePng(bitmap.width, bitmap.height, bitmap.rgba);
      if (png.byteLength <= MAX_ICON_BYTES) return png;
    }
  }
  return null;
}
