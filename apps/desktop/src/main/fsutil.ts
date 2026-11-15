import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Writes to a temp file and renames it over the target, so readers never see half a file. Each write has a temp file
 * of its own, so two writes of the same file at once can't move each other's half-written one into place.
 */
export async function writeFileAtomic(file: string, body: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temp, body);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
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
