import { describe, expect, it } from "vitest";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { gameKey, gameListKnows, MAX_GAMES, ModuleRequestStore, parseRequest } from "./module-requests.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createSubmissions } from "./submissions.ts";

const voter = (n: number) => n.toString(16).padStart(64, "0");
const valheim = { name: "Valheim", steamAppId: 892970 };

describe("a request body", () => {
  it("is a game and a voter code, cleaned", () => {
    expect(parseRequest({ game: { name: "  Valheim  ", steamAppId: 892970 }, voter: voter(1) })).toEqual({ game: { name: "Valheim", steamAppId: 892970, gameId: null }, voter: voter(1) });
    expect(parseRequest({ game: { name: "Elden   Ring", gameId: "elden-ring", steamAppId: null }, voter: voter(1) })?.game).toEqual({ name: "Elden Ring", steamAppId: null, gameId: "elden-ring" });
  });

  it("refuses everything else", () => {
    const good = { name: "Valheim" };
    for (const body of [
      null,
      "x",
      {},
      { game: good },
      { game: good, voter: "abc" },
      { game: good, voter: voter(255).toUpperCase() },
      { game: { name: "" }, voter: voter(1) },
      { game: { name: "   " }, voter: voter(1) },
      { game: { name: "a".repeat(81) }, voter: voter(1) },
      { game: { name: "bad\u0000name" }, voter: voter(1) },
      { game: { name: "bad‮name" }, voter: voter(1) },
      { game: { name: 5 }, voter: voter(1) },
      { game: { ...good, steamAppId: -1 }, voter: voter(1) },
      { game: { ...good, steamAppId: 1.5 }, voter: voter(1) },
      { game: { ...good, steamAppId: "892970" }, voter: voter(1) },
      { game: { ...good, gameId: "../x" }, voter: voter(1) },
    ]) {
      expect(parseRequest(body)).toBeNull();
    }
  });

  it("counts the same game once, by Steam id, else Tavora's id, else the name's letters", () => {
    expect(gameKey({ name: "Valheim", steamAppId: 892970, gameId: null })).toBe(gameKey({ name: "VALHEIM!", steamAppId: 892970, gameId: "valheim" }));
    expect(gameKey({ name: "Siedler 3", steamAppId: null, gameId: null })).toBe(gameKey({ name: "siedler  3", steamAppId: null, gameId: null }));
    expect(gameKey({ name: "A", steamAppId: null, gameId: "a" })).not.toBe(gameKey({ name: "A", steamAppId: null, gameId: null }));
  });
});

