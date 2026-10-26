import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { isAppVersion, StatsStore, statsRange, utcDay } from "./stats.ts";

const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

describe("daily counts", () => {
  it("counts per UTC day, kind and key, and charts them with zeros for quiet days", () => {
    const stats = new StatsStore(":memory:");
    stats.count("app-installer", "0.21.28", at("2026-10-24T23:59:59Z"));
    stats.count("app-installer", "0.21.28", at("2026-10-25T00:00:00Z"));
    stats.count("app-installer", "0.21.28", at("2026-10-25T10:00:00Z"));
    stats.count("module-update", "wellbrained.timer", at("2026-10-26T01:00:00Z"));
    const series = stats.series("2026-10-24", "2026-10-26");
    expect(series.days).toEqual(["2026-10-24", "2026-10-25", "2026-10-26"]);
    expect(series.counts["app-installer"]).toEqual({ "0.21.28": [1, 2, 0] });
    expect(series.counts["module-update"]).toEqual({ "wellbrained.timer": [0, 0, 1] });
    expect(series.counts["app-update"]).toEqual({});
    expect(series.totals["app-installer"]).toEqual({ "0.21.28": 3 });
    expect(series.accounts).toEqual([null, null, null]);
  });

  it("stops taking new names for a kind on a day once there are too many, but keeps counting known ones", () => {
    const stats = new StatsStore(":memory:");
    const now = at("2026-10-26T00:00:00Z");
    for (let i = 0; i < 500; i++) expect(stats.count("module-install", `m${i}`, now)).toBe(true);
    expect(stats.count("module-install", "extra", now)).toBe(false);
    expect(stats.count("module-install", "m0", now)).toBe(true);
    expect(stats.count("module-update", "extra", now)).toBe(true);
  });

  it("writes one account snapshot a day, the first of the day", () => {
    const stats = new StatsStore(":memory:");
    const morning = at("2026-10-26T03:00:00Z");
    expect(stats.hasSnapshot(morning)).toBe(false);
    expect(stats.snapshotAccounts({ total: 5, active7: 3, active30: 4 }, morning)).toBe(true);
    expect(stats.snapshotAccounts({ total: 9, active7: 9, active30: 9 }, morning + 3600_000)).toBe(false);
    expect(stats.hasSnapshot(morning)).toBe(true);
    stats.snapshotAccounts({ total: 6, active7: 3, active30: 5 }, morning + DAY);
    expect(stats.series("2026-10-26", "2026-10-28").accounts).toEqual([{ total: 5, active7: 3, active30: 4 }, { total: 6, active7: 3, active30: 5 }, null]);
  });

  it("keeps the numbers in a file that survives a restart", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tavora-stats-")), "state", "stats.sqlite");
    const first = new StatsStore(file);
    first.count("app-update", "0.21.28", at("2026-10-26T00:00:00Z"));
    first.close();
    expect(new StatsStore(file).series("2026-10-26", "2026-10-26").totals["app-update"]).toEqual({ "0.21.28": 1 });
  });
});

