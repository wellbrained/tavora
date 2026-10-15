import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createRateLimiter } from "./rate-limit.ts";

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
    expect(await response.json()).toEqual([{ id: "elden-ring", name: "Elden Ring" }]);
  });

  it("is never cached and sets safe headers", async () => {
    const response = await get(app, "/v1/games/search?q=elden");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers an empty query with an empty list", async () => {
    expect(await (await get(app, "/v1/games/search")).json()).toEqual([]);
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
