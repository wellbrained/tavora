import { readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { JsonValue } from "@tavora/sdk/protocol";
import { HostError } from "./errors";
import { keepCopy, keepCopyAt } from "./fsutil";
import { STORE_VERSIONS } from "./saved-versions";

const MAX_DEPTH = 64;

/** Accepts only plain JSON data: no Dates, Maps, typed arrays, NaN or cycles. */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_DEPTH) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  }
  return false;
}

/** Serializes a value after checking it is plain JSON. */
export function serializeJson(value: unknown, what: string): string {
  if (!isJsonValue(value)) throw new HostError("INVALID_PARAMS", `${what} must be plain JSON data`);
  return JSON.stringify(value);
}

/** How many of the user's files were set aside this run because they couldn't be read, and who hears of each new one. */
let keptCount = 0;
let keptListener: (() => void) | null = null;

/** How many of the user's saved files were set aside this run because they couldn't be read. */
export function unreadableFilesKept(): number {
  return keptCount;
}

/** Hears of every file of the user's set aside from now on, so the host UI can say so. */
export function onUnreadableFileKept(listener: (() => void) | null): void {
  keptListener = listener;
}

/** Counts one of the user's files kept aside, so the host UI says some saved data couldn't be opened. */
function tellKept(): void {
  keptCount++;
  keptListener?.();
}

/**
 * Renames a file aside to `<file>.corrupt-<time>` (`-2`, `-3`, … when that name is taken), so an unreadable file is
 * kept, never written over, and the store starts empty. With `notice` it is one of the user's own files: it is
 * counted, and the host UI says some saved data couldn't be opened.
 */
export async function setAside(file: string, notice = false): Promise<void> {
  const stamp = `${file}.corrupt-${Date.now()}`;
  for (let n = 1; ; n++) {
    const target = n === 1 ? stamp : `${stamp}-${n}`;
    const taken = await stat(target).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (taken) continue;
    await rename(file, target);
    break;
  }
  console.error(`[tavora] unreadable file has been set aside: ${file}`);
  if (notice) tellKept();
}

/**
 * Reads a JSON file. Missing gives null; unreadable JSON is renamed aside
 * (never overwritten) and also gives null. For caches and logs; the user's own files use readSavedFile.
 */
export async function readJsonOrSetAside<T>(file: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    await setAside(file);
    return null;
  }
}

/**
 * How one of the user's saved files is kept safe (readSavedFile). Every file holding the user's data has a version
 * and is read this way; caches, derived files and logs are not. The rules for raising a version are in saved-versions.ts.
 */
export interface SavedFileRules {
  /** The newest format of the file this Tavora understands. */
  version: number;
  /** The field the version is in: "version", or "v" in the sealed files (account, keys, Discord, cloud copy). */
  versionKey?: "version" | "v";
  /** Tell the user when the file is set aside. Off for bookkeeping they would never miss; on by default. */
  notice?: boolean;
  /**
   * An unreadable file is copied aside (`<file>.corrupt`, once per content) and left where it is, instead of renamed:
   * for a file whose being there means something (the cloud copy's own files say it is on).
   */
  leaveInPlace?: boolean;
}

export type SavedRecord = Record<string, unknown>;

export const isSavedRecord = (value: unknown): value is SavedRecord => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads one of the user's saved JSON files. Missing gives null. One that isn't a JSON object is set aside (renamed,
 * never overwritten), the user hears of it, and null comes back. One a newer Tavora wrote (its version is above
 * `rules.version`) is first copied aside, as `<file>.from-version-<n>`, and then given back to be read as far as this
 * Tavora understands it: whatever this one writes later, the newer one's file stays. A file that can't be read for
 * another reason (held by a virus scan) throws, so nothing starts empty and writes over it.
 */
export async function readSavedFile(file: string, rules: SavedFileRules): Promise<SavedRecord | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return checkSavedFile(file, bytes, rules);
}

/** readSavedFile for a file the caller has read already: sets it aside or copies it aside the same way. */
export async function checkSavedFile(file: string, bytes: Buffer | string, rules: SavedFileRules): Promise<SavedRecord | null> {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString());
  } catch {
    value = undefined;
  }
  if (!isSavedRecord(value)) {
    if (rules.leaveInPlace) {
      const { wrote } = await keepCopyAt(path.dirname(file), `${path.basename(file)}.corrupt`, Buffer.from(bytes));
      console.error(`[tavora] unreadable file has been copied aside: ${file}`);
      // Left where it is, the same damaged file is read again at every start: tell the user once, when the copy is new.
      if (wrote && rules.notice !== false) tellKept();
    } else await setAside(file, rules.notice !== false);
    return null;
  }
  const version = value[rules.versionKey ?? "version"];
  if (typeof version === "number" && version > rules.version) await keepNewerCopy(file, version, Buffer.from(bytes));
  return value;
}

/**
 * Copies a file a newer Tavora wrote to `<file>.from-version-<n>`, and answers with the copy's path. A copy with the same
 * content stays as it is; a different one (the newer Tavora wrote the file again since) gets a number after it, so no
 * copy is ever written over.
 */
export function keepNewerCopy(file: string, version: number, bytes: Buffer): Promise<string> {
  return keepCopy(path.dirname(file), `${path.basename(file)}.from-version-${version}`, bytes);
}

/**
 * Opens one of the sealed files (`{ "v": 1, "data": … }`, the data sealed by the system: account, keys, Discord) with
 * `open`. Missing, or a file that can't be read right now, gives null. One a newer Tavora wrote is copied aside and
 * gives null. One that is damaged is set aside, the user is told, and it gives null. One whose data doesn't open here
 * (sealed by another Windows user, a keyring that is locked for now, or `open` refuses it) stays where it is, so the
 * next start can try again, and a copy goes aside (`<file>.unopened`) in case something is written over it meanwhile.
 * Never throws. Copies of a sealed file hold what it held: forgetSealedFile removes them with it.
 */
export async function openSealedFile<T>(file: string, open: (data: string) => T | Promise<T>): Promise<T | null> {
  const version = STORE_VERSIONS.sealed;
  let saved: SavedRecord | null;
  try {
    saved = await readSavedFile(file, { version, versionKey: "v" });
  } catch {
    return null;
  }
  if (saved === null || (typeof saved.v === "number" && saved.v > version)) return null;
  if (saved.v !== version || typeof saved.data !== "string") {
    await setAside(file, true).catch(() => undefined);
    return null;
  }
  try {
    return await open(saved.data);
  } catch {
    await keepCopy(path.dirname(file), `${path.basename(file)}.unopened`, Buffer.from(JSON.stringify(saved))).catch(() => undefined);
    return null;
  }
}

/** Removes a sealed file and every copy of it set aside (signing out forgets them all). */
export async function forgetSealedFile(file: string): Promise<void> {
  await rm(file, { force: true });
  const base = path.basename(file);
  const copies = (await readdir(path.dirname(file)).catch(() => [] as string[])).filter((name) => [".corrupt-", ".from-version-", ".unopened"].some((kind) => name.startsWith(`${base}${kind}`)));
  for (const name of copies) await rm(path.join(path.dirname(file), name), { force: true });
}

/**
 * The fields of a saved record this Tavora doesn't know (a newer Tavora's), to be written back as they were. Library,
 * workspace and module storage keep them, so a PC on an older Tavora loses nothing a newer one saved (the cloud copy).
 */
export function unknownFields(saved: unknown, known: readonly string[]): SavedRecord {
  if (!isSavedRecord(saved)) return {};
  return Object.fromEntries(Object.entries(saved).filter(([key]) => !known.includes(key)));
}
