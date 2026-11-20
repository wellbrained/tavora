import { describe, expect, it } from "vitest";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { gameKey, MAX_GAMES, ModuleRequestStore, parseRequest } from "./module-requests.ts";
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
    store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) }, now);
    // The same install again: nothing changes.
    store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) }, now + 1000);
    store.vote({ game: { name: "VALHEIM", steamAppId: 892970, gameId: "valheim" }, voter: voter(2) }, now + 2000);
    store.vote({ game: { name: "Siedler 3", steamAppId: null, gameId: null }, voter: voter(1) }, now + 3000);
    expect(store.ranked()).toEqual([
      { key: "steam:892970", name: "Valheim", steamAppId: 892970, gameId: "valheim", votes: 2, firstAt: "2026-11-01T10:00:00.000Z", lastAt: "2026-11-01T10:00:02.000Z" },
      { key: "name:siedler3", name: "Siedler 3", steamAppId: null, gameId: null, votes: 1, firstAt: "2026-11-01T10:00:03.000Z", lastAt: "2026-11-01T10:00:03.000Z" },
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
    store.vote({ game: game("Real"), voter: voter(1) }, 4000, 3);
    expect(names()).toEqual(["Fresh", "Popular", "Real"]);
    expect(store.has(game("Stale"))).toBe(false);
    const db = (store as unknown as { db: { prepare(sql: string): { get(...values: unknown[]): unknown } } }).db;
    expect(db.prepare("select count(*) as n from votes where key = ?").get("name:stale")).toEqual({ n: 0 });
    // A vote for a game on the list takes nobody's place.
    store.vote({ game: game("Fresh"), voter: voter(2) }, 5000, 3);
    expect(names()).toEqual(["Fresh", "Popular", "Real"]);
    // Next out: Real (one vote, at 4000) before Fresh and Popular (two votes each).
    store.vote({ game: game("Another"), voter: voter(1) }, 6000, 3);
    expect(names()).toEqual(["Another", "Fresh", "Popular"]);
  });

  it("never refuses a new game at the real limit", () => {
    const store = new ModuleRequestStore(":memory:");
    for (let i = 0; i < MAX_GAMES; i++) store.vote({ game: { name: `Made up ${i}`, steamAppId: null, gameId: null }, voter: voter(1) }, 1000 + i);
    store.vote({ game: { ...valheim, gameId: null }, voter: voter(2) }, 1_000_000);
    expect(store.has({ ...valheim, gameId: null })).toBe(true);
    expect(store.has({ name: "Made up 0", steamAppId: null, gameId: null })).toBe(false);
    const db = (store as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db;
    expect(db.prepare("select count(*) as n from games").get()).toEqual({ n: MAX_GAMES });
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
    expect(Object.keys(db.prepare("select * from games").all()[0]!).sort()).toEqual(["first_at", "game_id", "key", "last_at", "name", "steam_appid", "votes"]);
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
