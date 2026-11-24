// Moving the folder where modules keep their pictures (see blobs.ts) to another place. The user
// picks the place in a system dialog; everything is copied and checked first, the setting is
// switched next, and only then are the old files removed, so a failure never loses a picture.

import { copyFile, lstat, mkdir, readdir, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isGameId, isModuleId, isOwnerId } from "@tavora/module-schema";
import { parseBlobFileName } from "./blobs";
import { isInsideOrSame } from "./path-inside";

/** Inside the place the user picks, the files go into a folder of their own with this name. */
export const FILES_FOLDER_NAME = "Tavora";
/** What that folder was called before; picking one of these uses it as it is. */
const OLD_FOLDER_NAME = "Tavora module files";

/** The files folder's name inside the app's data folder. */
export const FILES_DIR = "module-blobs";
/** The folder next to a module's workspace folders for its files shared by every workspace; the same name as storage.app's. */
const APP_FILES_DIR = "_app";

/**
 * The files folder inside the app's data folder: the default until the user's Pictures folder took
 * its place (index.ts), and still the default where no Pictures folder is given (tests).
 */
export function defaultFilesRoot(userData: string): string {
  return path.join(userData, FILES_DIR);
}

/** Why a place cannot be used. The host words these for the user. */
export type TargetProblem = "same" | "nested" | "inside-data" | "not-writable";

const sameFolder = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * Where `place` really is: its real path (links, and junctions on Windows, resolved), or for a place not made yet the
 * real path of the nearest folder above it that is there, with the rest appended.
 */
async function realPlace(place: string): Promise<string> {
  const resolved = path.resolve(place);
  try {
    return await realpath(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(await realPlace(parent), path.basename(resolved));
  }
}

/** Why `root` can't take the files now in `currentRoot`, comparing where both really are (no link may lead one into the other). */
async function overlap(root: string, currentRoot: string): Promise<"same" | "nested" | null> {
  const [real, current] = await Promise.all([realPlace(root), realPlace(currentRoot)]);
  if (sameFolder(real, current)) return "same";
  if (isInsideOrSame(real, current) || isInsideOrSame(current, real)) return "nested";
  return null;
}

/**
 * The folder the files would go to if the user picked `picked`: a folder called FILES_FOLDER_NAME
 * inside it (or `picked` itself when it already has that name). Null with the problem when it cannot be used.
 * Places are compared where they really are, so a link or junction onto the folder in use (or into it) is refused
 * like the folder itself: the move would otherwise copy each file onto itself and then delete it.
 */
export async function filesTarget(
  picked: string,
  currentRoot: string,
  userData: string,
  defaultRoot = defaultFilesRoot(userData),
): Promise<{ root: string } | { problem: TargetProblem }> {
  const chosen = path.resolve(picked);
  const root = [FILES_FOLDER_NAME, OLD_FOLDER_NAME].includes(path.basename(chosen)) ? chosen : path.join(chosen, FILES_FOLDER_NAME);
  const before = await overlap(root, currentRoot);
  if (before) return { problem: before };
  // Tavora's own data folder is no place for it, except the default folder itself.
  const [real, realDefault, realData] = await Promise.all([realPlace(root), realPlace(defaultRoot), realPlace(userData)]);
  if (!sameFolder(real, realDefault) && isInsideOrSame(real, realData)) return { problem: "inside-data" };
  try {
    await mkdir(root, { recursive: true });
    const probe = path.join(root, `.tavora-write-test-${process.pid}`);
    await writeFile(probe, "x");
    await rm(probe, { force: true });
  } catch {
    return { problem: "not-writable" };
  }
  // Now that it is there, once more where it really is.
  const after = await overlap(root, currentRoot);
  if (after) return { problem: after };
  return { root };
}

export interface StoredFile {
  /** Whose module it is (S5): `official`, `local` or a publisher key. */
  owner: string;
  module: string;
  game: string;
  name: string;
  bytes: number;
}

/**
 * The files under a files folder: `<owner>/<module>/<workspace>/<id>.<ext>`, and `<owner>/<module>/_app/<id>.<ext>` for
 * the ones a module shares across every workspace (blobs.app). Nothing else.
 */
export async function listStoredFiles(root: string): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  const names = async (dir: string) => readdir(dir).catch(() => [] as string[]);
  for (const owner of await names(root)) {
    if (!isOwnerId(owner)) continue;
    for (const module of await names(path.join(root, owner))) {
      if (!isModuleId(module)) continue;
      for (const game of await names(path.join(root, owner, module))) {
        if (!isGameId(game) && game !== APP_FILES_DIR) continue;
        for (const name of await names(path.join(root, owner, module, game))) {
          if (!parseBlobFileName(name)) continue;
          try {
            const info = await stat(path.join(root, owner, module, game, name));
            if (info.isFile()) files.push({ owner, module, game, name, bytes: info.size });
          } catch {
            // Gone while we looked.
          }
        }
      }
    }
  }
  return files;
}

const fileAt = (root: string, file: StoredFile) => path.join(root, file.owner, file.module, file.game, file.name);

/**
 * Copies every file to the new folder and checks each copy's size. A file already there with the same size is
 * kept, so a move that was cut off can be run again. Throws on the first problem; the old files are untouched.
 */
export async function copyStoredFiles(from: string, to: string, files: readonly StoredFile[]): Promise<void> {
  const source = await realPlace(from);
  for (const file of files) {
    const target = fileAt(to, file);
    await mkdir(path.dirname(target), { recursive: true });
    // A link inside the new folder (to a module's or a workspace's folder, or to the file itself) may lead back into
    // the old one: the "copy" would be the original, deleted once the move is done. A file there is never a link.
    if (isInsideOrSame(await realPlace(path.dirname(target)), source)) throw new Error(`${path.dirname(target)} leads back into ${from}`);
    const there = await lstat(target).catch(() => null);
    if (there && !there.isFile()) throw new Error(`${target} is no plain file`);
    if (there?.size !== file.bytes) {
      const part = `${target}.part`;
      // A .part left over (or put there as a link) goes first: copyFile writes through a link.
      await rm(part, { force: true });
      await copyFile(fileAt(from, file), part);
      if ((await stat(part)).size !== file.bytes) throw new Error(`copy of ${file.name} is not the same size`);
      await rename(part, target);
    }
  }
}

/** Removes the copied files from the old folder, and the folders that are empty afterwards. Never throws: leftovers are harmless. */
export async function removeStoredFiles(root: string, files: readonly StoredFile[]): Promise<void> {
  for (const file of files) await rm(fileAt(root, file), { force: true }).catch(() => undefined);
  for (const file of files) {
    await rmdir(path.join(root, file.owner, file.module, file.game)).catch(() => undefined);
    await rmdir(path.join(root, file.owner, file.module)).catch(() => undefined);
    await rmdir(path.join(root, file.owner)).catch(() => undefined);
  }
}
