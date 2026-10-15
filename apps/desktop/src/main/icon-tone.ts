import { statSync } from "node:fs";
import path from "node:path";
import { toneOfBitmap, type IconTone } from "../shared/icon-tone";

/** The picture of a file as a small bitmap (see toneOfBitmap), or null when it cannot be read. */
export type LoadBitmap = (file: string) => Uint8Array | null;

/**
 * Works out how each saved game icon sits in its tile, once per file and version of the file.
 * An icon that cannot be read gets the plain dark backdrop.
 */
export function createToneReader(iconDir: string, load: LoadBitmap) {
  const cache = new Map<string, IconTone>();
  return (file: string): IconTone => {
    const full = path.join(iconDir, file);
    let version = "";
    try {
      version = String(statSync(full).mtimeMs);
    } catch {
      return "onDark";
    }
    const key = `${file}:${version}`;
    const known = cache.get(key);
    if (known) return known;
    let tone: IconTone = "onDark";
    try {
      const bitmap = load(full);
      if (bitmap) tone = toneOfBitmap(bitmap);
    } catch {
      // Keep the plain backdrop.
    }
    cache.set(key, tone);
    return tone;
  };
}

/** The version of a saved icon file, to put in its address so a changed file is not shown from the old picture. */
export function iconVersion(iconDir: string, file: string): string {
  try {
    return String(Math.round(statSync(path.join(iconDir, file)).mtimeMs));
  } catch {
    return "0";
  }
}
