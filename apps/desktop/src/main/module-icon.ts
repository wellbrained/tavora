import { readFile, stat } from "node:fs/promises";
import { resolveAsset } from "./assets";

/** Largest icon file the host reads; a module icon is a small picture. */
export const MAX_MODULE_ICON = 256 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG or WebP as a data address, or null when the bytes are neither or too large. */
export function iconDataUrl(bytes: Buffer): string | null {
  if (bytes.length > MAX_MODULE_ICON || bytes.length < 12) return null;
  if (bytes.subarray(0, PNG.length).equals(PNG)) return `data:image/png;base64,${bytes.toString("base64")}`;
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return `data:image/webp;base64,${bytes.toString("base64")}`;
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
