import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isGameId } from "@tavora/module-schema";

/**
 * "Ask for a module" (decided 2026-11-01): in Add a game, a game with no modules offers one click that says
 * "I'd like a module for this game". One vote per install and game; only the game's name and ids and a
 * code the app makes from a random number on the PC and the game, so no one can tell which games came from
 * the same PC. No account, no address, no request log. The admin reads the games ranked by votes.
 */

/** Longest name kept; the app's search field stops at 80 too. */
export const MAX_GAME_NAME = 80;
/**
 * Most different games kept, so made-up names cannot grow the file. When it is full, a new game takes the place of the
 * one with the fewest votes whose last vote is the oldest, so made-up names can't keep real games out for good.
 */
export const MAX_GAMES = 5000;
/** Most games the admin list returns. */
export const MAX_LISTED = 500;

export interface RequestedGame {
  name: string;
  steamAppId: number | null;
  /** Tavora's id for the game, when the game list has one. */
  gameId: string | null;
}

export interface ModuleRequest extends RequestedGame {
  /** Which game it is (gameKey), for removing it in the admin. */
  key: string;
  votes: number;
  firstAt: string;
  lastAt: string;
}

export interface ParsedRequest {
  game: RequestedGame;
  /** A code per install and game: 64 lowercase hex digits. */
  voter: string;
}

const VOTER = /^[0-9a-f]{64}$/;
// Any control or invisible formatting character; names are shown in the admin as plain text.
const UNWANTED = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** The body of a vote, checked: `{ game: { name, steamAppId?, gameId? }, voter }`; null when anything is off. */
export function parseRequest(body: unknown): ParsedRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const { game, voter } = body as { game?: unknown; voter?: unknown };
  if (typeof voter !== "string" || !VOTER.test(voter)) return null;
  if (typeof game !== "object" || game === null) return null;
  const { name, steamAppId, gameId } = game as { name?: unknown; steamAppId?: unknown; gameId?: unknown };
  if (typeof name !== "string") return null;
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || [...clean].length > MAX_GAME_NAME || UNWANTED.test(clean)) return null;
  if (steamAppId !== undefined && steamAppId !== null && !(Number.isSafeInteger(steamAppId) && (steamAppId as number) > 0 && (steamAppId as number) < 2 ** 31)) return null;
  if (gameId !== undefined && gameId !== null && !isGameId(gameId)) return null;
  return { game: { name: clean, steamAppId: (steamAppId as number | null | undefined) ?? null, gameId: (gameId as string | null | undefined) ?? null }, voter };
}

/** Which votes count as the same game: the Steam id, else Tavora's id, else the name in lower case letters and digits. */
export function gameKey(game: RequestedGame): string {
  if (game.steamAppId !== null) return `steam:${game.steamAppId}`;
  if (game.gameId !== null) return `game:${game.gameId}`;
  return `name:${game.name.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()}`;
}

export class ModuleRequestStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists games (key text primary key, name text not null, steam_appid integer, game_id text, votes integer not null, first_at integer not null, last_at integer not null) without rowid;
      create table if not exists votes (key text not null, voter text not null, primary key (key, voter)) without rowid;
    `);
  }

  /** Whether a game has a vote already. */
  has(game: RequestedGame): boolean {
    return this.db.prepare("select 1 from games where key = ?").get(gameKey(game)) !== undefined;
  }

  /**
   * Counts one vote. A second vote from the same install for the same game changes nothing. A new game on a full list
   * takes the place of the game with the fewest votes, the one whose last vote is the oldest first.
   */
  vote({ game, voter }: ParsedRequest, now: number = Date.now(), maxGames: number = MAX_GAMES): void {
    const key = gameKey(game);
    this.db.exec("begin immediate");
    try {
      if (!this.db.prepare("select 1 from games where key = ?").get(key)) {
        const count = (this.db.prepare("select count(*) as n from games").get() as { n: number }).n;
        if (count >= maxGames) {
          const out = this.db.prepare("select key from games order by votes, last_at, key limit ?").all(count - maxGames + 1) as unknown as { key: string }[];
          for (const row of out) this.removeKey(row.key);
        }
      }
      const added = this.db.prepare("insert or ignore into votes (key, voter) values (?, ?)").run(key, voter);
      if (Number(added.changes) > 0) {
        // The first vote's spelling stays; later ones only fill in an id it lacked.
        this.db
          .prepare(
            `insert into games (key, name, steam_appid, game_id, votes, first_at, last_at) values (?, ?, ?, ?, 1, ?, ?)
             on conflict (key) do update set votes = votes + 1, last_at = excluded.last_at,
               steam_appid = coalesce(steam_appid, excluded.steam_appid), game_id = coalesce(game_id, excluded.game_id)`,
          )
          .run(key, game.name, game.steamAppId, game.gameId, now, now);
      }
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** Takes a game and its votes off the list (the admin's Remove); false when there is no such game. */
  remove(key: string): boolean {
    this.db.exec("begin immediate");
    try {
      const removed = this.removeKey(key);
      this.db.exec("commit");
      return removed;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  private removeKey(key: string): boolean {
    this.db.prepare("delete from votes where key = ?").run(key);
    return Number(this.db.prepare("delete from games where key = ?").run(key).changes) > 0;
  }

  /** The games asked for, most votes first, then the latest vote. */
  ranked(limit: number = MAX_LISTED): ModuleRequest[] {
    const rows = this.db
      .prepare("select key, name, steam_appid as steamAppId, game_id as gameId, votes, first_at as firstAt, last_at as lastAt from games order by votes desc, last_at desc, key limit ?")
      .all(Math.min(limit, MAX_LISTED)) as unknown as { key: string; name: string; steamAppId: number | null; gameId: string | null; votes: number; firstAt: number; lastAt: number }[];
    return rows.map((row) => ({ ...row, firstAt: new Date(row.firstAt).toISOString(), lastAt: new Date(row.lastAt).toISOString() }));
  }
}
