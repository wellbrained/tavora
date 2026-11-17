import path from "node:path";
import { rm } from "node:fs/promises";

/**
 * A refused installer is deleted, and so is the blockmap electron-updater kept from it (in its pending folder and
 * the cache folder above), so the next download doesn't plan against the refused file. Packaged builds only.
 */
export function removeRefusedInstaller(info: { downloadedFile?: unknown }, packaged: boolean, remove: typeof rm = rm): void {
  if (!packaged || typeof info.downloadedFile !== "string") return;
  const pending = path.dirname(info.downloadedFile);
  for (const file of [info.downloadedFile, path.join(pending, "current.blockmap"), path.join(path.dirname(pending), "current.blockmap")]) {
    void remove(file, { force: true }).catch(() => undefined);
  }
}
