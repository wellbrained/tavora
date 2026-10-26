// The apps dialog's list: search and sort. Pure, so it is tested on its own.
import type { SystemApp } from "@tavora/sdk";

export type AppsSort = "name" | "memory" | "cpu";

/** RAM and CPU start with the biggest, names from A. */
export const firstDirection = (by: AppsSort): "up" | "down" => (by === "name" ? "up" : "down");

export function listApps(apps: readonly SystemApp[], query: string, by: AppsSort, direction: "up" | "down", language = "en"): SystemApp[] {
  const needle = query.trim().toLocaleLowerCase(language);
  const shown = needle ? apps.filter((app) => app.name.toLocaleLowerCase(language).includes(needle)) : [...apps];
  const sign = direction === "up" ? 1 : -1;
  const byName = (a: SystemApp, b: SystemApp) => a.name.localeCompare(b.name, language, { sensitivity: "base" });
  return shown.sort((a, b) => {
    if (by === "name") return sign * byName(a, b);
    const left = by === "memory" ? a.memoryBytes : (a.cpu ?? -1);
    const right = by === "memory" ? b.memoryBytes : (b.cpu ?? -1);
    // Equal numbers keep a steady order, so rows don't swap places on every refresh.
    return sign * (left - right) || byName(a, b);
  });
}

export const shownBytes = (apps: readonly SystemApp[]) => apps.reduce((sum, app) => sum + app.memoryBytes, 0);
