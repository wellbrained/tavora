import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { AccountStore } from "./account-store.ts";
import { createAdminApp } from "./admin-app.ts";
import type { Probes } from "./admin-probes.ts";
import { CatalogStore } from "./catalog.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { encodePng } from "./png.ts";
import { createSubmissions } from "./submissions.ts";

const TOKEN = "t0ken-".repeat(5);
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-26T12:00:00Z");

const probes = (over: Partial<Probes> = {}): Probes => ({
  feed: async () => ({ version: "0.21.20", releasedAt: "2026-10-20T10:00:00.000Z", installerSize: 1234 }),
  site: async (url) => ({ ok: !url.includes("docs"), status: url.includes("docs") ? 502 : 200 }),
  npmVersion: async (name) => (name === "@tavora/sdk" ? "0.2.7" : "1.0.0"),
  mainVersion: async (folder) => (folder.endsWith("/sdk") ? "0.2.11" : "1.0.0"),
  ...over,
});

const state = new IconState(":memory:");
const store = createHostedStore({ list: () => [], file: () => null }, state);
const submissions = createSubmissions({ state, store, gameName: (id) => (id === "diablo-iv" ? "Diablo IV" : null), gamesNamed: () => [] });
const stateDir = mkdtempSync(path.join(tmpdir(), "tavora-admin-state-"));
const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
const accounts = new AccountStore(":memory:");

