// Moving the folder where modules keep their pictures (see blobs.ts) to another place. The player
// picks the place in a system dialog; everything is copied and checked first, the setting is
// switched next, and only then are the old files removed, so a failure never loses a picture.

import { copyFile, mkdir, readdir, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isGameId, isModuleId } from "@tavora/module-schema";
import { parseBlobFileName } from "./blobs";

/** Inside the place the player picks, the files go into a folder of their own with this name. */
export const FILES_FOLDER_NAME = "Tavora module files";

/** The default files folder's name inside the app's data folder. */
export const FILES_DIR = "module-blobs";

export function defaultFilesRoot(userData: string): string {
  return path.join(userData, FILES_DIR);
}

/** Why a place cannot be used. The host words these for the player. */
export type TargetProblem = "same" | "nested" | "inside-data" | "not-writable";

const sameFolder = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child: string, parent: string) => {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};
const insideOrSame = (child: string, parent: string) => sameFolder(child, parent) || inside(child, parent) || (process.platform === "win32" && inside(child.toLowerCase(), parent.toLowerCase()));

/**
 * The folder the files would go to if the player picked `picked`: a folder called FILES_FOLDER_NAME
 * inside it (or `picked` itself when it already has that name). Null with the problem when it cannot be used.
 */
export async function filesTarget(picked: string, currentRoot: string, userData: string): Promise<{ root: string } | { problem: TargetProblem }> {
  const chosen = path.resolve(picked);
  const root = path.basename(chosen) === FILES_FOLDER_NAME ? chosen : path.join(chosen, FILES_FOLDER_NAME);
  const dataDefault = defaultFilesRoot(userData);
  if (sameFolder(root, path.resolve(currentRoot))) return { problem: "same" };
  if (insideOrSame(root, path.resolve(currentRoot)) || insideOrSame(path.resolve(currentRoot), root)) return { problem: "nested" };
  // Tavora's own data folder is no place for it, except the default folder itself.
  if (!sameFolder(root, dataDefault) && insideOrSame(root, path.resolve(userData))) return { problem: "inside-data" };
  try {
    await mkdir(root, { recursive: true });
    const probe = path.join(root, `.tavora-write-test-${process.pid}`);
    await writeFile(probe, "x");
    await rm(probe, { force: true });
  } catch {
    return { problem: "not-writable" };
  }
  return { root };
}

export interface StoredFile {
  module: string;
  game: string;
  name: string;
  bytes: number;
}

/** The pictures under a files folder: `<module>/<game>/<id>.<ext>`, nothing else. */
export async function listStoredFiles(root: string): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  const names = async (dir: string) => readdir(dir).catch(() => [] as string[]);
  for (const module of await names(root)) {
    if (!isModuleId(module)) continue;
    for (const game of await names(path.join(root, module))) {
      if (!isGameId(game)) continue;
      for (const name of await names(path.join(root, module, game))) {
        if (!parseBlobFileName(name)) continue;
        try {
          const info = await stat(path.join(root, module, game, name));
          if (info.isFile()) files.push({ module, game, name, bytes: info.size });
        } catch {
          // Gone while we looked.
        }
      }
    }
  }
  return files;
}

const fileAt = (root: string, file: StoredFile) => path.join(root, file.module, file.game, file.name);

/**
 * Copies every file to the new folder and checks each copy's size. A file already there with the same size is
 * kept, so a move that was cut off can be run again. Throws on the first problem; the old files are untouched.
 */
export async function copyStoredFiles(from: string, to: string, files: readonly StoredFile[], onProgress?: (done: number) => void): Promise<void> {
  let done = 0;
  for (const file of files) {
    const target = fileAt(to, file);
    const existing = await stat(target).then((info) => info.size, () => -1);
    if (existing !== file.bytes) {
      await mkdir(path.dirname(target), { recursive: true });
      const part = `${target}.part`;
      await copyFile(fileAt(from, file), part);
      if ((await stat(part)).size !== file.bytes) throw new Error(`copy of ${file.name} is not the same size`);
      await rename(part, target);
    }
    onProgress?.(++done);
  }
}

/** Removes the copied files from the old folder, and the folders that are empty afterwards. Never throws: leftovers are harmless. */
export async function removeStoredFiles(root: string, files: readonly StoredFile[]): Promise<void> {
  for (const file of files) await rm(fileAt(root, file), { force: true }).catch(() => undefined);
  for (const file of files) {
    await rmdir(path.join(root, file.module, file.game)).catch(() => undefined);
    await rmdir(path.join(root, file.module)).catch(() => undefined);
  }
}
