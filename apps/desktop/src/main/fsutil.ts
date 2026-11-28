import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rm, stat, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { renameHeld } from "./rename-held";

/**
 * Whether an opened file is the one at `file` now, not followed through a link: its handle's volume and file id match
 * an lstat of the path. Closes the gap between checking a path and opening it (audit L9): a link or file swapped in
 * between gives other ids (or a link's own), so the read is refused. A file system that gives no file id (0) can't be
 * compared this way and passes; the other checks still hold for it.
 */
export async function openedFileIs(handle: FileHandle, file: string): Promise<boolean> {
  const [opened, there] = await Promise.all([handle.stat({ bigint: true }), lstat(file, { bigint: true }).catch(() => null)]);
  if (!there || there.isSymbolicLink()) return false;
  if (opened.ino === 0n || there.ino === 0n) return opened.dev === there.dev;
  return opened.dev === there.dev && opened.ino === there.ino;
}

/** Whether the path can be looked at; any error, a missing path or one that can't be read, counts as no. */
export async function pathExists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  );
}

/** The temp file writeFileAtomic writes first, `<file>.<12 hex>.tmp`, or a write at quit, `<file>.now` (saved-file.ts). */
const TEMP_NAME = /^(.+)(?:\.[0-9a-f]{12}\.tmp|\.now)$/;

/**
 * Writes to a temp file, flushes it to the disk and renames it over the target, so readers never see half a file and a
 * power cut leaves the old file or the new one, never an empty one. Each write has a temp file of its own, so two
 * writes of the same file at once can't move each other's half-written one into place. A temp a crash left behind is
 * removed by sweepWriteLeftovers at the next start.
 */
export async function writeFileAtomic(file: string, body: string | Uint8Array, mode?: number): Promise<void> {
  await writeFileUnlessReplaced(file, body, () => true, mode);
}

/**
 * writeFileAtomic, putting the new file in place only while `stillWanted` says yes (it is asked right before, so a
 * newer write that took its place meanwhile wins). Answers whether the file was written.
 */
export async function writeFileUnlessReplaced(file: string, body: string | Uint8Array, stillWanted: () => boolean, mode?: number): Promise<boolean> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const handle = await open(temp, "wx", mode);
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
 * Removes the temp files an earlier write of `file` left next to it (a crash between the temp and the rename), once they
 * are old enough that no write still owns them. For a file in a folder the user chose, where no start-up sweep looks.
 * Never throws.
 */
export async function sweepTempsNextTo(file: string, clock: () => number = Date.now): Promise<void> {
  const dir = path.dirname(file);
  const name = path.basename(file);
  try {
    for (const entry of await readdir(dir)) {
      if (!entry.startsWith(`${name}.`) || !/^\.[0-9a-f]{12}\.tmp$/.test(entry.slice(name.length))) continue;
      const full = path.join(dir, entry);
      const info = await lstat(full).catch(() => null);
      if (info?.isFile() && clock() - info.mtimeMs > LEFTOVER_TEMP_AGE_MS) await rm(full, { force: true });
    }
  } catch {
    // Best effort.
  }
}

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
 * `<file>.now` of a write at quit, saved-file.ts) more than an hour old by the clock as each is looked at (a temp dated
 * in the future stays), and only next to their file: then that file is whole (the old content or the new), so nothing
 * is lost. A temp whose file is missing stays, as it may be the only copy. Links are never followed or removed.
 * Answers what it removed.
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

/** Pending jobs of queues made with `settleAtQuit` (see `settleSerial`). */
const running = new Set<Promise<unknown>>();

/**
 * Runs tasks one at a time, in the order asked, each after the one before. A failed task does not block later ones,
 * and its caller still gets the rejection.
 *
 * `settleAtQuit: true` is for files a sign-out or a quit must not overtake (the account and Discord stores): the
 * queue's pending jobs are then waited for by `settleSerial()`, which Host.flush calls at quit. Off by default, so a
 * queue that is not meant to hold up a quit (documents, blobs, storage) never does.
 *
 * Not used here, on purpose: inserted-css.ts (its queue is also its return value) and saved-file.ts (one line per
 * file, with a slow-turn warning).
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: { settleAtQuit?: boolean } = {}) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.tail = settled;
    if (this.options.settleAtQuit) {
      running.add(settled);
      void settled.then(() => running.delete(settled));
    }
    return result;
  }
}

/** Resolves once every job of the `settleAtQuit` queues asked so far is done (quitting waits for it). */
export async function settleSerial(): Promise<void> {
  while (running.size > 0) await Promise.all([...running]);
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
