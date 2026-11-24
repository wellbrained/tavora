import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isGameId } from "@tavora/module-schema";
import { openStateDb } from "./sqlite.ts";

/**
 * "Ask for a module" (decided 2026-11-01): in Add a game, a game with no modules offers one click that says
 * "I'd like a module for this game". One vote per install and game; only the game's name and ids and a
 * code the app makes from a random number on the PC and the game, so no one can tell which games came from
 * the same PC. No account, no address, no request log. The admin reads the games ranked by votes.
 */

/** Longest name kept; the app's search field stops at 80 too. */
export const MAX_GAME_NAME = 80;
/**
 * Most different games kept, so made-up names cannot grow the file. When it is full, a new game takes the place of one
 * Tavora's game list doesn't know (fewest votes, oldest last vote first), so made-up names and ids can't keep real games out
 * for good, and can't push a known game out either; a known newcomer may also take the place of a known game with a single
 * vote or none for KNOWN_KEEP_MS (see vote()).
 */
export const MAX_GAMES = 5000;
/** A known game with no vote for this long may give its place on a full list to another known game. */
export const KNOWN_KEEP_MS = 90 * 24 * 60 * 60_000;
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
  /** Whether Tavora's game list knows the id it is counted by. */
  known: boolean;
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

/**
 * A vote's network (an IPv4 /24, an IPv6 /48) for one game, so votes are counted once per network: 4 hex digits of a hash
 * of both under a secret only the server has (voteSalt), enough to tell a game's networks apart (two of them rarely share
 * one, and then count once). Without the secret nobody can work out a network from it; with it, 4 digits still match
 * many networks and don't link one network's votes across games.
 */
const networkMark = (salt: string, key: string, network: string) => createHmac("sha256", salt).update(`vote-network:${key}:${network}`).digest("hex").slice(0, 4);

/** A secret: at least 32 characters. */
const SALT = /^\S{32,}$/;

/**
 * The secret for vote networks: MODULE_REQUEST_SALT when it is set (at least 32 characters), else the one in `file`, made
 * (64 hex digits, readable by the service only) the first time. Kept out of the daily backup, so a copy of the votes alone
 * tells no network; if it is lost, a new one is made and each network may count once more per game.
 */
