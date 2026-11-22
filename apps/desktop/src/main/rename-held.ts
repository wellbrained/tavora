import { rename } from "node:fs/promises";

/** How long a rename waits, in turn, for a virus scan or an indexer to let go of the file. */
const RENAME_WAITS_MS = [20, 50, 100, 200, 400];

/** Renames a file, trying again while something else briefly holds it. */
export async function renameHeld(from: string, to: string, waits: readonly number[] = RENAME_WAITS_MS): Promise<void> {
  for (const wait of waits) {
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  await rename(from, to);
}
