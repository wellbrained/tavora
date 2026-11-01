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
    expect(store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) }, now)).toBe(true);
    // The same install again: nothing changes, still a success.
    expect(store.vote({ game: { ...valheim, gameId: null }, voter: voter(1) }, now + 1000)).toBe(true);
    expect(store.vote({ game: { name: "VALHEIM", steamAppId: 892970, gameId: "valheim" }, voter: voter(2) }, now + 2000)).toBe(true);
    store.vote({ game: { name: "Siedler 3", steamAppId: null, gameId: null }, voter: voter(1) }, now + 3000);
    expect(store.ranked()).toEqual([
      { name: "Valheim", steamAppId: 892970, gameId: "valheim", votes: 2, firstAt: "2026-11-01T10:00:00.000Z", lastAt: "2026-11-01T10:00:02.000Z" },
      { name: "Siedler 3", steamAppId: null, gameId: null, votes: 1, firstAt: "2026-11-01T10:00:03.000Z", lastAt: "2026-11-01T10:00:03.000Z" },
    ]);
  });

  it("puts the latest vote first among equal counts, and stops taking new games when the list is full", () => {
    const store = new ModuleRequestStore(":memory:");
    store.vote({ game: { name: "Old", steamAppId: null, gameId: null }, voter: voter(1) }, 1000);
    store.vote({ game: { name: "New", steamAppId: null, gameId: null }, voter: voter(1) }, 2000);
    expect(store.ranked().map((game) => game.name)).toEqual(["New", "Old"]);
    for (let i = 0; i < MAX_GAMES - 2; i++) store.vote({ game: { name: `Game ${i}`, steamAppId: null, gameId: null }, voter: voter(1) });
    expect(store.vote({ game: { name: "One too many", steamAppId: null, gameId: null }, voter: voter(1) })).toBe(false);
    expect(store.vote({ game: { name: "Old", steamAppId: null, gameId: null }, voter: voter(2) })).toBe(true);
    expect(store.ranked(3)).toHaveLength(3);
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
});
