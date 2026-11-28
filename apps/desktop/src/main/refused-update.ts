import path from "node:path";
import { rmSync } from "node:fs";

/**
 * A refused installer is deleted, and so is the blockmap electron-updater kept from it (in its pending folder and
 * the cache folder above), so the next download doesn't plan against the refused file. Done at once, so it also works
 * for one refused while Tavora quits. Packaged builds only.
 */
export function removeRefusedInstaller(info: { downloadedFile?: unknown }, packaged: boolean, remove: typeof rmSync = rmSync): void {
  if (!packaged || typeof info.downloadedFile !== "string") return;
  const pending = path.dirname(info.downloadedFile);
  for (const file of [info.downloadedFile, path.join(pending, "current.blockmap"), path.join(path.dirname(pending), "current.blockmap")]) {
    try {
      remove(file, { force: true });
    } catch {
      // In use: the updater checks its saved file again before it uses it.
    }
  }
}
