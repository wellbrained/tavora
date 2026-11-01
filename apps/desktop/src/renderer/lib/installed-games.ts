import type { InstalledGameView } from "../../shared/host-api";
import { api } from "../host";

// The games on this PC take a while to find the first time (about ten seconds). The app starts the search quietly
// when it opens and keeps the last list here, so the Add a game dialog shows it at once and refreshes it in the
// background. Only in memory: the list holds icons and play times, and finding it again is cheap once it has been
// found once.

let last: InstalledGameView[] | null = null;
let running: Promise<InstalledGameView[]> | null = null;

/** The list from the last search, or null when none has finished yet. */
export function lastInstalledGames(): InstalledGameView[] | null {
  return last;
}

/** Searches this PC. Asking while a search runs joins it instead of starting another. */
export function findInstalledGames(): Promise<InstalledGameView[]> {
  running ??= api
    .installedGames()
    .then((games) => (last = games))
    .catch(() => last ?? [])
    .finally(() => (running = null));
  return running;
}

/** Forgets the list, for tests. */
export function resetInstalledGames(): void {
  last = null;
  running = null;
}