export function voteSalt(env: Record<string, string | undefined>, file: string, warn: (message: string) => void = console.warn): string {
  const set = env.MODULE_REQUEST_SALT?.trim();
  if (set && SALT.test(set)) return set;
  if (set) warn("[tavora-api] MODULE_REQUEST_SALT is shorter than 32 characters; using the one in the state folder.");
  try {
    const kept = readFileSync(file, "utf8").trim();
    if (SALT.test(kept)) return kept;
  } catch {
    // None yet.
  }
  const made = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${made}\n`, { mode: 0o600 });
  return made;
}

/** Which votes count as the same game: the Steam id, else Tavora's id, else the name in lower case letters and digits. */
export function gameKey(game: RequestedGame): string {
  if (game.steamAppId !== null) return `steam:${game.steamAppId}`;
  if (game.gameId !== null) return `game:${game.gameId}`;
  return `name:${game.name.normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase()}`;
}

/**
 * Whether Tavora's game list (the dataset the search answers from) knows the id a game is counted by (gameKey): its Steam id,
 * else its Tavora id. A name alone, or an id the list doesn't have, is not known, as anyone can make those up.
 */
export function gameListKnows(dataset: DatabaseSync): (key: string) => boolean {
  let steamIds: Set<number> | undefined;
  const byId = dataset.prepare("select 1 from games where id = ?");
  return (key) => {
    const steam = /^steam:(\d+)$/.exec(key);
    if (steam) {
      steamIds ??= new Set((dataset.prepare("select steam_appid from games where steam_appid is not null").all() as unknown as { steam_appid: number }[]).map((row) => row.steam_appid));
      return steamIds.has(Number(steam[1]));
    }
    const id = /^game:(.+)$/.exec(key);
    return id ? byId.get(id[1]!) !== undefined : false;
  };
}

export class ModuleRequestStore {
  private readonly db: DatabaseSync;

  /** Closes the database (the service's clean stop). */
  close(): void {
    this.db.close();
  }
  private readonly salt: string;

  /** `salt`: the secret for vote networks (voteSalt); a new random one when absent, as for a test. */
  constructor(file: string, { salt = randomBytes(32).toString("hex") }: { salt?: string } = {}) {
    this.salt = salt;
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = openStateDb(file);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists games (key text primary key, name text not null, steam_appid integer, game_id text, votes integer not null, first_at integer not null, last_at integer not null) without rowid;
      create table if not exists votes (key text not null, voter text not null, primary key (key, voter)) without rowid;
    `);
    // Whether Tavora's game list knows the id the game is counted by (1), or not (0 or null: a made-up id or only a name).
    const columns = (this.db.prepare("pragma table_info(games)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!columns.includes("known")) this.db.exec("alter table games add column known integer");
    // Which network a vote came from, for one game only (networkMark): null for votes from before it, each counted on its own.
    const voteColumns = (this.db.prepare("pragma table_info(votes)").all() as unknown as { name: string }[]).map((column) => column.name);
    if (!voteColumns.includes("network")) this.db.exec("alter table votes add column network text");
    this.db.exec("create index if not exists votes_network on votes (key, network)");
  }

  /** Whether a game has a vote already. */
  has(game: RequestedGame): boolean {
    return this.db.prepare("select 1 from games where key = ?").get(gameKey(game)) !== undefined;
  }

  /** Sets every game's `known` by the game list (at start, as the list may have changed since). */
  refreshKnown(knows: (key: string) => boolean): void {
    const keys = (this.db.prepare("select key from games").all() as unknown as { key: string }[]).map((row) => row.key);
    const set = this.db.prepare("update games set known = ? where key = ?");
    this.db.exec("begin immediate");
    try {
      for (const key of keys) set.run(knows(key) ? 1 : 0, key);
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /**
   * Counts one vote: once per network (`network`, an IPv4 /24 or IPv6 /48) and game, so one network can't pad a game's
   * votes with made-up voter codes; a later vote from the same install, or from the same network, changes nothing. Without
   * `network` (a test, or a vote from before), each voter counts. A new game on a full list takes the place of another,
   * never of a known game (`known`: Tavora's game list has its id) that still has people asking: first games the list
   * doesn't know, the fewest votes and then the oldest last vote first; then, only for a known newcomer, a known game with
   * a single vote or with no vote for KNOWN_KEEP_MS, in the same order. False when nothing may make room (nothing is
   * stored then).
   */
  vote(
    { game, voter }: ParsedRequest,
    now: number = Date.now(),
    { known = false, maxGames = MAX_GAMES, network }: { known?: boolean; maxGames?: number; network?: string } = {},
  ): boolean {
    const key = gameKey(game);
    const mark = network === undefined ? null : networkMark(this.salt, key, network);
    this.db.exec("begin immediate");
    try {
      if (!this.db.prepare("select 1 from games where key = ?").get(key)) {
        const count = (this.db.prepare("select count(*) as n from games").get() as { n: number }).n;
        if (count >= maxGames) {
          const need = count - maxGames + 1;
          const out = this.db.prepare("select key from games where coalesce(known, 0) = 0 order by votes, last_at, key limit ?").all(need) as unknown as { key: string }[];
          if (known && out.length < need) {
            const stale = this.db.prepare("select key from games where known = 1 and (votes <= 1 or last_at < ?) order by votes, last_at, key limit ?");
            out.push(...(stale.all(now - KNOWN_KEEP_MS, need - out.length) as unknown as { key: string }[]));
          }
          if (out.length < need) {
            this.db.exec("rollback");
            return false;
          }
          for (const row of out) this.removeKey(row.key);
        }
      } else if (mark !== null && this.db.prepare("select 1 from votes where key = ? and network = ?").get(key, mark)) {
        // This network asked for the game already.
        this.db.exec("commit");
        return true;
      }
      const added = this.db.prepare("insert or ignore into votes (key, voter, network) values (?, ?, ?)").run(key, voter, mark);
      if (Number(added.changes) > 0) {
        // The first vote's spelling stays; later ones only fill in an id it lacked.
        this.db
          .prepare(
            `insert into games (key, name, steam_appid, game_id, votes, first_at, last_at, known) values (?, ?, ?, ?, 1, ?, ?, ?)
             on conflict (key) do update set votes = votes + 1, last_at = excluded.last_at, known = max(coalesce(known, 0), excluded.known),
               steam_appid = coalesce(steam_appid, excluded.steam_appid), game_id = coalesce(game_id, excluded.game_id)`,
          )
          .run(key, game.name, game.steamAppId, game.gameId, now, now, known ? 1 : 0);
      }
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return true;
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
      .prepare("select key, name, steam_appid as steamAppId, game_id as gameId, votes, first_at as firstAt, last_at as lastAt, known from games order by votes desc, last_at desc, key limit ?")
      .all(Math.min(limit, MAX_LISTED)) as unknown as { key: string; name: string; steamAppId: number | null; gameId: string | null; votes: number; firstAt: number; lastAt: number; known: number | null }[];
    return rows.map((row) => ({ ...row, known: row.known === 1, firstAt: new Date(row.firstAt).toISOString(), lastAt: new Date(row.lastAt).toISOString() }));
  }
}
