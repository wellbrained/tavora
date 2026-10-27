import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Writes to a temp file and renames it over the target, so readers never see half a file. */
export async function writeFileAtomic(file: string, body: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, body);
  await rename(temp, file);
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

/** Copies a file's old content into a backup folder. A copy an earlier start made stays; a different one gets a new name. */
export async function keepCopy(dir: string, name: string, old: Buffer): Promise<void> {
  for (let n = 1; ; n++) {
    const target = path.join(dir, n === 1 ? name : `${name}.${n}`);
    const existing = await stat(target).then(
      () => readFile(target),
      () => null,
    );
    if (existing?.equals(old)) return;
    if (existing === null) return writeFileAtomic(target, old);
  }
}
