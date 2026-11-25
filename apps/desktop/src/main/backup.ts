import { randomBytes } from "node:crypto";
import { copyFile, cp, lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isOwnerId } from "@tavora/module-schema";
import { pathExists } from "./fsutil";
import { FILES_DIR } from "./module-files";
import { DATA_FILES, hasLibrary } from "./saved-data";
import { SWEEP_HOLD_FILE } from "./module-data";

/** How many daily snapshots are kept. */
export const BACKUP_KEEP = 7;
/** A snapshot bigger than this leaves out the pictures (they can be fetched or picked again). */
export const BACKUP_MAX_BYTES = 300 * 1024 * 1024;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** With DATA_FILES (saved-data.ts), the user's own data: every module's settings and documents. */
export const DATA_DIRS = ["module-data"];
/** Pictures: the user's own images and profile picture, and the pictures modules keep (FILES_DIR, wherever its folder is). Left out of a snapshot that would be too big. */
export const PICTURE_DIRS = ["game-icons", "profile", FILES_DIR];

export function backupsDir(userData: string): string {
  return path.join(userData, "backups");
}

/** Local date as YYYY-MM-DD, the name of a day's snapshot. */
export function dayName(now: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * How many bytes `target` holds. A link (a symlink, or a junction on Windows) counts nothing and is never followed,
 * as a snapshot leaves it out: a link back up the tree would otherwise be counted over and over.
 */
async function sizeOf(target: string): Promise<number> {
  let info;
  try {
    info = await lstat(target);
  } catch {
    return 0;
  }
  if (info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(target)) total += await sizeOf(path.join(target, name));
  return total;
}

export interface BackupOptions {
  userData: string;
  /** The folder modules keep pictures in, which may be outside userData; saved in the snapshot as FILES_DIR. */
  moduleFiles?: string;
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
 * Copies the user's data into backups/<today>, once a day, and keeps the
 * newest few days. The snapshot is built in a `.partial` folder and renamed
 * when complete, so a crash never leaves a half snapshot that looks whole.
 * Nothing is read through the app's own code, so a bug there cannot spoil it.
 */
export async function backupData(options: BackupOptions): Promise<BackupResult> {
  const target = path.join(backupsDir(options.userData), dayName(options.now ?? new Date()));
  // A second call for the same day while the first is still copying would build in the same folder and wipe its work.
  if (running.has(target)) return { status: "exists", dir: target };
  running.add(target);
  try {
    return await makeBackup(options, target);
  } finally {
    running.delete(target);
  }
}

/** The snapshots being made right now. */
const running = new Set<string>();

async function makeBackup(options: BackupOptions, target: string): Promise<BackupResult> {
  const { userData } = options;
  const log = options.log ?? (() => {});
  const root = path.dirname(target);
  const day = path.basename(target);

  if (!(await hasLibrary(userData))) return { status: "nothing" };
  if (await pathExists(target)) return { status: "exists", dir: target };

  const source = (name: string) => (name === FILES_DIR && options.moduleFiles ? options.moduleFiles : path.join(userData, name));
  // In a folder the user can reach, like Pictures\Tavora, only the modules' own folders are theirs to back up.
  const parts = async (name: string): Promise<string[]> => {
    if (name !== FILES_DIR) return [""];
    const owners = await readdir(source(name)).catch(() => [] as string[]);
    return owners.filter((owner) => isOwnerId(owner));
  };
  const sizeOfDir = async (name: string) => {
    let size = 0;
    for (const part of await parts(name)) size += await sizeOf(path.join(source(name), part));
    return size;
  };
  let dirs = [...DATA_DIRS, ...PICTURE_DIRS];
  let total = 0;
  for (const name of DATA_FILES) total += await sizeOf(path.join(userData, name));
  for (const name of dirs) total += await sizeOfDir(name);
  const maxBytes = options.maxBytes ?? BACKUP_MAX_BYTES;
  let withPictures = true;
  if (total > maxBytes) {
    dirs = [...DATA_DIRS];
    withPictures = false;
    total = 0;
    for (const name of DATA_FILES) total += await sizeOf(path.join(userData, name));
    for (const name of dirs) total += await sizeOfDir(name);
    if (total > maxBytes) {
      log(`backup skipped: the data is ${Math.round(total / 1024 / 1024)} MB`);
      return { status: "too-big" };
    }
  }

  const partial = `${target}.${randomBytes(4).toString("hex")}.partial`;
  await mkdir(partial, { recursive: true });
  try {
    for (const name of DATA_FILES) {
      if (await pathExists(path.join(userData, name))) await copyFile(path.join(userData, name), path.join(partial, name));
    }
    for (const name of dirs) {
      for (const part of await parts(name)) {
        const from = path.join(source(name), part);
        // Temp files of a write in progress are not part of the data. Nor are links (symlinks, junctions): Tavora
        // makes none, a link back up the tree would loop, and cp would make a junction a symlink, which Windows lets
        // only Developer Mode or an admin make, failing the whole snapshot.
        const keep = async (file: string) => {
          if (file.endsWith(".tmp")) return false;
          const link = await lstat(file).then((info) => info.isSymbolicLink(), () => false);
          if (link) log(`backup leaves out the link ${file}`);
          return !link;
        };
        if (await pathExists(from)) await cp(from, path.join(partial, name, part), { recursive: true, filter: keep });
      }
    }
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { recursive: true, force: true });
    throw error;
  }

  // While a start held storage back for a lost library (sweep-hold.json), the older backups may hold the only good copy:
  // none is pruned until the user's data is back.
  if (!(await pathExists(path.join(userData, SWEEP_HOLD_FILE)))) await pruneBackups(root, options.keep ?? BACKUP_KEEP);
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
