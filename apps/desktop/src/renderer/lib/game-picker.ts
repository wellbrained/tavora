import { MAX_PICKER_COVERS, type CatalogMatch, type CatalogModuleView, type InstalledGameView, type OnlineGame } from "../../shared/host-api";
import { rank, rankByName } from "./search";

/** Where a row of the Add a game list comes from: this PC, the built-in list or the online search. */
type PickerSection = "pc" | "catalog" | "online";

/** One line of the Add a game list: a game on this PC, a built-in game or one from the online search. */
export interface PickerRow {
  /** Unique in the list; the highlight and a pick go by it. */
  key: string;
  name: string;
  /** The built-in or online game's id, which the new workspace is made with; null for a game only found on this PC. */
  gameId: string | null;
  icon: string | null;
  installed: InstalledGameView | null;
  online: OnlineGame | null;
  /** The workspace the user already has for it. */
  workspaceId: string | null;
  section: PickerSection;
}

/** What a row says besides its name. */
export interface PickerBadge {
  /** How many modules the catalog has for the game. */
  modules: number;
  /** The second line, already in words. */
  when: string | null;
}

/** The key of the extra last row that adds the typed name as the user's own game. No game's key has this shape. */
export const CUSTOM_KEY = "custom:";

/**
 * The rows for what was typed. Without a search: the games on this PC, most recently played first. With one, in
 * three parts that are never ranked together, so a row stays where it is when a later answer comes in: this PC's games
 * that fit, then the built-in list's, then the online search's, one row per game.
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
    section: "pc",
  }));
  /** This PC's games by the id they are added with. */
  const byId = new Map(own.flatMap((row) => (row.gameId ? [[row.gameId, row] as const] : [])));
  // A game on this PC that isn't in the built-in list but that the online search knows by its Steam app is the same
  // game: one row, added with the online game's id, so the modules made for it are offered.
  for (const row of own) {
    // A game already added (by name, before this) keeps its own workspace: nothing to match there.
    if (row.gameId !== null || row.workspaceId !== null || row.installed?.steamAppId == null) continue;
    const match = online.find((game) => game.steamAppId === row.installed!.steamAppId);
    if (!match || byId.has(match.id)) continue;
    row.gameId = match.id;
    row.online = match;
    byId.set(match.id, row);
  }
  if (!query.trim()) return own;

  // This PC's games only stay when the words fit them; the lists were already filtered by their search.
  const pc = rank(own, query, (row) => ({ name: row.name }));
  const shown = new Set<string>(pc.map((row) => row.gameId ?? row.key));
  /** Each game of a list once: this PC's copy of it when there is one ("Diablo® IV" found as "diablo 4"), else the list's. */
  function part<G extends { id: string; name: string }>(games: readonly G[], section: "catalog" | "online", make: (game: G) => PickerRow): PickerRow[] {
    const rows: PickerRow[] = [];
    for (const game of games) {
      if (shown.has(game.id)) continue;
      shown.add(game.id);
      const mine = byId.get(game.id);
      rows.push(mine ? { ...mine, section } : make(game));
    }
    return rankByName(rows, query, (row) => row.name);
  }
  const catalog = part(matches, "catalog", (match) => ({ key: `catalog:${match.id}`, name: match.name, gameId: match.id, icon: null, installed: null, online: null, workspaceId: null, section: "catalog" }));
  const more = part(online, "online", (game) => ({ key: `online:${game.id}`, name: game.name, gameId: game.id, icon: null, installed: null, online: game, workspaceId: null, section: "online" }));
  return [...pc, ...catalog, ...more];
}

/**
 * The games for the covers of Played lately: on this PC and not added yet (a game whose only copy is in Trash counts
 * as not added), the last played first, then the last installed, at most `max`.
 */
export function playedLately(installed: readonly InstalledGameView[], max = MAX_PICKER_COVERS): InstalledGameView[] {
  const order = (game: InstalledGameView) => (game.activity?.kind === "played" ? 0 : game.activity ? 1 : 2);
  // A stable sort: games alike keep the order they came in.
  return installed
    .filter((game) => !game.workspaceId)
    .sort((a, b) => order(a) - order(b) || (b.activity?.at ?? 0) - (a.activity?.at ?? 0))
    .slice(0, max);
}

// ── The highlight ──────────────────────────────────────────────────────

/** What the arrow keys move over: the covers (side by side, ← and →) and the list below them (↑ and ↓). */
export interface PickerItems {
  covers: readonly string[];
  rows: readonly string[];
}

/** The highlight once the items changed: the same game when it is still there, else the first item, else none. */
export function keepActive(items: PickerItems, active: string | null): string | null {
  if (active !== null && (items.covers.includes(active) || items.rows.includes(active))) return active;
  return items.covers[0] ?? items.rows[0] ?? null;
}

/**
 * Where an arrow key moves the highlight, or undefined when the key isn't for the list (← and → in the search text).
 * In the covers ← and → move along them and ↓ goes to the list; in the list ↑ and ↓ move, and ↑ from its first row goes
 * back to the covers. Without covers the list wraps around at its ends.
 */
export function stepActive(items: PickerItems, active: string | null, key: string): string | undefined {
  const { covers, rows } = items;
  const current = keepActive(items, active);
  if (current === null) return undefined;
  const cover = covers.indexOf(current);
  const row = rows.indexOf(current);
  if (key === "ArrowLeft" || key === "ArrowRight") {
    if (cover < 0) return undefined;
    return covers[Math.min(covers.length - 1, Math.max(0, cover + (key === "ArrowRight" ? 1 : -1)))];
  }
  if (key === "ArrowDown") {
    if (cover >= 0) return rows[0] ?? current;
    return covers.length ? rows[Math.min(rows.length - 1, row + 1)] : rows[(row + 1) % rows.length];
  }
  if (key === "ArrowUp") {
    if (cover >= 0) return current;
    if (covers.length) return row === 0 ? covers[0] : rows[row - 1];
    return rows[(row - 1 + rows.length) % rows.length];
  }
  return undefined;
}

/** The catalog modules made for a game, Tavora's own first, then by name. */
export function modulesFor(modules: readonly CatalogModuleView[], gameId: string | null): CatalogModuleView[] {
  if (!gameId) return [];
  return modules.filter((module) => module.gameIds.includes(gameId)).sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name));
}

/** The modules a pick adds with the game: Tavora's own. */
export function addedWithGame(modules: readonly CatalogModuleView[]): string[] {
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

export type AddInput = { catalogId: string } | { online: OnlineGame } | { name: string; steamAppId?: number };

/**
 * The input `add-workspace` takes for a row, or for the typed name (no row) as the user's own game. A game found on
 * this PC that no list knows keeps its Steam app id, so it gets its icon and is known as the same game later.
 */
export function addInputFor(row: PickerRow | null, name: string): AddInput {
  if (!row) return { name };
  // A copy: what is sent to the main process must be plain data.
  if (row.online) return { online: { id: row.online.id, name: row.online.name, steamAppId: row.online.steamAppId } };
  if (row.gameId && (!row.installed || row.installed.catalogId)) return { catalogId: row.gameId };
  const steamAppId = row.installed?.steamAppId;
  return steamAppId == null ? { name: row.name } : { name: row.name, steamAppId };
}
