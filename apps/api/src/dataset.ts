import { DatabaseSync } from "node:sqlite";
import { isCanonicalId, normalize, slugify } from "./ids.ts";

// Merges the sources into one list of games and writes it as a SQLite file the
// service loads. Ids are issued once and frozen: the registry of ids from
// earlier builds always wins, so a rebuild can never change an id.

export interface BuiltInGame {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export interface WikidataGame {
  /** Wikidata item id, such as "Q42". */
  qid: string;
  label: string;
  aliases: readonly string[];
  steamAppId: number | null;
}

export interface SteamApp {
  appid: number;
  name: string;
}

/** Ids issued by earlier builds, found again by their matching key. */
export interface IdRegistry {
  /** "steam:<appid>" or "wd:<qid>" mapped to the canonical id. */
  keys: ReadonlyMap<string, string>;
  /** Every id ever issued, so none is given out twice. */
  ids: ReadonlySet<string>;
}

export interface GameRow {
  id: string;
  name: string;
  aliases: string[];
  steamAppId: number | null;
  wikidata: string | null;
  builtIn: boolean;
}

export const MAX_ALIASES = 10;

const steamKey = (appid: number) => `steam:${appid}`;
const wikidataKey = (qid: string) => `wd:${qid}`;

export function emptyRegistry(): IdRegistry {
  return { keys: new Map(), ids: new Set() };
}

export interface BuildInput {
  builtIns: readonly BuiltInGame[];
  wikidata: readonly WikidataGame[];
  steam: readonly SteamApp[];
  registry?: IdRegistry;
}

export function buildDataset(input: BuildInput): GameRow[] {
  const registry = input.registry ?? emptyRegistry();
  const taken = new Set(registry.ids);
  const games = new Map<string, GameRow>();
  const byName = new Map<string, GameRow>();
  const byKey = new Map<string, GameRow>();

  const index = (game: GameRow) => {
    byName.set(normalize(game.name), game);
    for (const alias of game.aliases) if (!byName.has(normalize(alias))) byName.set(normalize(alias), game);
    if (game.steamAppId !== null) byKey.set(steamKey(game.steamAppId), game);
    if (game.wikidata) byKey.set(wikidataKey(game.wikidata), game);
  };

  const addAlias = (game: GameRow, alias: string) => {
    const norm = normalize(alias);
    if (!norm || norm === normalize(game.name)) return;
    if (game.aliases.some((existing) => normalize(existing) === norm)) return;
    if (game.aliases.length >= MAX_ALIASES) return;
    game.aliases.push(alias);
    if (!byName.has(norm)) byName.set(norm, game);
  };

  const issueId = (name: string, appid: number | null, qid: string | null): string => {
    const base = slugify(name);
    const suffix = appid !== null ? String(appid) : qid ? qid.toLowerCase() : "";
    const candidates = [base, base && suffix ? `${base}-${suffix}` : "", suffix ? `game-${suffix}` : ""];
    for (const candidate of candidates) {
      if (candidate && isCanonicalId(candidate) && !taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
    throw new Error(`No free id for "${name}" (${suffix || "no key"})`);
  };

  const register = (game: GameRow) => {
    games.set(game.id, game);
    index(game);
  };

  // Built-in games keep the ids they have always had.
  for (const builtIn of input.builtIns) {
    if (!isCanonicalId(builtIn.id)) throw new Error(`Built-in id "${builtIn.id}" is not a valid canonical id`);
    if (games.has(builtIn.id)) throw new Error(`Built-in id "${builtIn.id}" appears twice`);
    taken.add(builtIn.id);
    register({
      id: builtIn.id,
      name: builtIn.name,
      aliases: [...(builtIn.aliases ?? [])],
      steamAppId: null,
      wikidata: null,
      builtIn: true,
    });
  }

  // Find the game a source entry belongs to: earlier id, then key, then name.
  // A name match is only trusted when it does not contradict a key: two
  // different games can share a name (remasters, "Doom").
  const compatible = (game: GameRow, appid: number | null, qid: string | null) =>
    (appid === null || game.steamAppId === null || game.steamAppId === appid) &&
    (qid === null || game.wikidata === null || game.wikidata === qid);

  const find = (keys: string[], names: string[], appid: number | null, qid: string | null): GameRow | undefined => {
    for (const key of keys) {
      const known = registry.keys.get(key);
      const game = (known && games.get(known)) ?? byKey.get(key);
      if (game) return game;
    }
    for (const name of names) {
      const game = byName.get(normalize(name));
      if (game && compatible(game, appid, qid)) return game;
    }
    return undefined;
  };

  const attach = (game: GameRow, appid: number | null, qid: string | null) => {
    if (appid !== null && game.steamAppId === null) game.steamAppId = appid;
    if (qid && game.wikidata === null) game.wikidata = qid;
    index(game);
  };

  const create = (name: string, appid: number | null, qid: string | null): GameRow => {
    // A key issued before keeps its id even if the game was renamed since.
    const earlier = (appid !== null && registry.keys.get(steamKey(appid))) || (qid && registry.keys.get(wikidataKey(qid)));
    const id = earlier || issueId(name, appid, qid);
    if (games.has(id)) throw new Error(`Id "${id}" is already in use by another game`);
    const game: GameRow = { id, name, aliases: [], steamAppId: appid, wikidata: qid, builtIn: false };
    register(game);
    return game;
  };

  // Sorted so new ids come out the same however the sources were ordered.
  const wikidata = [...input.wikidata].sort((a, b) => Number(a.qid.slice(1)) - Number(b.qid.slice(1)));
  for (const entry of wikidata) {
    const keys = [wikidataKey(entry.qid), ...(entry.steamAppId !== null ? [steamKey(entry.steamAppId)] : [])];
    const game = find(keys, [entry.label], entry.steamAppId, entry.qid) ?? create(entry.label, entry.steamAppId, entry.qid);
    attach(game, entry.steamAppId, entry.qid);
    for (const alias of entry.aliases) addAlias(game, alias);
  }

  const steam = [...input.steam].sort((a, b) => a.appid - b.appid);
  for (const app of steam) {
    const game = find([steamKey(app.appid)], [app.name], app.appid, null) ?? create(app.name, app.appid, null);
    attach(game, app.appid, null);
    addAlias(game, app.name);
  }

  return [...games.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** The registry of a finished build, to feed the next one. */
export function registryOf(games: readonly GameRow[], previous: IdRegistry = emptyRegistry()): IdRegistry {
  const keys = new Map(previous.keys);
  const ids = new Set(previous.ids);
  for (const game of games) {
    ids.add(game.id);
    if (game.steamAppId !== null) keys.set(steamKey(game.steamAppId), game.id);
    if (game.wikidata) keys.set(wikidataKey(game.wikidata), game.id);
  }
  return { keys, ids };
}

const SCHEMA = `
create table meta (key text primary key, value text not null);
create table games (
  id text primary key,
  name text not null,
  steam_appid integer,
  wikidata text,
  built_in integer not null
);
create table entries (
  id integer primary key,
  game_id text not null references games(id),
  kind text not null check (kind in ('name', 'alias')),
  norm text not null
);
create index entries_norm on entries(norm);
create virtual table entries_fts using fts5(norm, tokenize = 'unicode61');
`;

/** Writes the dataset to `path` (":memory:" for tests) and returns the open database. */
export function writeDatabase(path: string, games: readonly GameRow[], builtAt = new Date()): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const insertGame = db.prepare("insert into games (id, name, steam_appid, wikidata, built_in) values (?, ?, ?, ?, ?)");
  const insertEntry = db.prepare("insert into entries (id, game_id, kind, norm) values (?, ?, ?, ?)");
  const insertFts = db.prepare("insert into entries_fts (rowid, norm) values (?, ?)");
  db.exec("begin");
  let entryId = 0;
  const addEntry = (gameId: string, kind: "name" | "alias", text: string) => {
    const norm = normalize(text);
    if (!norm) return;
    entryId += 1;
    insertEntry.run(entryId, gameId, kind, norm);
    insertFts.run(entryId, norm);
  };
  for (const game of games) {
    insertGame.run(game.id, game.name, game.steamAppId, game.wikidata, game.builtIn ? 1 : 0);
    addEntry(game.id, "name", game.name);
    for (const alias of game.aliases) addEntry(game.id, "alias", alias);
  }
  db.prepare("insert into meta (key, value) values ('built_at', ?)").run(builtAt.toISOString());
  db.prepare("insert into meta (key, value) values ('games', ?)").run(String(games.length));
  db.exec("commit");
  return db;
}
