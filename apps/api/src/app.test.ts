import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { createTestInbox } from "./mail.ts";
import { encodePng } from "./png.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createSubmissions } from "./submissions.ts";
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
    expect(await response.json()).toEqual({ results: [{ id: "elden-ring", name: "Elden Ring", steamAppId: null }] });
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
      if (profile === "private") throw new SteamError(502, "no-game-list", "Check that Game details are public.");
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

  it("passes on Steam's and the user's errors with their status", async () => {
    const app = createApp({ db: steamDb, steam: client });
    const response = await post(app, { profile: "private" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Check that Game details are public.", code: "no-game-list" });
  });

  it("names the reason of every refusal with a stable code next to the English message", async () => {
    const app = createApp({ db: steamDb, steam: client, steamRateLimiter: createRateLimiter({ limit: 100, windowMs: 60_000 }) });
    const reason = async (response: Response) => ({ status: response.status, body: (await response.json()) as { error: string; code: string } });
    expect(await reason(await post(app, { profile: "x" }, { "content-type": "text/plain" }))).toMatchObject({ status: 415, body: { code: "bad-request" } });
    expect(await reason(await post(app, {}))).toMatchObject({ status: 400, body: { code: "bad-request" } });
    expect(await reason(await post(app, { profile: "x", padding: "y".repeat(2000) }))).toMatchObject({ status: 413, body: { code: "bad-request" } });
    expect(await reason(await post(createApp({ db: steamDb }), { profile: "x" }))).toMatchObject({ status: 503, body: { code: "unavailable" } });
    const limited = createApp({ db: steamDb, steam: client, steamRateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }) });
    await post(limited, { profile: "76561197960287930" });
    expect(await reason(await post(limited, { profile: "76561197960287930" }))).toMatchObject({ status: 429, body: { error: "Too many requests.", code: "too-many" } });
  });

  it("refuses anything that is not JSON with a profile text", async () => {
    const app = createApp({ db: steamDb, steam: client, steamRateLimiter: createRateLimiter({ limit: 100, windowMs: 60_000 }) });
    expect((await post(app, { profile: "x" }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await post(app, "{ not json")).status).toBe(400);
    expect((await post(app, {})).status).toBe(400);
    expect((await post(app, { profile: 5 })).status).toBe(400);
    expect((await post(app, { profile: "" })).status).toBe(400);
    expect((await post(app, { profile: "x".repeat(201) })).status).toBe(400);
    expect((await post(app, { profile: "x", padding: "y".repeat(2000) })).status).toBe(413);
  });

  it("stops reading a body bigger than a profile could be, declared or streamed", async () => {
    const app = createApp({ db: steamDb, steam: client, steamRateLimiter: createRateLimiter({ limit: 100, windowMs: 60_000 }) });
    const big = JSON.stringify({ profile: "x", padding: "y".repeat(10 * 1024 * 1024) });
    expect((await post(app, big)).status).toBe(413);
    // No Content-Length: the limit counts while the body streams in.
    const bytes = new TextEncoder().encode(big);
    const stream = new ReadableStream({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 64 * 1024) controller.enqueue(bytes.subarray(at, at + 64 * 1024));
        controller.close();
      },
    });
    const streamed = await app.request("http://tavora.test/v1/steam/library", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
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


describe("icon endpoints", () => {
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const icons = {
    list: () => [{ id: "diablo-iv", names: ["Diablo IV", "Diablo 4"], sha256: "a".repeat(64), size: png.byteLength }],
    file: (id: string) => (id === "diablo-iv" ? png : null),
  };
  const app = createApp({ db, icons, takedownContact: " legal@example.test " });

  it("lists the icons with the notice and where to ask for a removal", async () => {
    const response = await get(app, "/v1/icons");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { notice: string; takedown: string; icons: unknown[] };
    expect(body.takedown).toBe("legal@example.test");
    expect(body.notice).toMatch(/not affiliated with, endorsed by or sponsored by/);
    expect(body.notice).toMatch(/trademarks/);
    expect(body.icons).toEqual(icons.list());
  });

  it("serves an icon file unchanged, as the same for everyone, and may be cached", async () => {
    const response = await get(app, "/v1/icons/diablo-iv.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect((await get(app, "/v1/icons")).headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("answers 404 for an icon that is not hosted and for names that are not an id with .png", async () => {
    for (const path of ["/v1/icons/other.png", "/v1/icons/diablo-iv", "/v1/icons/diablo-iv.jpg", "/v1/icons/Diablo-IV.png", "/v1/icons/..%2Fx.png", "/v1/icons/a.b.png"]) {
      expect((await get(app, path)).status).toBe(404);
    }
  });

  it("offers nothing without a takedown contact", async () => {
    for (const contact of [undefined, "", "   "]) {
      const unmanned = createApp({ db, icons, ...(contact === undefined ? {} : { takedownContact: contact }) });
      expect((await get(unmanned, "/v1/icons")).status).toBe(503);
      expect((await get(unmanned, "/v1/icons/diablo-iv.png")).status).toBe(404);
    }
  });

  it("lists no icons when none are hosted, and rate-limits like the rest", async () => {
    const empty = createApp({ db, takedownContact: "legal@example.test", rateLimiter: createRateLimiter({ limit: 2, windowMs: 60_000 }) });
    expect(await (await get(empty, "/v1/icons")).json()).toMatchObject({ icons: [] });
    await get(empty, "/v1/icons");
    const limited = await get(empty, "/v1/icons/diablo-iv.png");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("leaves everything else uncached, and only GET is routed", async () => {
    expect((await get(app, "/v1/games/search?q=elden")).headers.get("cache-control")).toBe("no-store");
    expect((await get(app, "/v2/icons")).headers.get("cache-control")).toBe("no-store");
    expect((await app.request("http://tavora.test/v1/icons", { method: "POST" })).status).toBe(404);
  });
});

describe("icon offers", () => {
  const picture = (size: number) => Uint8Array.from({ length: size * size * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
  const icon = (size = 32) => Buffer.from(encodePng(size, size, picture(size))).toString("base64");
  const accountStore = new AccountStore(":memory:");
  const account = accountStore.createAccount({ email: "user@example.test" }, Date.now());
  const { token } = accountStore.createSession(account.id, "windows", Date.now());
  const setup = (options: { contact?: string; limit?: number; accounts?: boolean } = {}) => {
    const state = new IconState(":memory:");
    const store = createHostedStore({ list: () => [], file: () => null }, state);
    const submissions = createSubmissions({ state, store, gameName: (id) => (id === "elden-ring" ? "Elden Ring" : null), gamesNamed: () => [] });
    const app = createApp({
      db,
      icons: store,
      submissions,
      ...(options.contact === undefined ? {} : { takedownContact: options.contact }),
      ...(options.accounts === false ? {} : { accounts: { store: accountStore, mailer: createTestInbox() } }),
      submitRateLimiter: createRateLimiter({ limit: options.limit ?? 100, windowMs: 3_600_000 }),
    });
    return { app, state };
  };
  const post = (app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` }) =>
    app.request("http://tavora.test/v1/icons/submit", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const offer = (over: Record<string, unknown> = {}) => ({ id: "elden-ring", name: "Elden Ring", source: "installed", icon: icon(), ...over });

  it("takes an offer, answers 202 and queues it, serving nothing yet", async () => {
    const { app, state } = setup({ contact: "legal@example.test" });
    const response = await post(app, offer());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "received" });
    expect(state.pendingCount()).toBe(1);
    expect(state.pendingSender(state.listPending()[0]!.sha256)).toBe(account.id);
    expect(await (await get(app, "/v1/icons")).json()).toMatchObject({ icons: [] });
    expect((await get(app, "/v1/icons/elden-ring.png")).status).toBe(404);
  });

  it("is never cached, and only POST is routed", async () => {
    const { app } = setup({ contact: "legal@example.test" });
    expect((await post(app, offer())).headers.get("cache-control")).toBe("no-store");
    expect((await get(app, "/v1/icons/submit")).status).toBe(404);
  });

  it("offers nothing without a takedown contact, the review queue or accounts", async () => {
    expect((await post(setup().app, offer())).status).toBe(503);
    const bare = createApp({ db, takedownContact: "legal@example.test" });
    expect((await post(bare, offer())).status).toBe(503);
    expect((await post(setup({ contact: "legal@example.test", accounts: false }).app, offer())).status).toBe(503);
  });

  it("takes offers only from a signed-in user", async () => {
    const { app, state } = setup({ contact: "legal@example.test" });
    for (const authorization of [undefined, "Bearer nope", `Bearer ${"x".repeat(40)}`, token]) {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...(authorization ? { Authorization: authorization } : {}) };
      const response = await post(app, offer(), headers);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ reason: "signed-out" });
    }
    expect(state.pendingCount()).toBe(0);
  });

  it("wants JSON, and answers what is wrong with an offer", async () => {
    const { app, state } = setup({ contact: "legal@example.test" });
    expect((await post(app, offer(), { "Content-Type": "text/plain", Authorization: `Bearer ${token}` })).status).toBe(415);
    expect((await post(app, offer(), { Authorization: `Bearer ${token}` })).status).toBe(415);
    expect((await post(app, "{ nope")).status).toBe(400);
    expect((await post(app, offer({ id: "not-a-game" }))).status).toBe(400);
    expect((await post(app, offer({ icon: "AAAA" }))).status).toBe(400);
    expect((await post(app, offer({ icon: icon(16) }))).status).toBe(400);
    expect((await post(app, { id: "elden-ring" })).status).toBe(400);
    expect(state.pendingCount()).toBe(0);
  });

  it("refuses a body over 400 KB before reading it", async () => {
    const { app, state } = setup({ contact: "legal@example.test" });
    const response = await post(app, offer({ icon: "A".repeat(500_000) }));
    expect(response.status).toBe(413);
    expect(state.pendingCount()).toBe(0);
  });

  it("limits how many offers one client can make in an hour", async () => {
    const { app } = setup({ contact: "legal@example.test", limit: 2 });
    await post(app, offer());
    await post(app, offer());
    const limited = await post(app, offer());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("does not echo anything the user sent", async () => {
    const { app } = setup({ contact: "legal@example.test" });
    const response = await post(app, offer({ name: "SECRET-NAME", icon: "bad icon SECRET" }));
    expect(await response.text()).not.toMatch(/SECRET/);
  });
});