describe("the votes", () => {
  it("count once per install and game, and rank the games", () => {
    const store = new ModuleRequestStore(":memory:");
    const now = Date.parse("2026-11-01T10:00:00Z");
    expect(store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) }, now)).toBe(true);
    // The same install again: nothing changes, still a success.
    expect(store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) }, now + 1000)).toBe(true);
    store.vote({ game: { name: "VALHEIM", steamAppId: 892970, gameId: "valheim" }, voter: voter(2) }, now + 2000, { known: true });
    store.vote({ game: { name: "Siedler 3", steamAppId: null, gameId: null }, voter: voter(1) }, now + 3000);
    expect(store.ranked()).toEqual([
      { key: "steam:892970", known: true, name: "Valheim", steamAppId: 892970, gameId: "valheim", votes: 2, firstAt: "2026-11-01T10:00:00.000Z", lastAt: "2026-11-01T10:00:02.000Z" },
      { key: "name:siedler3", known: false, name: "Siedler 3", steamAppId: null, gameId: null, votes: 1, firstAt: "2026-11-01T10:00:03.000Z", lastAt: "2026-11-01T10:00:03.000Z" },
    ]);
  });

  it("puts the latest vote first among equal counts", () => {
    const store = new ModuleRequestStore(":memory:");
    store.vote({ game: { name: "Old", steamAppId: null, gameId: null }, voter: voter(1) }, 1000);
    store.vote({ game: { name: "New", steamAppId: null, gameId: null }, voter: voter(1) }, 2000);
    expect(store.ranked().map((game) => game.name)).toEqual(["New", "Old"]);
    expect(store.ranked(1)).toHaveLength(1);
  });

  it("on a full list, lets a new game take the place of the one with the fewest votes and the oldest last vote", () => {
    const store = new ModuleRequestStore(":memory:");
    const game = (name: string) => ({ name, steamAppId: null, gameId: null });
    const names = () => store.ranked().map((entry) => entry.name).sort();
    store.vote({ game: game("Popular"), voter: voter(1) }, 1000);
    store.vote({ game: game("Popular"), voter: voter(2) }, 1000);
    store.vote({ game: game("Stale"), voter: voter(1) }, 2000);
    store.vote({ game: game("Fresh"), voter: voter(1) }, 3000);
    expect(store.has(game("Stale"))).toBe(true);
    // Full at three: the single vote cast longest ago goes, with its votes, so a new vote for it counts as a first one.
    expect(store.vote({ game: game("Real"), voter: voter(1) }, 4000, { maxGames: 3 })).toBe(true);
    expect(names()).toEqual(["Fresh", "Popular", "Real"]);
    expect(store.has(game("Stale"))).toBe(false);
    const db = (store as unknown as { db: { prepare(sql: string): { get(...values: unknown[]): unknown } } }).db;
    expect(db.prepare("select count(*) as n from votes where key = ?").get("name:stale")).toEqual({ n: 0 });
    // A vote for a game on the list takes nobody's place.
    store.vote({ game: game("Fresh"), voter: voter(2) }, 5000, { maxGames: 3 });
    expect(names()).toEqual(["Fresh", "Popular", "Real"]);
    // Next out: Real (one vote, at 4000) before Fresh and Popular (two votes each).
    store.vote({ game: game("Another"), voter: voter(1) }, 6000, { maxGames: 3 });
    expect(names()).toEqual(["Another", "Fresh", "Popular"]);
  });

  it("never lets made-up games push a known game off a full list", () => {
    const store = new ModuleRequestStore(":memory:");
    const fake = (n: number) => ({ name: `Fake ${n}`, steamAppId: 900_000 + n, gameId: null });
    const known = { name: "Valheim", steamAppId: 892970, gameId: null };
    expect(store.vote({ game: known, voter: voter(1) }, 1000, { known: true, maxGames: 3 })).toBe(true);
    // A flood of made-up Steam ids, each with as many votes as it likes: only they make room for each other.
    for (let n = 0; n < 20; n++) {
      expect(store.vote({ game: fake(n), voter: voter(1) }, 2000 + n, { maxGames: 3 })).toBe(true);
      store.vote({ game: fake(n), voter: voter(2) }, 2000 + n, { maxGames: 3 });
      expect(store.has(known)).toBe(true);
    }
    // At the real limit too.
    const full = new ModuleRequestStore(":memory:");
    full.vote({ game: known, voter: voter(1) }, 0, { known: true });
    for (let n = 0; n < MAX_GAMES + 50; n++) full.vote({ game: fake(n), voter: voter(1) }, 1 + n);
    expect(full.has(known)).toBe(true);
    const db = (full as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db;
    expect(db.prepare("select count(*) as n from games").get()).toEqual({ n: MAX_GAMES });
  });

  it("lets a known game take only a known single-vote game's place, and refuses when none may go", () => {
    const store = new ModuleRequestStore(":memory:");
    const game = (steamAppId: number) => ({ name: `Game ${steamAppId}`, steamAppId, gameId: null });
    const steamIds = () => store.ranked().map((entry) => entry.steamAppId).sort();
    store.vote({ game: game(1), voter: voter(1) }, 1000, { known: true, maxGames: 2 });
    store.vote({ game: game(1), voter: voter(2) }, 1000, { known: true, maxGames: 2 });
    store.vote({ game: game(2), voter: voter(1) }, 2000, { known: true, maxGames: 2 });
    // A game the list doesn't know never takes a known game's place.
    expect(store.vote({ game: game(99), voter: voter(1) }, 3000, { maxGames: 2 })).toBe(false);
    expect(store.has(game(99))).toBe(false);
    // A known one takes the single-vote one's place, never the one with two votes.
    expect(store.vote({ game: game(3), voter: voter(1) }, 4000, { known: true, maxGames: 2 })).toBe(true);
    expect(steamIds()).toEqual([1, 3]);
    store.vote({ game: game(3), voter: voter(2) }, 5000, { known: true, maxGames: 2 });
    expect(store.vote({ game: game(4), voter: voter(1) }, 6000, { known: true, maxGames: 2 })).toBe(false);
    expect(steamIds()).toEqual([1, 3]);
  });

  it("knows games by the game list's Steam ids and Tavora ids, never by a name alone", () => {
    const dataset = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
    (dataset as unknown as { exec(sql: string): void }).exec("insert into games (id, name, steam_appid, built_in) values ('valheim', 'Valheim', 892970, 0)");
    const knows = gameListKnows(dataset);
    expect(knows(gameKey({ ...valheim, gameId: null }))).toBe(true);
    expect(knows(gameKey({ name: "Valheim", steamAppId: 1, gameId: "valheim" }))).toBe(false);
    expect(knows(gameKey({ name: "Elden Ring", steamAppId: null, gameId: "elden-ring" }))).toBe(true);
    expect(knows(gameKey({ name: "Elden Ring", steamAppId: null, gameId: null }))).toBe(false);
    expect(knows(gameKey({ name: "x", steamAppId: null, gameId: "made-up" }))).toBe(false);
    // Rows from before `known`, or from an older game list, are set at the start.
    const store = new ModuleRequestStore(":memory:");
    store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) });
    store.vote({ game: { name: "Siedler 3", steamAppId: null, gameId: null }, voter: voter(1) });
    store.refreshKnown(knows);
    expect(store.ranked().map((entry) => [entry.name, entry.known])).toEqual([
      ["Siedler 3", false],
      ["Valheim", true],
    ]);
  });

  it("removes one game and its votes", () => {
    const store = new ModuleRequestStore(":memory:");
    store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) });
    expect(store.remove("steam:892970")).toBe(true);
    expect(store.remove("steam:892970")).toBe(false);
    expect(store.ranked()).toEqual([]);
    // Its voters can ask again.
    store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) });
    expect(store.ranked().map((game) => game.votes)).toEqual([1]);
  });

  it("keeps nothing but the game and a code", () => {
    const store = new ModuleRequestStore(":memory:");
    store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) });
    const db = (store as unknown as { db: { prepare(sql: string): { all(): Record<string, unknown>[] } } }).db;
    expect(Object.keys(db.prepare("select * from votes").all()[0]!).sort()).toEqual(["key", "voter"]);
    expect(Object.keys(db.prepare("select * from games").all()[0]!).sort()).toEqual(["first_at", "game_id", "key", "known", "last_at", "name", "steam_appid", "votes"]);
  });
});

