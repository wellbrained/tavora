// Settings > Development tags a release copy that the catalog does not have yet or has only in an older
// version, so the developer sees at a glance what is left to publish. The catalog's index is asked once
// and compared on this PC with the order the update check uses.
import type { ReleaseCopy, ReleaseStatus } from "../shared/host-api";
import type { CatalogEntry } from "./catalog-client";
import { compareModuleVersions } from "./installer";

/** At most this many copies are compared in one ask. */
const MAX_COPIES = 200;

/** Whether an ask from the window is a short list of ids with versions. */
export function isReleaseCopies(value: unknown): value is ReleaseCopy[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_COPIES &&
    value.every((copy) => typeof copy === "object" && copy !== null && typeof copy.id === "string" && copy.id.length <= 200 && typeof copy.version === "string" && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(copy.version) && copy.version.length <= 64)
  );
}

/** `listed` is the version the catalog has for the id, or null when it has none. */
export function releaseStatus(version: string, listed: string | null): ReleaseStatus {
  if (listed === null) return "not-published";
  return compareModuleVersions(version, listed) > 0 ? "new-version" : "current";
}

/** The status of each copy against the catalog's index, or null when the catalog could not be reached (never a guess). */
export function releaseStatuses(index: readonly CatalogEntry[] | null, copies: readonly ReleaseCopy[]): Record<string, ReleaseStatus> | null {
  if (!index) return null;
  const listed = new Map(index.map((entry) => [entry.id, entry.version]));
  return Object.fromEntries(copies.map((copy) => [copy.id, releaseStatus(copy.version, listed.get(copy.id) ?? null)]));
}
