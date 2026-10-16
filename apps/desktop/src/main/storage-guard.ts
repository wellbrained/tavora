import { readdir, stat } from "node:fs/promises";
import path from "node:path";

// A module's own browser storage (IndexedDB, the origin-private file system,
// local storage) lives in its session's folder and Chromium lets it grow to a
// large share of the disk. The bridge's storage has quotas; this is the
// matching limit for the rest, so a module cannot fill the player's disk.
// Chromium offers no per-origin quota to set, so the host measures the folder
// while the panel is open and clears it when it grows past the limit. A module
// can write for up to one check interval before it is stopped.

/** How much a module may keep in its browser storage, per game. */
export const MODULE_STORAGE_LIMIT = 256 * 1024 * 1024;
/** How often an open module's storage is measured. */
export const STORAGE_CHECK_MS = 1_000;
/** More files than this counts as over the limit, however small: each costs the player's disk and our time to measure. */
export const MAX_STORAGE_FILES = 5_000;

export interface FolderUsage {
  bytes: number;
  files: number;
  /** The walk stopped at MAX_STORAGE_FILES. */
  truncated: boolean;
}

/** The size of everything under `dir`. A missing folder is empty; links are not followed. */
export async function folderUsage(dir: string, maxFiles = MAX_STORAGE_FILES): Promise<FolderUsage> {
  const usage: FolderUsage = { bytes: 0, files: 0, truncated: false };
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (usage.files >= maxFiles) {
        usage.truncated = true;
        return;
      }
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        if (usage.truncated) return;
      } else if (entry.isFile()) {
        usage.files++;
        usage.bytes += (await stat(file).catch(() => ({ size: 0 }))).size;
      }
    }
  };
  await walk(dir);
  return usage;
}

/** Whether a folder's contents are more than a module may keep. */
export async function overStorageLimit(dir: string, limit = MODULE_STORAGE_LIMIT): Promise<boolean> {
  const usage = await folderUsage(dir);
  return usage.truncated || usage.bytes > limit;
}