describe("asking through the service", () => {
  const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
  const send = (app: ReturnType<typeof createApp>, body: unknown, contentType = "application/json") =>
    app.request("http://tavora.test/v1/module-requests", { method: "POST", headers: { "content-type": contentType }, body: typeof body === "string" ? body : JSON.stringify(body) });

  it("takes a vote without a sign-in, answers 204 again for a repeat, and refuses a bad one", async () => {
    const moduleRequests = new ModuleRequestStore(":memory:");
    const app = createApp({ db, moduleRequests, moduleRequestRateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }) });
    const body = { game: valheim, voter: voter(1) };
    expect((await send(app, body)).status).toBe(204);
    expect((await send(app, body)).status).toBe(204);
    expect(moduleRequests.ranked().map((game) => game.votes)).toEqual([1]);
    expect((await send(app, { game: valheim, voter: "short" })).status).toBe(400);
    expect((await send(app, "not json")).status).toBe(400);
    expect((await send(app, body, "text/plain")).status).toBe(415);
    expect((await send(app, { game: { name: "x".repeat(2000) }, voter: voter(1) })).status).toBe(413);
    expect((await app.request("http://tavora.test/v1/module-requests")).status).toBe(404);
  });

  it("limits a client, and answers 503 without a store", async () => {
    const app = createApp({ db, moduleRequests: new ModuleRequestStore(":memory:"), moduleRequestRateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }) });
    expect((await send(app, { game: valheim, voter: voter(1) })).status).toBe(204);
    expect((await send(app, { game: valheim, voter: voter(2) })).status).toBe(204);
    const limited = await send(app, { game: valheim, voter: voter(3) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
    expect((await send(createApp({ db }), { game: valheim, voter: voter(1) })).status).toBe(503);
  });

  it("limits how many new games one client adds, but not its votes for games on the list", async () => {
    const moduleRequests = new ModuleRequestStore(":memory:");
    const app = createApp({ db, moduleRequests, moduleRequestRateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }), newGameRateLimiter: createRateLimiter({ limit: 2, windowMs: 86_400_000 }) });
    expect((await send(app, { game: { name: "One" }, voter: voter(1) })).status).toBe(204);
    expect((await send(app, { game: { name: "Two" }, voter: voter(1) })).status).toBe(204);
    expect((await send(app, { game: { name: "Three" }, voter: voter(1) })).status).toBe(429);
    expect((await send(app, { game: { name: "One" }, voter: voter(2) })).status).toBe(204);
    expect(moduleRequests.ranked().map((game) => [game.name, game.votes])).toEqual([
      ["One", 2],
      ["Two", 1],
    ]);
  });

  it("counts new games by network, so new addresses from one /48 share the cap", async () => {
    const moduleRequests = new ModuleRequestStore(":memory:");
    const app = createApp({
      db,
      moduleRequests,
      clientKey: (request) => request.headers.get("x-client") ?? "shared",
      moduleRequestRateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
      newGameRateLimiter: createRateLimiter({ limit: 1, windowMs: 86_400_000 }),
    });
    const from = (client: string, name: string) =>
      app.request("http://tavora.test/v1/module-requests", { method: "POST", headers: { "content-type": "application/json", "x-client": client }, body: JSON.stringify({ game: { name }, voter: voter(1) }) });
    expect((await from("2001:db8:1:1::/64", "One")).status).toBe(204);
    expect((await from("2001:db8:1:2::/64", "Two")).status).toBe(429);
    expect((await from("2001:db8:2:1::/64", "Two")).status).toBe(204);
    expect((await from("203.0.113.5", "Three")).status).toBe(204);
    expect((await from("203.0.113.77", "Four")).status).toBe(429);
  });

  it("marks a game the game list knows as known", async () => {
    const moduleRequests = new ModuleRequestStore(":memory:");
    const app = createApp({ db, moduleRequests, moduleRequestRateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }) });
    expect((await send(app, { game: { name: "Elden Ring", gameId: "elden-ring" }, voter: voter(1) })).status).toBe(204);
    expect((await send(app, { game: { name: "Made up", steamAppId: 123456 }, voter: voter(1) })).status).toBe(204);
    expect(moduleRequests.ranked().map((game) => [game.name, game.known]).sort()).toEqual([
      ["Elden Ring", true],
      ["Made up", false],
    ]);
  });
});

