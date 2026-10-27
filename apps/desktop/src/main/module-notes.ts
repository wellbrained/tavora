import type { ChangelogEntry } from "@tavora/module-schema";
import { compareModuleVersions } from "./installer";

// Which of a module's patch notes the user sees, and which are new to them.

/** The entries for versions the user has, newest first: none newer than the installed version. */
export function installedNotes(entries: readonly ChangelogEntry[], version: string): ChangelogEntry[] {
  return entries.filter((entry) => compareModuleVersions(entry.version, version) <= 0).sort((a, b) => compareModuleVersions(b.version, a.version));
}

/** Whether there are notes the user has not seen: entries newer than the version they last saw, up to the installed one. */
export function hasUnseenNotes(entries: readonly ChangelogEntry[], version: string, seen: string | undefined): boolean {
  if (seen === undefined) return false;
  return installedNotes(entries, version).some((entry) => compareModuleVersions(entry.version, seen) > 0);
}
