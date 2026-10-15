import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

/**
 * The file versions this Tavora understands (the "version" inside each file). A test keeps these
 * equal to what the code writes; raise one when its format changes in a way an older Tavora could misread.
 */
export const SUPPORTED_VERSIONS = { "library.json": 1, "workspace.json": 2, "profile.json": 1 } as const;

/** How many daily snapshots are kept. */
export const BACKUP_KEEP = 7;
/** A snapshot bigger than this leaves out the pictures (they can be fetched or picked again). */
export const BACKUP_MAX_BYTES = 300 * 1024 * 1024;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The player's own data: games and layout, profile, and every module's settings and documents. */
const DATA_FILES = ["library.json", "workspace.json", "profile.json"];
const DATA_DIRS = ["module-data"];
/** Pictures: the player's own images and profile picture. */
const PICTURE_DIRS = ["game-icons", "profile"];

export function backupsDir(userData: string): string {
  return path.join(userData, "backups");
}

/** Local date as YYYY-MM-DD, the name of a day's snapshot. */
export function dayName(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

async function sizeOf(target: string): Promise<number> {
  let info;
  try {
    info = await stat(target);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(target)) total += await sizeOf(path.join(target, name));
  return total;
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export interface BackupOptions {
  userData: string;
  now?: Date;
  keep?: number;
  maxBytes?: number;
  log?: (line: string) => void;
}

export type BackupResult =
  | { status: "made"; dir: string; withPictures: boolean }
  | { status: "exists"; dir: string }
  | { status: "nothing" }
  | { status: "too-big" };

/**
 * Copies the player's data into backups/<today>, once a day, and keeps the
 * newest few days. The snapshot is built in a `.partial` folder and renamed
 * when complete, so a crash never leaves a half snapshot that looks whole.
 * Nothing is read through the app's own code, so a bug there cannot spoil it.
 */
export async function backupData(options: BackupOptions): Promise<BackupResult> {
  const { userData } = options;
  const log = options.log ?? (() => {});
  const root = backupsDir(userData);
  const day = dayName(options.now ?? new Date());
  const target = path.join(root, day);

  if (!(await exists(path.join(userData, "library.json")))) return { status: "nothing" };
  if (await exists(target)) return { status: "exists", dir: target };

  let dirs = [...DATA_DIRS, ...PICTURE_DIRS];
  let total = 0;
  for (const name of [...DATA_FILES, ...dirs]) total += await sizeOf(path.join(userData, name));
  const maxBytes = options.maxBytes ?? BACKUP_MAX_BYTES;
  let withPictures = true;
  if (total > maxBytes) {
    dirs = [...DATA_DIRS];
    withPictures = false;
    total = 0;
    for (const name of [...DATA_FILES, ...dirs]) total += await sizeOf(path.join(userData, name));
    if (total > maxBytes) {
      log(`backup skipped: the data is ${Math.round(total / 1024 / 1024)} MB`);
      return { status: "too-big" };
    }
  }

  const partial = `${target}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    for (const name of DATA_FILES) {
      if (await exists(path.join(userData, name))) await copyFile(path.join(userData, name), path.join(partial, name));
    }
    for (const name of dirs) {
      const from = path.join(userData, name);
      // Temp files of a write in progress are not part of the data.
      if (await exists(from)) await cp(from, path.join(partial, name), { recursive: true, filter: (source) => !source.endsWith(".tmp") });
    }
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }

  await pruneBackups(root, options.keep ?? BACKUP_KEEP);
  log(`backup ${day} made${withPictures ? "" : " (without pictures)"}`);
  return { status: "made", dir: target, withPictures };
}

/** Deletes snapshots older than the newest `keep`, and leftovers of an interrupted one. */
export async function pruneBackups(root: string, keep: number): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const removed: string[] = [];
  const days = names.filter((name) => DAY.test(name)).sort().reverse();
  for (const name of [...days.slice(keep), ...names.filter((name) => name.endsWith(".partial"))]) {
    await rm(path.join(root, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/**
 * A file written by a newer Tavora (its `version` is above what this one
 * understands) is copied aside before this version can overwrite it, so
 * going back to an older Tavora never loses what the newer one saved.
 * Returns the copy's path, or null when nothing was needed.
 */
export async function keepNewerFile(file: string, supportedVersion: number): Promise<string | null> {
  let version: unknown;
  try {
    version = (JSON.parse(await readFile(file, "utf8")) as { version?: unknown } | null)?.version;
  } catch {
    return null; // missing or unreadable files are handled where they are read
  }
  if (typeof version !== "number" || !(version > supportedVersion)) return null;
  const copy = `${file}.from-version-${version}`;
  if (!(await exists(copy))) await copyFile(file, copy);
  return copy;
}
