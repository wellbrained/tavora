import { readFile, stat } from "node:fs/promises";
import { resolveAsset } from "./assets";

/** Largest icon file the host reads; a module icon is a small picture. */
export const MAX_MODULE_ICON = 256 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Widest and tallest picture the host shows from a module or the catalog, in pixels: the catalog's limit for screenshots. */
export const MAX_PICTURE_PIXELS = 4096;

/** A PNG or WebP as a data address, or null when the bytes are neither or too large. */
export function iconDataUrl(bytes: Buffer): string | null {
  return pictureDataUrl(bytes, MAX_MODULE_ICON);
}

/**
 * A PNG or WebP of at most `maxBytes` and `maxPixels` wide and tall as a data address, judged by its header (an icon, a
 * catalog screenshot), or null. The size is read from the header (audit run 7): a few bytes can say a picture of 16383 x
 * 16383, which the page would then try to hold.
 */
export function pictureDataUrl(bytes: Buffer, maxBytes: number, maxPixels = MAX_PICTURE_PIXELS): string | null {
  if (bytes.length > maxBytes) return null;
  const picture = pictureSize(bytes);
  if (!picture || picture.width > maxPixels || picture.height > maxPixels) return null;
  return `data:image/${picture.type};base64,${bytes.toString("base64")}`;
}

/** A PNG's or WebP's kind and size by its header (the canvas for an extended WebP), or null. Nothing is decoded. */
export function pictureSize(bytes: Buffer): { type: "png" | "webp"; width: number; height: number } | null {
  const sized = (type: "png" | "webp", width: number, height: number) => (width > 0 && height > 0 ? { type, width, height } : null);
  if (bytes.length >= 24 && bytes.subarray(0, PNG.length).equals(PNG)) {
    return bytes.toString("latin1", 12, 16) === "IHDR" ? sized("png", bytes.readUInt32BE(16), bytes.readUInt32BE(20)) : null;
  }
  if (bytes.length < 25 || bytes.toString("latin1", 0, 4) !== "RIFF" || bytes.toString("latin1", 8, 12) !== "WEBP") return null;
  const kind = bytes.toString("latin1", 12, 16);
  // VP8L: a signature byte, then 14 bits each of width and height, less one.
  if (kind === "VP8L" && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return sized("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  // VP8: a frame tag, the start code, then 14 bits each of width and height.
  if (bytes.length < 30) return null;
  if (kind === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return sized("webp", bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
  // VP8X: flags and reserved bytes, then the canvas, 24 bits each, less one.
  if (kind === "VP8X") return sized("webp", bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
  return null;
}

/**
 * A module's manifest icon as a data address for the host UI, or null when
 * there is none or the file is not a small PNG or WebP. The path is the
 * manifest's own; it is resolved inside the package like any asset.
 */
export async function moduleIconUrl(root: string, icon: string | undefined): Promise<string | null> {
  if (icon === undefined) return null;
  try {
    const file = await resolveAsset(root, `/${icon}`);
    if (!file || (await stat(file)).size > MAX_MODULE_ICON) return null;
    return iconDataUrl(await readFile(file));
  } catch {
    return null;
  }
}
