import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inspectPng } from "./png.ts";

/**
 * The game icons the service hosts: small PNG files in one folder, listed in
 * `index.json` next to them. They are the games' own icons (logos only, never
 * covers or artwork), kept unchanged, and served together with a notice that
 * Tavora is not affiliated with the publishers. A publisher's request to
 * remove one is met by deleting its entry and its file.
 */

/** Sent with every list of icons, and shown by the app wherever it shows them. */
export const ICON_NOTICE =
  "Game names and icons belong to their publishers and are trademarks of their owners. Tavora is not affiliated with, endorsed by or sponsored by them. Icons are used only to identify the games, kept unchanged, and never sold. Publishers can ask for an icon to be removed at the address given and it is removed.";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_ICONS = 5000;
const MAX_NAMES = 8;
const MAX_NAME = 120;

export interface IconEntry {
  /** The game's canonical id (it names the file: `<id>.png`). */
  id: string;
  /** Every name the game is known by, so the app can match a game it added by name. */
  names: string[];
  sha256: string;
  size: number;
}

export interface IconStore {
  list(): IconEntry[];
  /** The bytes of a hosted icon, or null. */
  file(id: string): Uint8Array | null;
}

export const NO_ICONS: IconStore = { list: () => [], file: () => null };

export function isIconId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

/**
 * Reads the icon folder once. An entry that is broken, whose file is missing,
 * is not a small well-formed PNG or whose hash differs from the recorded one is
 * left out and reported, so a damaged folder never serves a wrong file.
 */
export function loadIconStore(dir: string, warn: (message: string) => void = () => undefined): IconStore {
  const indexFile = path.join(dir, "index.json");
  if (!existsSync(indexFile)) return NO_ICONS;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(indexFile, "utf8"));
  } catch {
    warn("icons/index.json cannot be read; no icons are served");
    return NO_ICONS;
  }
  const items = (raw as { icons?: unknown } | null)?.icons;
  if (!Array.isArray(items)) {
    warn("icons/index.json has no icons list; no icons are served");
    return NO_ICONS;
  }

  const entries = new Map<string, IconEntry>();
  const files = new Map<string, Uint8Array>();
  for (const item of items.slice(0, MAX_ICONS)) {
    const { id, names, sha256 } = (item ?? {}) as Record<string, unknown>;
    if (!isIconId(id) || entries.has(id)) {
      warn(`icons: skipped an entry with a bad or repeated id`);
      continue;
    }
    const cleanNames = Array.isArray(names)
      ? names.filter((name): name is string => typeof name === "string" && name.trim().length > 0 && name.length <= MAX_NAME).map((name) => name.trim())
      : [];
    if (cleanNames.length === 0 || cleanNames.length > MAX_NAMES || typeof sha256 !== "string" || !SHA256.test(sha256)) {
      warn(`icons: skipped ${id}: names or sha256 missing`);
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(path.join(dir, `${id}.png`)));
    } catch {
      warn(`icons: skipped ${id}: file missing`);
      continue;
    }
    if (!inspectPng(bytes)) {
      warn(`icons: skipped ${id}: not a small well-formed PNG`);
      continue;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
      warn(`icons: skipped ${id}: file does not match its recorded hash`);
      continue;
    }
    entries.set(id, { id, names: cleanNames, sha256, size: bytes.byteLength });
    files.set(id, bytes);
  }
  return { list: () => [...entries.values()], file: (id) => files.get(id) ?? null };
}