describe("the range", () => {
  const now = at("2026-10-26T12:00:00Z");
  it("is the last 30 days by default, or ?days, or ?from and ?to", () => {
    expect(statsRange({}, now)).toEqual({ from: "2026-09-27", to: "2026-10-26" });
    expect(statsRange({ days: "1" }, now)).toEqual({ from: "2026-10-26", to: "2026-10-26" });
    expect(statsRange({ from: "2026-10-01", to: "2026-10-05" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    expect(statsRange({ from: "2026-10-01" }, now)).toEqual({ from: "2026-10-01", to: "2026-10-26" });
  });
  it("refuses what makes no sense", () => {
    for (const query of [{ days: "0" }, { days: "731" }, { days: "x" }, { from: "2026-10-05", to: "2026-10-01" }, { from: "2026-02-31", to: "2026-03-01" }, { to: "2026-10-01" }, { from: "2020-01-01" }]) {
      expect(statsRange(query, now)).toBeNull();
    }
    expect(utcDay(now)).toBe("2026-10-26");
    expect(isAppVersion("0.21.28")).toBe(true);
    expect(isAppVersion("0.21.28-beta")).toBe(false);
    expect(isAppVersion("../x")).toBe(false);
  });
});

describe("account activity", () => {
  it("counts accounts and those with a sign-in used lately, each account once, naming nobody", () => {
    const store = new AccountStore(":memory:");
    const now = at("2026-10-26T12:00:00Z");
    const a = store.createAccount({ email: "a@example.com" }, now - 100 * DAY);
    const b = store.createAccount({ email: "b@example.com" }, now - 100 * DAY);
    store.createAccount({ email: "c@example.com" }, now - 100 * DAY);
    store.createSession(a.id, "windows", now - 2 * DAY);
    store.createSession(a.id, "linux", now - 3 * DAY);
    store.createSession(b.id, "windows", now - 20 * DAY);
    expect(store.activity(now)).toEqual({ total: 3, active7: 1, active30: 2 });
  });
});

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

function moduleZip(key: KeyObject): Buffer {
  const manifest = { id: "wellbrained.timer", name: "Timer", version: "1.0.0", apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

describe("counting through the service", () => {
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
  catalog.add(moduleZip(generateKeyPairSync("ed25519").privateKey));
  const stats = new StatsStore(":memory:");
  const app = createApp({ db, catalog, stats, rateLimiter: roomy() });
  const post = (route: string, body: unknown) => app.request(`http://tavora.test${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const today = () => stats.series(utcDay(Date.now()), utcDay(Date.now()));

  it("counts a module install and a module update apart, only for a listed module", async () => {
    expect((await post("/v1/catalog/installed", { id: "wellbrained.timer" })).status).toBe(204);
    expect((await post("/v1/catalog/updated", { id: "wellbrained.timer" })).status).toBe(204);
    expect((await post("/v1/catalog/updated", { id: "wellbrained.timer" })).status).toBe(204);
    expect((await post("/v1/catalog/updated", { id: "nobody.nothing" })).status).toBe(404);
    expect((await post("/v1/catalog/updated", { id: 5 })).status).toBe(404);
    expect(today().totals["module-install"]).toEqual({ "wellbrained.timer": 1 });
    expect(today().totals["module-update"]).toEqual({ "wellbrained.timer": 2 });
    expect(catalog.installCount("wellbrained.timer")).toBe(1);
  });

  it("counts an app update by version and refuses anything else", async () => {
    expect((await post("/v1/app/updated", { version: "0.21.29" })).status).toBe(204);
    expect((await post("/v1/app/updated", { version: "evil<script>" })).status).toBe(400);
    expect((await post("/v1/app/updated", {})).status).toBe(400);
    expect(today().totals["app-update"]).toEqual({ "0.21.29": 1 });
  });

  it("counts an installer download from the address the feed web server forwards, and always lets it go on", async () => {
    const forwarded = (uri: string) => app.request("http://tavora.test/internal/installer-download", { headers: { "X-Forwarded-Uri": uri, "X-Forwarded-For": "203.0.113.9" } });
    expect((await forwarded("/Tavora-Setup-0.21.28.exe")).status).toBe(204);
    expect((await forwarded("/Tavora-Setup-0.21.28.exe")).status).toBe(204);
    expect((await forwarded("/other.exe")).status).toBe(204);
    expect((await forwarded("/Tavora-Setup-1.2.exe")).status).toBe(204);
    expect(today().totals["app-installer"]).toEqual({ "0.21.28": 2 });
  });

  it("keeps nothing but numbers", () => {
    const rows = (stats as unknown as { db: { prepare(sql: string): { all(): Record<string, unknown>[] } } }).db.prepare("select * from daily_counts").all();
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(["count", "day", "key", "kind"]);
    expect(JSON.stringify(rows)).not.toContain("203.0.113");
  });

  it("works without a stats store (nothing is counted)", async () => {
    const plain = createApp({ db, catalog, rateLimiter: roomy() });
    const response = await plain.request("http://tavora.test/v1/app/updated", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "0.21.29" }) });
    expect(response.status).toBe(204);
  });
});

describe("the admin stats route", () => {
  it("answers the series for charts, needs the token, and refuses a bad range", async () => {
    const { createAdminApp } = await import("./admin-app.ts");
    const { createHostedStore } = await import("./hosted-store.ts");
    const { IconState } = await import("./icon-state.ts");
    const { createSubmissions } = await import("./submissions.ts");
    const state = new IconState(":memory:");
    const store = createHostedStore({ list: () => [], file: () => null }, state);
    const submissions = createSubmissions({ state, store, gameName: () => null, gamesNamed: () => [] });
    const stats = new StatsStore(":memory:");
    stats.count("app-installer", "0.21.28");
    stats.snapshotAccounts({ total: 4, active7: 2, active30: 3 });
    const token = "t0ken-".repeat(5);
    const admin = createAdminApp({ token, submissions, state, store, stats });
    const ask = (query: string, sent: string | null = token) => admin.request(`http://admin.test/api/stats${query}`, { headers: sent === null ? {} : { "X-Admin-Token": sent } });

    expect((await ask("", null)).status).toBe(401);
    const body = (await (await ask("?days=3")).json()) as { from: string; to: string; days: string[]; counts: Record<string, Record<string, number[]>>; totals: Record<string, Record<string, number>>; accounts: unknown[] };
    expect(body.days).toHaveLength(3);
    expect(body.to).toBe(utcDay(Date.now()));
    expect(body.counts["app-installer"]!["0.21.28"]).toEqual([0, 0, 1]);
    expect(body.totals["app-installer"]).toEqual({ "0.21.28": 1 });
    expect(body.accounts).toEqual([null, null, { total: 4, active7: 2, active30: 3 }]);
    expect((await ask("?days=9999")).status).toBe(400);
    expect((await ask("?from=2026-13-01")).status).toBe(400);

    const off = createAdminApp({ token, submissions, state, store });
    expect((await off.request("http://admin.test/api/stats", { headers: { "X-Admin-Token": token } })).status).toBe(503);
  });
});
