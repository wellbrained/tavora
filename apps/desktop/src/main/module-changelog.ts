import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { CHANGELOG_LIMITS, validateChangelog, type ChangelogEntry } from "@tavora/module-schema";
import { resolveAsset } from "./assets";

/** The entries of a changelog file; throws when it can't be read, is bigger than `maxBytes` or isn't valid. */
async function readEntries(file: string, maxBytes = Infinity): Promise<ChangelogEntry[]> {
  if ((await stat(file)).size > maxBytes) throw new Error("missing or too big");
  const result = validateChangelog(JSON.parse(await readFile(file, "utf8")));
  if (!result.ok) throw new Error(result.errors.slice(0, 2).join("; "));
  return result.entries;
}

/**
 * A module's patch notes, read from the changelog file its manifest names, resolved inside the
 * package like any asset. A missing, oversized or invalid file gives no notes (and a warning), never
 * a module that fails to load: the notes are for users, not for running the module.
 */
export async function readModuleChangelog(root: string, file: string | undefined, moduleId: string): Promise<ChangelogEntry[]> {
  if (file === undefined || root === "") return [];
  try {
    const resolved = await resolveAsset(root, `/${file}`);
    if (!resolved) throw new Error("missing or too big");
    return await readEntries(resolved, CHANGELOG_LIMITS.maxBytes);
  } catch (error) {
    console.warn(`[tavora] module ${moduleId} has no readable changelog ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** The changelog of a module's source folder, for publishing; none, quietly, when there is no readable one. */
export async function readProjectChangelog(folder: string, file: string | undefined): Promise<ChangelogEntry[]> {
  if (file === undefined) return [];
  return readEntries(path.join(folder, file)).catch(() => []);
}
