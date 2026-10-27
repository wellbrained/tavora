// Getting a picture ready to be stored: telling what the user picked, and for the Optimized
// quality shrinking it. Original keeps the file exactly as it is.

import { BLOB_TYPES } from "@tavora/sdk";

/** The kinds of picture the host stores (it checks the file itself again). */
export const ACCEPTED_TYPES = BLOB_TYPES;
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(",");

/** Optimized: the longest side is at most this many pixels, saved as WebP at this quality. */
export const OPTIMIZED_MAX_SIDE = 1600;
export const OPTIMIZED_QUALITY = 0.8;

export type ImageQuality = "optimized" | "original";

export function isAcceptedType(type: string): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(type);
}

/** The size to draw at so the longest side is at most `max`; never larger than the original. */
export function fitSize(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The file to store for a picture under the chosen quality. Original, and any GIF (an animated one
 * would stop moving), are stored as they are. Optimized shrinks big PNG, JPEG and WebP pictures and
 * saves them as WebP, but keeps the original when that would not be smaller.
 */
export async function prepareImage(file: File, quality: ImageQuality): Promise<Blob> {
  if (quality === "original" || file.type === "image/gif") return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const size = fitSize(bitmap.width, bitmap.height, OPTIMIZED_MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const webp = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", OPTIMIZED_QUALITY));
    const shrunk = size.width !== bitmap.width || size.height !== bitmap.height;
    return webp && webp.type === "image/webp" && (shrunk || webp.size < file.size) ? webp : file;
  } finally {
    bitmap.close();
  }
}
