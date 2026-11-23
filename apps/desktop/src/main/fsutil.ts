import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { renameHeld } from "./rename-held";

/** The temp file writeFileAtomic writes first, `<file>.<12 hex>.tmp`, or a write at quit, `<file>.now` (saved-file.ts). */
const TEMP_NAME = /^(.+)(?:\.[0-9a-f]{12}\.tmp|\.now)$/;

/**
 * Writes to a temp file, flushes it to the disk and renames it over the target, so readers never see half a file and a
 * power cut leaves the old file or the new one, never an empty one. Each write has a temp file of its own, so two
 * writes of the same file at once can't move each other's half-written one into place. A temp a crash left behind is
 * removed by sweepWriteLeftovers at the next start.
 */
export async function writeFileAtomic(file: string, body: string | Uint8Array): Promise<void> {
  await writeFileUnlessReplaced(file, body, () => true);
}

/**
 * writeFileAtomic, putting the new file in place only while `stillWanted` says yes (it is asked right before, so a
 * newer write that took its place meanwhile wins). Answers whether the file was written.
 */
export async function writeFileUnlessReplaced(file: string, body: string | Uint8Array, stillWanted: () => boolean): Promise<boolean> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (await renameHeld(temp, file, undefined, stillWanted)) return true;
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  await rm(temp, { force: true }).catch(() => undefined);
  return false;
}

/** How old a temp must be to count as left over: a write takes moments, so no running write still owns one this old. */
export const LEFTOVER_TEMP_AGE_MS = 60 * 60 * 1000;
/**
 * The folders in the data folder that hold Tavora's own saved data, written with writeFileAtomic: module storage and
 * documents, panel state, game and Steam icons, the profile picture, the pictures of overlay layouts, the files a
 * module was allowed to read, backups. Only these are swept (and the files at the top of the data folder); a folder
 * added later is left alone until it is named here. Never module code, installs in progress, the files the user saves
 * from modules, or Chromium's own folders.
 */
const SWEPT_FOLDERS = new Set(["module-data", "panel-state", "game-icons", "steam-icons", "profile", "overlay-pictures", "read-only-files", "backups"]);
const SWEEP_DEPTH = 8;

/**
 * Removes the temps writeFileAtomic left when Tavora was stopped in the middle of a write, at a start. Only in the data
 * folder (never the cloud copy's folder, where another PC may be writing), only `<file>.<12 hex>.tmp` files (and the
 * `<file>.now` of a write at quit, saved-file.ts) more than an hour old by the clock as each is looked at (a temp dated in the future stays), and only next to their file: then that
 * file is whole (the old content or the new), so nothing is lost. A temp whose file is missing stays, as it may be the
 * only copy. Links are never followed or removed. Answers what it removed.
 */
export async function sweepWriteLeftovers(userData: string, clock: () => number = Date.now): Promise<string[]> {
  const removed: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const swept = depth > 0 || SWEPT_FOLDERS.has(entry.name);
        if (swept && depth < SWEEP_DEPTH) await walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      const target = entry.isFile() ? TEMP_NAME.exec(entry.name)?.[1] : undefined;
      if (target === undefined || !files.has(target)) continue;
      const temp = path.join(dir, entry.name);
      try {
        const info = await lstat(temp);
        const age = clock() - info.mtimeMs;
        if (!info.isFile() || age < LEFTOVER_TEMP_AGE_MS) continue;
        await rm(temp);
        removed.push(temp);
      } catch {
        // Gone already, or held: the next start tries again.
      }
    }
  };
  await walk(userData, 0);
  return removed;
}

/** Runs tasks one at a time, in order. A failed task does not block later ones. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/**
 * Copies a file's old content into a backup folder, and answers with the copy's path. A copy an earlier start made
 * stays; a different one gets a new name.
 */
export async function keepCopy(dir: string, name: string, old: Buffer): Promise<string> {
  return (await keepCopyAt(dir, name, old)).target;
}

/** keepCopy, also saying whether it wrote a new copy (false: the same bytes were kept already). */
export async function keepCopyAt(dir: string, name: string, old: Buffer): Promise<{ target: string; wrote: boolean }> {
  for (let n = 1; ; n++) {
    const target = path.join(dir, n === 1 ? name : `${name}.${n}`);
    // Only a missing name is free: any other error throws, so no copy is ever written over.
    const existing = await stat(target).then(
      () => readFile(target),
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if (existing?.equals(old)) return { target, wrote: false };
    if (existing === null) {
      await writeFileAtomic(target, old);
      return { target, wrote: true };
    }
  }
}
