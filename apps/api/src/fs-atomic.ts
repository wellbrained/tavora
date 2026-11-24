import { renameSync, writeFileSync } from "node:fs";

/** Writes a file by writing a per-process temporary file next to it and renaming it over the target. */
export function writeFileAtomicSync(file: string, data: string | Uint8Array): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}
