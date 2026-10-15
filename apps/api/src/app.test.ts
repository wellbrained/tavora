import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { SteamError, type SteamClient } from "./steam.ts";

const db = writeDatabase(
  ":memory:",
  buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }),
  new Date("2026-10-15T00:00:00Z"),
);

const get = (app: ReturnType<typeof createApp>, path: string) => app.request(`http://tavora.test${path}`);

describe("search endpoint", () => {
  const app = createApp({ db });

  it("returns matching games as id and name", async () => {
    const response = await get(app, "/v1/games/search?q=elden");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [{ id: "elden-ring", name: "Elden Ring" }] });
  });

  it("is never cached and sets safe headers", async () => {
    const response = await get(app, "/v1/games/search?q=elden");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers an empty query with an empty list", async () => {
    expect(await (await get(app, "/v1/games/search")).json()).toEqual({ results: [] });
  });

  it.each(["0", "21", "-1", "1.5", "abc"])("refuses limit=%s", async (limit) => {
    expect((await get(app, `/v1/games/search?q=e&limit=${limit}`)).status).toBe(400);
  });

  it("refuses a query over 100 characters", async () => {
    expect((await get(app, `/v1/games/search?q=${"a".repeat(101)}`)).status).toBe(400);
  });

  it("reports health and the dataset", async () => {
    expect(await (await get(app, "/v1/health")).json()).toEqual({
      ok: true,
      games: 1,
      builtAt: "2026-10-15T00:00:00.000Z",
    });
  });

  it("answers unknown paths with 404 and only GET is routed", async () => {
    expect((await get(app, "/v2/games")).status).toBe(404);
    expect((await app.request("http://tavora.test/v1/games/search?q=e", { method: "POST" })).status).toBe(404);
  });
});

describe("steam library endpoint", () => {
  const steamDb = writeDatabase(
    ":memory:",
    buildDataset({
      builtIns: [{ id: "elden-ring", name: "Elden Ring" }],
      wikidata: [{ qid: "Q1", label: "Elden Ring", aliases: [], steamAppId: 1245620 }],
      steam: [],
    }),
  );
  const client: SteamClient = {
    ownedGames: async (profile) => {
      if (profile === "private") throw new SteamError(502, "Check that Game details are public.");
      return [
        { appid: 1245620, name: "ELDEN RING" },
        { appid: 999, name: "Unknown Game" },
      ];
    },
  };
  const post = (app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
    app.request("http://tavora.test/v1/steam/library", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("returns owned games with their canonical id, or null when the database does not know them", async () => {
    const response = await post(createApp({ db: steamDb, steam: client }), { profile: "76561197960287930" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      games: [
        { appid: 1245620, name: "ELDEN RING", id: "elden-ring" },
        { appid: 999, name: "Unknown Game", id: null },
      ],
    });
  });

  it("answers 503 without a Steam key", async () => {
    expect((await post(createApp({ db: steamDb }), { profile: "76561197960287930" })).status).toBe(503);
  });

  it("passes on Steam's and the player's errors with their status", async () => {
    const app = createApp({ db: steamDb, steam: client });
    const response = await post(app, { profile: "private" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Check that Game details are public." });
  });

  it("refuses anything that is not JSON with a profile text", async () => {
    const app = createApp({ db: steamDb, steam: client, steamRateLimiter: createRateLimiter({ limit: 100, windowMs: 60_000 }) });
    expect((await post(app, { profile: "x" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(app, "{ not json")).status).toBe(400);
    expect((await post(app, {})).status).toBe(400);
    expect((await post(app, { profile: 5 })).status).toBe(400);
    expect((await post(app, { profile: "" })).status).toBe(400);
    expect((await post(app, { profile: "x".repeat(201) })).status).toBe(400);
    expect((await post(app, { profile: "x", padding: "y".repeat(2000) })).status).toBe(400);
  });

  it("is not routed for GET, and has its own, stricter limit", async () => {
    const app = createApp({ db: steamDb, steam: client, steamRateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }) });
    expect((await app.request("http://tavora.test/v1/steam/library")).status).toBe(404);
    expect((await post(app, { profile: "76561197960287930" })).status).toBe(200);
    expect((await post(app, { profile: "76561197960287930" })).status).toBe(200);
    const blocked = await post(app, { profile: "76561197960287930" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
    // Searching is not affected by the Steam limit.
    expect((await get(app, "/v1/games/search?q=elden")).status).toBe(200);
  });
});

describe("rate limit", () => {
  it("answers 429 with Retry-After once a client is over the limit, and counts clients apart", async () => {
    const app = createApp({
      db,
      rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }),
      clientKey: (request) => request.headers.get("x-client") ?? "none",
    });
    const call = (client: string) =>
      app.request("http://tavora.test/v1/games/search?q=e", { headers: { "x-client": client } });

    expect((await call("a")).status).toBe(200);
    expect((await call("a")).status).toBe(200);
    const blocked = await call("a");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await call("b")).status).toBe(200);
  });

  it("lets a client back in once the window has passed", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("x", 0)).toBe(0);
    expect(limiter.check("x", 10)).toBeGreaterThan(0);
    expect(limiter.check("x", 1001)).toBe(0);
  });
});
