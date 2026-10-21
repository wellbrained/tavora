import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox, type Mailer } from "./mail.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter, type RateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);

function moduleZip(key: KeyObject, version = "1.0.0"): Buffer {
  const manifest = { id: "wellbrained.timer", name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup(options: { mailer?: Mailer; mailDailyLimit?: number; linked?: boolean; reportRateLimiter?: RateLimiter } = {}) {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
  const clock = { now: Date.parse("2026-10-18T12:00:00Z") };
  const inbox = createTestInbox();
  const key = generateKeyPairSync("ed25519").privateKey;
  const added = catalog.add(moduleZip(key));
  if (options.linked !== false) {
    const account = store.createAccount({ email: "dev@example.com" }, clock.now);
    store.linkKey(account.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
  }
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    reportRateLimiter: options.reportRateLimiter ?? roomy(),
    accounts: { store, mailer: options.mailer ?? inbox, now: () => clock.now, ...(options.mailDailyLimit === undefined ? {} : { mailDailyLimit: options.mailDailyLimit }) },
  });
  const report = (body: unknown, type = "application/json") =>
    app.request("http://tavora.test/v1/catalog/report", { method: "POST", headers: { "content-type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
  const of = { id: added.manifest.id, owner: added.owner, sha256: added.sha256 };
  return { store, catalog, clock, inbox, key, added, of, report };
}

describe("reporting a catalog module", () => {
  it("records a report of a listed zip, counts repeats, and hides nothing by itself", async () => {
    const { catalog, clock, of, report } = setup();
    const first = await report(of);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ status: "received" });
    clock.now += 60_000;
    expect((await report(of)).status).toBe(202);
    expect(catalog.reports()).toEqual([
      expect.objectContaining({ sha256: of.sha256, id: "wellbrained.timer", name: "Timer", version: "1.0.0", owner: of.owner, count: 2, listed: true, firstAt: "2026-10-18T12:00:00.000Z", lastAt: "2026-10-18T12:01:00.000Z" }),
    ]);
    expect(catalog.index()).toHaveLength(1);
  });

  it("takes exactly id, owner and sha256, so nothing else about the player rides along", async () => {
    const { catalog, of, report } = setup();
    for (const body of [{ ...of, player: "me" }, { id: of.id, sha256: of.sha256 }, { ...of, owner: "x" }, { ...of, id: "Not An Id" }, { ...of, sha256: of.sha256.toUpperCase() }, [of], "not json", null]) {
      expect((await report(body)).status).toBe(400);
    }
    expect((await report(of, "text/plain")).status).toBe(415);
    expect((await report({ ...of, id: "x".repeat(600) })).status).toBe(413);
    expect(catalog.reports()).toEqual([]);
  });

  it("answers 404 for a zip the catalog does not list under that id and key", async () => {
    const { catalog, of, report } = setup();
    expect((await report({ ...of, sha256: "0".repeat(64) })).status).toBe(404);
    expect((await report({ ...of, owner: "0".repeat(32) })).status).toBe(404);
    expect((await report({ ...of, id: "wellbrained.other" })).status).toBe(404);
    catalog.setListed(of.id, false);
    expect((await report(of)).status).toBe(404);
    expect(catalog.reports()).toEqual([]);
  });

  it("emails the publisher at most once a day, without saying who reported", async () => {
    const { clock, inbox, of, report } = setup();
    await report(of);
    await report(of);
    expect(inbox.mails()).toHaveLength(1);
    expect(inbox.mails()[0]).toMatchObject({ to: "dev@example.com" });
    expect(inbox.mails()[0]!.text).toContain("Timer (wellbrained.timer)");
    clock.now += 86_400_001;
    await report(of);
    expect(inbox.mails()).toHaveLength(2);
  });

  it("records the report when the key has no account, the mail fails, or only the reserved mail is left", async () => {
    const unlinked = setup({ linked: false });
    expect((await unlinked.report(unlinked.of)).status).toBe(202);
    expect(unlinked.inbox.mails()).toEqual([]);

    const broken = setup({ mailer: { send: async () => { throw new Error("smtp down"); } } });
    expect((await broken.report(broken.of)).status).toBe(202);
    expect(broken.catalog.reports()).toHaveLength(1);

    // The last emails of the day are kept for sign-in codes.
    const scarce = setup({ mailDailyLimit: 20 });
    expect((await scarce.report(scarce.of)).status).toBe(202);
    expect(scarce.inbox.mails()).toEqual([]);
    expect(scarce.catalog.reports()).toHaveLength(1);
  });

  it("limits reports per client and answers 503 without a catalog", async () => {
    const { of, report } = setup({ reportRateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }) });
    expect((await report(of)).status).toBe(202);
    const busy = await report(of);
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBeTruthy();
    const none = createApp({ db, rateLimiter: roomy() });
    expect((await none.request("http://tavora.test/v1/catalog/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(of) })).status).toBe(503);
  });
});

describe("counting installs from Browse", () => {
  it("counts installs of a listed module and shows the count in the listing, keeping nothing else", async () => {
    const { catalog, added } = setup();
    const app = createApp({ db, catalog, rateLimiter: roomy() });
    const installed = (body: unknown) => app.request("http://tavora.test/v1/catalog/installed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await installed({ id: added.manifest.id })).status).toBe(204);
    expect((await installed({ id: added.manifest.id })).status).toBe(204);
    expect((await installed({ id: "wellbrained.unknown" })).status).toBe(404);
    expect((await installed({})).status).toBe(404);
    const index = (await (await app.request("http://tavora.test/v1/catalog")).json()) as { modules: { installs: number }[] };
    expect(index.modules[0]!.installs).toBe(2);
    catalog.setListed(added.manifest.id, false);
    expect((await installed({ id: added.manifest.id })).status).toBe(404);
  });
});
