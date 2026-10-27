import { readFile, stat } from "node:fs/promises";
import { CHANGELOG_LIMITS, validateChangelog, type ChangelogEntry } from "@tavora/module-schema";
import { resolveAsset } from "./assets";

/**
 * A module's patch notes, read from the changelog file its manifest names, resolved inside the
 * package like any asset. A missing, oversized or invalid file gives no notes (and a warning), never
 * a module that fails to load: the notes are for users, not for running the module.
 */
export async function readModuleChangelog(root: string, file: string | undefined, moduleId: string): Promise<ChangelogEntry[]> {
  if (file === undefined || root === "") return [];
  try {
    const resolved = await resolveAsset(root, `/${file}`);
    if (!resolved || (await stat(resolved)).size > CHANGELOG_LIMITS.maxBytes) throw new Error("missing or too big");
    const result = validateChangelog(JSON.parse(await readFile(resolved, "utf8")));
    if (!result.ok) throw new Error(result.errors.slice(0, 2).join("; "));
    return result.entries;
  } catch (error) {
    console.warn(`[tavora] module ${moduleId} has no readable changelog ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
