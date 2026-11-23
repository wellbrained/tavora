// The cloud copy's own files, kept by SavedFile's rules (saved-file.ts) like every other file of the user's, and by one
// more (decided 2026-11-23, "a saved file that can't be read is never written over"):
// - one that can't be read right now (a virus scan or a sync app holds it) is never written over or removed: a write
//   after such a read reads it again first, and while that still fails nothing is written (HeldError, which the cloud
//   copy holds until the next start, as for any read that is held);
// - a damaged one stays where it is, as its being there says something (the copy is on, a swap began), with a copy
//   aside, and reads as damaged (file-look.ts); one a newer Tavora wrote is copied aside;
// - each write is made at once, whole and flushed to the disk before it is in place, after every write of the same file
//   asked before: none is put off or joined with another, so what the cloud copy writes before a step that depends on
//   it (docs/state-machines.md) is on the disk before that step.
// Each file has one SavedFile, however many places read it, so what was last read of it decides what may be written.
// The bytes are the same as before: `{"v":1,…}`, then the fields as the cloud copy gives them.
import path from "node:path";
import { HeldError, type Looked } from "./file-look";
import type { SavedRecord } from "./json";
import { SAVED_FILES, SavedFile, SavedFileHeld, type SavedFields } from "./saved-file";

/**
 * Which of the cloud copy's files: its state (cloud-copy.json, or cloud-copy-swapping.json during a swap), where it is
 * kept, a swap's status, a staged copy's list, a swap's incoming lists, or the parts this PC saw unused.
 */
export type CopyFileKind = "state" | "place" | "status" | "list" | "incoming" | "unused";

function open(file: string, kind: CopyFileKind): SavedFile {
  switch (kind) {
    case "state":
      return new SavedFile(file, SAVED_FILES.cloudCopy);
    case "place":
      return new SavedFile(file, SAVED_FILES.copyPlace);
    case "status":
      return new SavedFile(file, SAVED_FILES.copyStatus);
    case "list":
      return new SavedFile(file, SAVED_FILES.copyList);
    case "incoming":
      return new SavedFile(file, SAVED_FILES.incomingLists);
    case "unused":
      return new SavedFile(file, SAVED_FILES.copyUnused);
  }
}

/** The SavedFile of each of the cloud copy's files, by its kind and path. */
const opened = new Map<string, SavedFile>();

function savedFile(file: string, kind: CopyFileKind): SavedFile {
  const key = `${kind}:${path.resolve(file)}`;
  let found = opened.get(key);
  if (!found) opened.set(key, (found = open(file, kind)));
  return found;
}

/** The file as file-look.ts tells it: present (what `parse` made of it), missing, or held (busy, or damaged). */
export function lookCopyFile<T>(file: string, kind: CopyFileKind, parse: (saved: SavedRecord) => T | null): Promise<Looked<T>> {
  return savedFile(file, kind).look(parse);
}

/** What the file holds, or null when it is missing or damaged; throws while it can't be read. */
export function readCopyFile(file: string, kind: CopyFileKind): Promise<SavedRecord | null> {
  return savedFile(file, kind).read();
}

/** Writes the fields, the version first. Refused (HeldError) while the file can't be read. */
export function writeCopyFile<T extends SavedFields>(file: string, kind: CopyFileKind, fields: T & { readonly length?: never }): Promise<void> {
  const saved = savedFile(file, kind);
  return afterRead(saved, () => saved.write(fields));
}

/** Removes the file. Refused (HeldError) while it can't be read. */
export function removeCopyFile(file: string, kind: CopyFileKind): Promise<void> {
  const saved = savedFile(file, kind);
  return afterRead(saved, () => saved.remove());
}

/** Does it; refused because the last read failed, it reads the file again first, and does it once that works. */
async function afterRead(saved: SavedFile, act: () => Promise<void>): Promise<void> {
  try {
    return await act();
  } catch (error) {
    if (!(error instanceof SavedFileHeld)) throw error;
  }
  try {
    await saved.read();
  } catch (error) {
    throw new HeldError(error);
  }
  try {
    await act();
  } catch (error) {
    throw error instanceof SavedFileHeld ? new HeldError(error.cause) : error;
  }
}
