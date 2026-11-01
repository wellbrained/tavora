import { stat } from "node:fs/promises";
import path from "node:path";
import { CATALOG } from "./catalog";
import { normalizeName, type InstalledGame, type LauncherSource } from "./launcher-games";

/**
 * The games on this PC for the Add a game picker, newest activity first. Everything here is read on this PC and
 * kept on it: Steam's own last-played times, when Tavora last saw a game running, and when it was installed.
 */

/** Earlier sources win when two launchers know the same game. */
const ORDER: LauncherSource[] = ["battlenet", "epic", "gog", "steam", "windows"];

export type Activity = { kind: "played" | "installed"; at: number };

export interface PickedGame {
  /** `steam:<id>` for a Steam game, else the game's name reduced to what spellings share. */
  key: string;
  name: string;
  steamAppId: number | null;
  catalogId: string | null;
  /** The launcher entry the icon is read from. */
  source: InstalledGame;
  activity: Activity | null;
}

export interface Signs {
  /** Steam's LastPlayed per application id, in seconds since 1970. */
  steamPlayed: ReadonlyMap<number, number>;
  /** When Tavora last saw each game running (by key), in milliseconds since 1970. */
  seen: Readonly<Record<string, number>>;
}

export function gameKey(game: Pick<InstalledGame, "name" | "steamAppId">): string {
  return game.steamAppId === undefined ? `n:${normalizeName(game.name)}` : `steam:${game.steamAppId}`;
}

/** The built-in game a name or Steam id belongs to. */
export function catalogIdFor(name: string, steamAppId?: number): string | null {
  if (steamAppId !== undefined) {
    const byId = CATALOG.find((game) => game.steamAppId === steamAppId);
    if (byId) return byId.id;
  }
  const wanted = normalizeName(name);
  if (!wanted) return null;
  return CATALOG.find((game) => normalizeName(game.name) === wanted || game.aliases?.some((alias) => normalizeName(alias) === wanted))?.id ?? null;
}

/**
 * What the user last did with the game, the best sign first: Steam's note of the last play, else when Tavora
 * last saw it running, else when it was installed. When both of the first two exist, the later one wins.
 */
export function activityOf(game: Pick<InstalledGame, "name" | "steamAppId" | "installedAt">, signs: Signs): Activity | null {
  const key = gameKey(game);
  const steam = game.steamAppId === undefined ? undefined : signs.steamPlayed.get(game.steamAppId);
  const seen = signs.seen[key];
  const played = Math.max(steam ? steam * 1000 : 0, seen ?? 0);
  if (played > 0) return { kind: "played", at: played };
  return game.installedAt ? { kind: "installed", at: game.installedAt } : null;
}

/**
 * The games to offer. The Windows list of programs holds every program, so only the ones that are a built-in game
 * are taken from it; the launchers' own lists are all games. One entry per game, the launcher named first in ORDER.
 */
export function pickGames(installed: readonly InstalledGame[], signs: Signs): PickedGame[] {
  const byKey = new Map<string, InstalledGame>();
  for (const game of [...installed].sort((a, b) => ORDER.indexOf(a.source) - ORDER.indexOf(b.source))) {
    if (!normalizeName(game.name)) continue;
    if (game.source === "windows" && !catalogIdFor(game.name, game.steamAppId)) continue;
    const key = gameKey(game);
    if (!byKey.has(key)) byKey.set(key, game);
    else if (!byKey.get(key)!.installedAt && game.installedAt) byKey.set(key, { ...byKey.get(key)!, installedAt: game.installedAt });
  }
  // The same game from two launchers (a Steam id and a name) counts once.
  const byName = new Map<string, PickedGame>();
  for (const [key, game] of byKey) {
    const nameKey = normalizeName(game.name);
    const picked: PickedGame = { key, name: game.name, steamAppId: game.steamAppId ?? null, catalogId: catalogIdFor(game.name, game.steamAppId), source: game, activity: activityOf(game, signs) };
    const same = byName.get(nameKey);
    if (!same) byName.set(nameKey, picked);
    else if (picked.activity && (!same.activity || picked.activity.at > same.activity.at)) same.activity = picked.activity;
  }
  return sortPicked([...byName.values()]);
}

/** Recently played first, then recently installed, then the rest by name. A play always comes before an install. */
export function sortPicked<T extends { name: string; activity: Activity | null }>(games: T[]): T[] {
  const rank = (game: T) => (game.activity?.kind === "played" ? 2 : game.activity ? 1 : 0);
  return games.sort((a, b) => rank(b) - rank(a) || (b.activity?.at ?? 0) - (a.activity?.at ?? 0) || a.name.localeCompare(b.name));
}

/** The folder's creation time for the games whose launcher gave no date. Missing folders are skipped. */
export async function withInstallDates(games: readonly InstalledGame[]): Promise<InstalledGame[]> {
  return Promise.all(
    games.map(async (game) => {
      if (game.installedAt) return game;
      try {
        const info = await stat(game.folder ?? path.win32.dirname(game.file));
        const at = info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs;
        return at > 0 ? { ...game, installedAt: at } : game;
      } catch {
        return game;
      }
    }),
  );
}

/** Tests only: a JSON list of `{ name, steamAppId?, installedAt? }` as the installed games, never the PC's own. Bad input gives none. */
export function parseTestInstalled(text: string): InstalledGame[] {
  try {
    const list = JSON.parse(text) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item): InstalledGame[] => {
      if (typeof item !== "object" || item === null) return [];
      const { name, steamAppId, installedAt } = item as Record<string, unknown>;
      if (typeof name !== "string") return [];
      return [
        {
          source: "epic",
          name,
          file: "C:\Test\game.exe",
          index: 0,
          ...(typeof steamAppId === "number" ? { steamAppId } : {}),
          ...(typeof installedAt === "number" ? { installedAt } : {}),
        },
      ];
    });
  } catch {
    return [];
  }
}
