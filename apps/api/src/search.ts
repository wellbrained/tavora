import type { DatabaseSync } from "node:sqlite";
import { normalize } from "./ids.ts";

export const MAX_QUERY_LENGTH = 100;
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 20;

export interface SearchResult {
  id: string;
  name: string;
  /** The game's Steam application id, or null when it has none (not on Steam, or not known). */
  steamAppId: number | null;
}

// How well an entry matches, best first.
const EXACT_NAME = 0;
const EXACT_ALIAS = 1;
const PREFIX_NAME = 2;
const PREFIX_ALIAS = 3;
const WORDS = 4;

interface Candidate {
  gameId: string;
  kind: "name" | "alias";
  norm: string;
}

/** Games for a typed query: exact name, exact alias, prefix of either, then all words as prefixes. */
export function searchGames(db: DatabaseSync, query: string, limit = DEFAULT_LIMIT): SearchResult[] {
  const q = normalize(query.slice(0, MAX_QUERY_LENGTH));
  if (!q) return [];
  const cap = Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);

  const best = new Map<string, number>();
  const note = (gameId: string, tier: number) => {
    const seen = best.get(gameId);
    if (seen === undefined || tier < seen) best.set(gameId, tier);
  };

  const prefix = db
    .prepare("select game_id as gameId, kind, norm from entries where norm >= ? and norm < ? limit 400")
    .all(q, `${q}￿`) as unknown as Candidate[];
  for (const entry of prefix) {
    const exact = entry.norm === q;
    note(entry.gameId, entry.kind === "name" ? (exact ? EXACT_NAME : PREFIX_NAME) : exact ? EXACT_ALIAS : PREFIX_ALIAS);
  }

  // Every word has to match the start of a word in the name: "ring eld" finds Elden Ring.
  const words = q.split(" ").filter(Boolean).slice(0, 8);
  const match = words.map((word) => `"${word.replace(/"/g, "")}"*`).join(" ");
  const fts = db
    .prepare(
      "select e.game_id as gameId, e.kind, e.norm from entries_fts f join entries e on e.id = f.rowid where entries_fts match ? limit 400",
    )
    .all(match) as unknown as Candidate[];
  for (const entry of fts) note(entry.gameId, WORDS);

  if (best.size === 0) return [];
  const ids = [...best.keys()];
  const rows = db
    .prepare(
      `select id, name, steam_appid as steamAppId, built_in as builtIn from games where id in (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as unknown as { id: string; name: string; steamAppId: number | null; builtIn: number }[];

  return rows
    .sort(
      (a, b) =>
        best.get(a.id)! - best.get(b.id)! ||
        b.builtIn - a.builtIn ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name),
    )
    .slice(0, cap)
    .map(({ id, name, steamAppId }) => ({ id, name, steamAppId }));
}
