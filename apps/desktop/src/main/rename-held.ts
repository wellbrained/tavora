import { rename } from "node:fs/promises";
import { HeldError } from "./file-look";

/** How long a rename waits, in turn, for a virus scan or an indexer to let go of the file. */
const RENAME_WAITS_MS = [20, 50, 100, 200, 400];

/**
 * Does `act` (a removal), trying again while the file is briefly held (a HeldError) by a virus scan or an indexer, with
 * the same waits as a rename. Still held after the last wait, the error comes out.
 */
export async function retryHeld(act: () => Promise<void>, waits: readonly number[] = RENAME_WAITS_MS): Promise<void> {
  for (const wait of waits) {
    try {
      return await act();
    } catch (error) {
      if (!(error instanceof HeldError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  await act();
}

/**
 * Renames a file, trying again while something else briefly holds it. With `stillWanted`, each try first asks it, and
 * none is made once it says no: false then, true when the file was renamed.
 */
export async function renameHeld(from: string, to: string, waits: readonly number[] = RENAME_WAITS_MS, stillWanted: () => boolean = () => true): Promise<boolean> {
  for (const wait of waits) {
    if (!stillWanted()) return false;
    try {
      await rename(from, to);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  if (!stillWanted()) return false;
  await rename(from, to);
  return true;
}