const key = generateKeyPairSync("ed25519").privateKey;
const manifest = { id: "wellbrained.timer", name: "Timer", version: "1.0.0", apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
const added = catalog.add(writeZip([...files, signFiles(files, key)]));
catalog.countInstall("wellbrained.timer");
catalog.countInstall("wellbrained.timer");
catalog.report({ id: added.manifest.id, owner: added.owner, sha256: added.sha256 });
writeFileSync(path.join(stateDir, "last-backup.txt"), "2026-10-26T03:15:04Z\n");

const early = accounts.createAccount({ email: "a@example.test" }, NOW - 40 * DAY);
const recent = accounts.createAccount({ email: "b@example.test" }, NOW - 2 * DAY);
const fresh = accounts.createAccount({ email: "c@example.test" }, NOW - 1000);
accounts.createSession(early.id, "windows", NOW - 20 * DAY);
accounts.createSession(recent.id, "linux", NOW - 3 * DAY);
accounts.createSession(fresh.id, "windows", NOW - 1000);

const make = (over: Partial<Parameters<typeof createAdminApp>[0]> = {}) =>
  createAdminApp({ token: TOKEN, submissions, state, store, catalog, accounts, probes: probes(), stateDir, mailDailyLimit: 300, dataset: () => ({ games: 25000, builtAt: "2026-10-01T00:00:00Z" }), ...over });
const ask = async (app: ReturnType<typeof createAdminApp>, route: string) => (await app.request(`http://admin.test${route}`, { headers: { "X-Admin-Token": TOKEN } })).json() as Promise<any>;
const listed = (app: ReturnType<typeof createAdminApp>, value: boolean) =>
  app.request("http://admin.test/api/catalog/listed", { method: "POST", headers: { "X-Admin-Token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ id: "wellbrained.timer", listed: value }) });

describe("the panel's own pages", () => {
  it("need the token, every one of them", async () => {
    for (const page of ["summary", "updates", "modules", "accounts", "status"]) {
      expect((await make().request(`http://admin.test/api/${page}`)).status).toBe(401);
    }
  });

  it("summarise what waits as a list of kinds, with the key numbers", async () => {
    const pixels = encodePng(32, 32, Uint8Array.from({ length: 32 * 32 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * 3) % 256)));
    submissions.submit({ id: "diablo-iv", name: "Diablo 4", source: "installed", icon: Buffer.from(pixels).toString("base64") }, "account-1");
    const summary = await ask(make(), "/api/summary");
    const counts = Object.fromEntries(summary.waiting.map((kind: { id: string; count: number }) => [kind.id, kind.count]));
    expect(counts).toEqual({ icons: 1, reports: 1, reviews: 0, keys: 0, "catalog-full": 0 });
    expect(summary.waiting.find((kind: { id: string }) => kind.id === "icons")).toMatchObject({ section: "review", tab: "pending" });
    expect(summary.numbers).toMatchObject({ modules: 1, listedModules: 1, installs: 2, accounts: 3 });
    expect(summary.numbers.catalogBytes).toBeGreaterThan(0);
  });

  it("work without a catalog or accounts", async () => {
    const bare = createAdminApp({ token: TOKEN, submissions, state, store, probes: probes() });
    expect((await ask(bare, "/api/summary")).numbers).toMatchObject({ modules: 0, accounts: null });
    expect(await ask(bare, "/api/modules")).toMatchObject({ modules: [] });
    expect(await ask(bare, "/api/accounts")).toEqual({ on: false });
    expect((await ask(bare, "/api/status")).mail).toBeNull();
  });

  it("list the app versions with their notes, marking the one on the feed", async () => {
    const updates = await ask(make(), "/api/updates");
    expect(updates.feed).toMatchObject({ version: "0.21.20" });
    const states = Object.fromEntries(updates.versions.map((version: { version: string; state: string }) => [version.version, version.state]));
    expect(states["0.21.20"]).toBe("on-feed");
    expect(Object.values(states)).toContain("waiting");
    expect(Object.values(states)).toContain("earlier");
    expect(updates.versions[0].notes.length).toBeGreaterThan(0);
    const down = await ask(make({ probes: probes({ feed: async () => null }) }), "/api/updates");
    expect(down.feed).toBeNull();
    expect(down.versions.every((version: { state: string }) => version.state === "unknown")).toBe(true);
  });

  it("list every module, listed or not, with versions, installs and storage", async () => {
    const app = make();
    await listed(app, false);
    const modules = await ask(app, "/api/modules");
    expect(modules.modules).toEqual([
      expect.objectContaining({ id: "wellbrained.timer", name: "Timer", listed: false, installs: 2, versions: [expect.objectContaining({ version: "1.0.0", zipKept: true })] }),
    ]);
    expect(modules.modules[0].storedBytes).toBe(modules.storedBytes);
    expect(modules.limitBytes).toBeGreaterThan(modules.storedBytes);
    await listed(app, true);
    expect((await ask(app, "/api/modules")).modules[0].listed).toBe(true);
  });

  it("count accounts without naming one", async () => {
    const counts = await ask(make(), "/api/accounts");
    expect(counts.on).toBe(true);
    expect(counts.total).toBe(3);
    expect(counts.perDay).toHaveLength(30);
    expect(counts.perDay.reduce((sum: number, entry: { count: number }) => sum + entry.count, 0)).toBe(2);
    expect(JSON.stringify(counts)).not.toContain("example.test");
    expect(Object.keys(counts).sort()).toEqual(["active30", "active7", "on", "perDay", "total"]);
  });

  it("report health, mail, backup, storage, sites and package versions", async () => {
    const status = await ask(make(), "/api/status");
    expect(status.api).toEqual({ ok: true, games: 25000, builtAt: "2026-10-01T00:00:00Z" });
    expect(status.mail).toMatchObject({ limit: 300, sent: expect.any(Number) });
    expect(status.backup).toEqual({ at: "2026-10-26T03:15:04.000Z" });
    expect(status.catalog).toMatchObject({ fullSince: null });
    expect(status.sites).toEqual([
      { name: "mytavora.app", ok: true, status: 200 },
      { name: "docs.mytavora.app", ok: false, status: 502 },
      { name: "updates.mytavora.app", ok: true, status: 200 },
    ]);
    expect(status.packages.find((entry: { name: string }) => entry.name === "@tavora/sdk")).toEqual({ name: "@tavora/sdk", npm: "0.2.7", main: "0.2.11", mainAhead: true });
    expect(status.packages.filter((entry: { mainAhead: boolean }) => entry.mainAhead)).toHaveLength(1);
  });

  it("cope with a missing backup time and with sources that do not answer", async () => {
    const down = probes({ feed: async () => null, site: async () => ({ ok: false, status: null }), npmVersion: async () => null, mainVersion: async () => null });
    const status = await ask(make({ stateDir: mkdtempSync(path.join(tmpdir(), "tavora-empty-")), probes: down }), "/api/status");
    expect(status.backup).toEqual({ at: null });
    expect(status.packages.every((entry: { mainAhead: boolean; npm: null }) => !entry.mainAhead && entry.npm === null)).toBe(true);
    expect(status.sites.every((site: { ok: boolean }) => !site.ok)).toBe(true);
  });
});
