// The apps dialog's list: search, sort, and which apps fold away as small. Pure, so it is tested on its own.
import type { SystemApp } from "@tavora/sdk";

/** "share" is the % RAM column: the same order as RAM. */
export type AppsSort = "name" | "memory" | "share" | "cpu";

/** Apps under this share of the installed RAM fold away until the user opens them. */
export const SMALL_SHARE = 5;

/** RAM, % and CPU start with the biggest, names from A. */
export const firstDirection = (by: AppsSort): "up" | "down" => (by === "name" ? "up" : "down");

/** An app's share of the installed RAM in percent, or null when the size of the RAM is unknown. */
export const ramShare = (bytes: number, totalBytes: number): number | null => (totalBytes > 0 ? (bytes / totalBytes) * 100 : null);

export function listApps(apps: readonly SystemApp[], query: string, by: AppsSort, direction: "up" | "down", language = "en"): SystemApp[] {
  const needle = query.trim().toLocaleLowerCase(language);
  const shown = needle ? apps.filter((app) => app.name.toLocaleLowerCase(language).includes(needle)) : [...apps];
  const sign = direction === "up" ? 1 : -1;
  const byName = (a: SystemApp, b: SystemApp) => a.name.localeCompare(b.name, language, { sensitivity: "base" });
  return shown.sort((a, b) => {
    if (by === "name") return sign * byName(a, b);
    const left = by === "cpu" ? (a.cpu ?? -1) : a.memoryBytes;
    const right = by === "cpu" ? (b.cpu ?? -1) : b.memoryBytes;
    // Equal numbers keep a steady order, so rows don't swap places on every refresh.
    return sign * (left - right) || byName(a, b);
  });
}

/**
 * Splits a listed (and sorted) list into the apps shown at once and the small ones under SMALL_SHARE % of the
 * installed RAM. A search shows every match at once, small or not; so does an unknown RAM size.
 */
export function splitApps(apps: readonly SystemApp[], totalBytes: number, query: string): { big: SystemApp[]; small: SystemApp[] } {
  if (query.trim() || totalBytes <= 0) return { big: [...apps], small: [] };
  const limit = (totalBytes * SMALL_SHARE) / 100;
  return { big: apps.filter((app) => app.memoryBytes >= limit), small: apps.filter((app) => app.memoryBytes < limit) };
}

export const shownBytes = (apps: readonly SystemApp[]) => apps.reduce((sum, app) => sum + app.memoryBytes, 0);
