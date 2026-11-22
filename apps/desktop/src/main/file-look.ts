// The one way the cloud copy, its swap and module recovery read what is on disk. A read has three answers, and only
// ENOENT means a thing isn't there. Anything else (a virus scan holding the file, a damaged file) is "held": we don't know
// what is there, so nothing destructive happens, nothing is uploaded, and the next start looks again.
import type { Stats } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";

export type Looked<T> = { status: "present"; value: T } | { status: "missing" } | { status: "held"; error: unknown };

/** A file that was read but doesn't hold what it should. */
export class DamagedFile extends Error {}

/** Thrown where a held read has to stop the work; the caller holds it until the next start. */
export class HeldError extends Error {
  /** The file error's code, when it was one. */
  readonly code: string | undefined;

  constructor(readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.code = (reason as NodeJS.ErrnoException | undefined)?.code;
  }
}

/** Runs one read and says which of the three it was. */
export async function look<T>(read: () => Promise<T>): Promise<Looked<T>> {
  try {
    return { status: "present", value: await read() };
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ? { status: "missing" } : { status: "held", error };
  }
}

export const lookStat = (file: string): Promise<Looked<Stats>> => look(() => stat(file));
export const lookNames = (dir: string): Promise<Looked<string[]>> => look(() => readdir(dir));
export const lookBytes = (file: string): Promise<Looked<Buffer>> => look(() => readFile(file));

/** A file holding a JSON object. Anything else in it is damaged, so held. */
export async function lookJson(file: string): Promise<Looked<Record<string, unknown>>> {
  const bytes = await lookBytes(file);
  if (bytes.status !== "present") return bytes;
  try {
    const value = JSON.parse(bytes.value.toString("utf8")) as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return { status: "present", value: value as Record<string, unknown> };
  } catch {
    // Said below.
  }
  return { status: "held", error: new DamagedFile(`${file} is damaged`) };
}

/** The value, or null when it isn't there. Held stops the work (HeldError). */
export function unlessHeld<T>(looked: Looked<T>): T | null {
  if (looked.status === "held") throw new HeldError(looked.error);
  return looked.status === "present" ? looked.value : null;
}

/** Held because the file is damaged, which waiting won't fix, rather than busy. */
export function isDamaged(looked: Looked<unknown>): boolean {
  return looked.status === "held" && looked.error instanceof DamagedFile;
}
