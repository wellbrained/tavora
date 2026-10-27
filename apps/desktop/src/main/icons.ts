import { randomBytes } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./fsutil";
import { PlayerError } from "./messages";

export const MAX_ICON_BYTES = 2 * 1024 * 1024;

/** Recognises PNG, JPEG and WebP by their first bytes, whatever the file is called. */
export function imageType(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  const starts = (...sig: number[]) => sig.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (starts(0xff, 0xd8, 0xff)) return "jpg";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "webp";
  }
  return null;
}

export class IconError extends PlayerError {}

/** Copies a picked image into the icon folder. Returns the new file name. */
export async function importIcon(iconDir: string, workspaceId: string, source: string): Promise<string> {
  const info = await stat(source);
  if (!info.isFile()) throw new IconError("error.notFile");
  if (info.size > MAX_ICON_BYTES) throw new IconError("error.iconTooBig");
  const bytes = await readFile(source);
  const type = imageType(bytes);
  if (!type) throw new IconError("picture.type");
  const file = `${workspaceId}-${randomBytes(4).toString("hex")}.${type}`;
  await writeFileAtomic(path.join(iconDir, file), bytes);
  return file;
}

export async function removeIcon(iconDir: string, file: string): Promise<void> {
  await rm(path.join(iconDir, path.basename(file)), { force: true });
}
