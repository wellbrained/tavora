import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { isBot, referrerDomain } from "./site-visits.ts";
import { StatsStore, utcDay } from "./stats.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

describe("where a site visit came from", () => {
  it("keeps only the domain, without www., and calls a missing or odd one direct", () => {
    expect(referrerDomain("https://www.reddit.com/r/pcgaming/comments/abc?x=1")).toBe("reddit.com");
    expect(referrerDomain("https://discord.com/")).toBe("discord.com");
    expect(referrerDomain("http://Google.DE")).toBe("google.de");
    expect(referrerDomain("")).toBe("direct");
    expect(referrerDomain(undefined)).toBe("direct");
    expect(referrerDomain("android-app://com.google.android.gm/")).toBe("direct");
    expect(referrerDomain("not a url")).toBe("direct");
    expect(referrerDomain("https://localhost:3000/")).toBe("direct");
    expect(referrerDomain(`https://${"a".repeat(120)}.com/`)).toBe("direct");
  });

  it("skips the site itself, so moving around in it is no new visit", () => {
    expect(referrerDomain("https://mytavora.app/privacy/")).toBeNull();
    expect(referrerDomain("https://docs.mytavora.app/guide/")).toBeNull();
  });

  it("tells programs that say they are one from browsers", () => {
    expect(isBot(BROWSER)).toBe(false);
    for (const agent of ["Googlebot/2.1", "Mozilla/5.0 (compatible; bingbot/2.0)", "HeadlessChrome/141", "curl/8.4", "Discordbot/2.0", undefined]) expect(isBot(agent)).toBe(true);
  });
});

describe("counting site visits through the service", () => {
  const setup = (countryOf?: (request: Request) => string | null, limit = 1000) => {
    const stats = new StatsStore(":memory:");
    const app = createApp({ db, stats, rateLimiter: createRateLimiter({ limit: 1000, windowMs: 60_000 }), siteRateLimiter: createRateLimiter({ limit, windowMs: 60_000 }), ...(countryOf ? { countryOf } : {}) });
    const send = (body: unknown, headers: Record<string, string> = {}) =>
      app.request("http://tavora.test/v1/site/visit", { method: "POST", headers: { origin: "https://mytavora.app", "user-agent": BROWSER, "content-type": "text/plain;charset=UTF-8", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
    const today = () => stats.series(utcDay(Date.now()), utcDay(Date.now())).totals;
    return { stats, send, today };
  };

  it("counts a view by where it came from and by country, and a click by link", async () => {
    const { send, today } = setup((request) => (request.headers.get("x-test-country") ?? null));
    for (const response of [
      await send({ referrer: "https://www.reddit.com/r/x" }, { "x-test-country": "DE" }),
      await send({ referrer: "" }, { "x-test-country": "US" }),
      await send({ referrer: "" }),
      await send({ click: "download" }),
      await send({ click: "docs" }),
    ]) {
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe("https://mytavora.app");
    }
    expect(today()["site-view"]).toEqual({ "reddit.com": 1, direct: 2 });
    expect(today()["site-country"]).toEqual({ DE: 1, US: 1, unknown: 1 });
    expect(today()["site-click"]).toEqual({ download: 1, docs: 1 });
  });

  it("counts nothing from another site, a bot, the site itself, an unknown link or a broken body, and always answers 204", async () => {
    const { send, today } = setup();
    const answers = [
      await send({ referrer: "" }, { origin: "https://evil.example" }),
      await send({ referrer: "" }, { "user-agent": "Googlebot/2.1" }),
      await send({ referrer: "https://mytavora.app/" }),
      await send({ click: "evil" }),
      await send({ click: { toString: "download" } }),
      await send("{not json"),
      await send([1, 2]),
    ];
    for (const response of answers) expect(response.status).toBe(204);
    expect(today()["site-view"]).toEqual({});
    expect(today()["site-country"]).toEqual({});
    expect(today()["site-click"]).toEqual({});
  });

  it("stops counting a client that sends too many, without telling it", async () => {
    const { send, today } = setup(undefined, 2);
    for (let i = 0; i < 4; i++) expect((await send({ referrer: "" })).status).toBe(204);
    expect(today()["site-view"]).toEqual({ direct: 2 });
  });

  it("reads nothing bigger than a visit", async () => {
    const { send } = setup();
    expect((await send({ referrer: `https://example.com/${"x".repeat(3000)}` })).status).toBe(413);
  });
});