describe("the admin list", () => {
  it("needs the token and answers the ranked games", async () => {
    const state = new IconState(":memory:");
    const store = createHostedStore({ list: () => [], file: () => null }, state);
    const submissions = createSubmissions({ state, store, gameName: () => null, gamesNamed: () => [] });
    const moduleRequests = new ModuleRequestStore(":memory:");
    moduleRequests.vote({ game: { ...valheim, gameId: null }, voter: voter(1) });
    moduleRequests.vote({ game: { ...valheim, gameId: null }, voter: voter(2) });
    const token = "t0ken-".repeat(5);
    const admin = createAdminApp({ token, submissions, state, store, moduleRequests });
    const ask = (sent: string | null = token) => admin.request("http://admin.test/api/module-requests", { headers: sent === null ? {} : { "X-Admin-Token": sent } });
    expect((await ask(null)).status).toBe(401);
    expect((await ask("wrong")).status).toBe(401);
    const body = (await (await ask()).json()) as { requests: { name: string; steamAppId: number | null; gameId: string | null; votes: number; firstAt: string; lastAt: string }[] };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]).toMatchObject({ name: "Valheim", steamAppId: 892970, gameId: null, votes: 2 });
    expect((await createAdminApp({ token, submissions, state, store }).request("http://admin.test/api/module-requests", { headers: { "X-Admin-Token": token } })).status).toBe(503);
  });

  it("removes one game with the token", async () => {
    const state = new IconState(":memory:");
    const store = createHostedStore({ list: () => [], file: () => null }, state);
    const submissions = createSubmissions({ state, store, gameName: () => null, gamesNamed: () => [] });
    const moduleRequests = new ModuleRequestStore(":memory:");
    moduleRequests.vote({ game: { ...valheim, gameId: null }, voter: voter(1) });
    moduleRequests.vote({ game: { name: "Siedler 3", steamAppId: null, gameId: null }, voter: voter(1) });
    const token = "t0ken-".repeat(5);
    const remove = (app: ReturnType<typeof createAdminApp>, body: unknown, sent: string | null = token) =>
      app.request("http://admin.test/api/module-requests/remove", { method: "POST", headers: { "content-type": "application/json", ...(sent === null ? {} : { "X-Admin-Token": sent }) }, body: JSON.stringify(body) });
    const admin = createAdminApp({ token, submissions, state, store, moduleRequests });
    expect((await remove(admin, { key: "steam:892970" }, null)).status).toBe(401);
    expect((await remove(admin, { key: "steam:892970" }, "wrong")).status).toBe(401);
    expect((await remove(admin, {})).status).toBe(400);
    expect((await remove(admin, { key: "steam:1" })).status).toBe(404);
    expect((await remove(admin, { key: "steam:892970" })).status).toBe(200);
    expect(moduleRequests.ranked().map((game) => game.name)).toEqual(["Siedler 3"]);
    expect((await remove(createAdminApp({ token, submissions, state, store }), { key: "name:siedler3" })).status).toBe(503);
  });
});
