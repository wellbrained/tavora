import { statSync } from "node:fs";
import path from "node:path";
import { toneOfBitmap, type IconTone } from "../shared/icon-tone";

/** The picture of a file as a small bitmap (see toneOfBitmap), or null when it cannot be read. */
export type LoadBitmap = (file: string) => Uint8Array | null;

/** The version of an icon file that isn't there. */
const MISSING = "0";

/**
 * Works out how each saved game icon sits in its tile, once per file and version of the file.
 * An icon that cannot be read gets the plain dark backdrop.
 */
export function createToneReader(iconDir: string, load: LoadBitmap) {
  const cache = new Map<string, IconTone>();
  /** `known`: the file's version when the caller has it (iconVersions), so the disk isn't asked again; "0" is no file. */
  return (file: string, known?: string): IconTone => {
    const full = path.join(iconDir, file);
    let version = known ?? "";
    if (known === MISSING) return "onDark";
    if (known === undefined) {
      try {
        version = String(statSync(full).mtimeMs);
      } catch {
        return "onDark";
      }
    }
    const key = `${file}:${version}`;
    const cached = cache.get(key);
    if (cached) return cached;
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
    return MISSING;
  }
}

/** How long a saved icon's version is trusted before the disk is asked again. */
export const ICON_VERSION_MS = 5_000;

/**
 * The versions of the saved icons for the state the host window gets. It is sent very often and a library can hold
 * hundreds of games, so each file is looked up at most once per ICON_VERSION_MS. `forget` is for when icons were just written.
 */
export function iconVersions(iconDir: string, now: () => number = Date.now) {
  const known = new Map<string, { version: string; at: number }>();
  return {
    of(file: string): string {
      const at = now();
      const seen = known.get(file);
      if (seen && at - seen.at < ICON_VERSION_MS) return seen.version;
      const version = iconVersion(iconDir, file);
      known.set(file, { version, at });
      return version;
    },
    forget(): void {
      known.clear();
    },
  };
}
