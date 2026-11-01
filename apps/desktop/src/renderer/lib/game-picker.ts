import type { CatalogMatch, CatalogModuleView, InstalledGameView, OnlineGame } from "../../shared/host-api";
import { rank, rankByName } from "./search";

/** One line of the Add a game list: a game on this PC, a built-in game or one from the online search. */
export interface PickerRow {
  /** Unique in the list. */
  key: string;
  name: string;
  /** The built-in or online game's id, which the new workspace is made with; null for a game only found on this PC. */
  gameId: string | null;
  icon: string | null;
  installed: InstalledGameView | null;
  online: OnlineGame | null;
  /** The workspace the user already has for it. */
  workspaceId: string | null;
}

/**
 * The rows for what was typed. Without a search: the games on this PC, most recently played first. With one:
 * every game that fits (this PC's, the built-in list, the online search), best fit first, one row per game.
 */
export function buildRows(installed: readonly InstalledGameView[], matches: readonly CatalogMatch[], online: readonly OnlineGame[], query: string): PickerRow[] {
  const own: PickerRow[] = installed.map((game) => ({
    key: game.key,
    name: game.name,
    gameId: game.catalogId,
    icon: game.icon,
    installed: game,
    online: null,
    workspaceId: game.workspaceId,
  }));
  const others: PickerRow[] = [];
  const known = new Set(installed.map((game) => game.catalogId).filter((id): id is string => id !== null));
  if (query.trim()) {
    for (const match of matches) {
      if (known.has(match.id)) continue;
      known.add(match.id);
      others.push({ key: `catalog:${match.id}`, name: match.name, gameId: match.id, icon: null, installed: null, online: null, workspaceId: null });
    }
    for (const game of online) {
      if (known.has(game.id)) continue;
      known.add(game.id);
      others.push({ key: `online:${game.id}`, name: game.name, gameId: game.id, icon: null, installed: null, online: game, workspaceId: null });
    }
    // This PC's games only stay when the words fit them; the lists were already filtered by their search.
    const rows = [...rank(own, query, (row) => ({ name: row.name })), ...others];
    return rankByName(rows, query, (row) => row.name);
  }
  return own;
}

/** The catalog modules made for a game, Tavora's own first, then by name. */
export function modulesFor(modules: readonly CatalogModuleView[], gameId: string | null): CatalogModuleView[] {
  if (!gameId) return [];
  return modules.filter((module) => module.gameIds.includes(gameId)).sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name));
}

/** The modules ticked when a game is first highlighted: Tavora's own. */
export function defaultTicks(modules: readonly CatalogModuleView[]): string[] {
  return modules.filter((module) => module.official).map((module) => module.id);
}

/** Up to three letters or digits from a name's words, for the tile of a game with no icon. */
export function initials(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  const significant = words.filter((word, index) => index === 0 || !/^(of|the|and|a|an|de|der|die|das)$/i.test(word));
  const letters = (significant.length > 1 ? significant.map((word) => [...word][0]) : [...(significant[0] ?? "?")]).slice(0, 3).join("");
  return letters.toUpperCase() || "?";
}

export type ActivityText =
  | { key: "addGame.played.today" | "addGame.played.yesterday" | "addGame.installed.today" | "addGame.installed.yesterday" }
  | { key: "addGame.played.daysAgo" | "addGame.installed.daysAgo"; n: number }
  | { key: "addGame.played.inMonth" | "addGame.installed.inMonth"; month: Date; withYear: boolean };

const DAY = 24 * 60 * 60 * 1000;

/** How to say when a game was played or installed: today, yesterday, N days ago (up to two weeks), else the month. */
export function describeActivity(activity: { kind: "played" | "installed"; at: number }, now: number): ActivityText {
  const startOfDay = (time: number) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(activity.at)) / DAY));
  const played = activity.kind === "played";
  if (days === 0) return { key: played ? "addGame.played.today" : "addGame.installed.today" };
  if (days === 1) return { key: played ? "addGame.played.yesterday" : "addGame.installed.yesterday" };
  if (days <= 14) return { key: played ? "addGame.played.daysAgo" : "addGame.installed.daysAgo", n: days };
  const month = new Date(activity.at);
  return { key: played ? "addGame.played.inMonth" : "addGame.installed.inMonth", month, withYear: month.getFullYear() !== new Date(now).getFullYear() };
}

/** The input `add-workspace` takes for a row, or for the typed name (no row) as the user's own game. */
export function addInputFor(row: PickerRow | null, name: string): { catalogId: string } | { online: OnlineGame } | { name: string } {
  if (!row) return { name };
  if (row.online) return { online: row.online };
  if (row.gameId && (!row.installed || row.installed.catalogId)) return { catalogId: row.gameId };
  return { name: row.name };
}
