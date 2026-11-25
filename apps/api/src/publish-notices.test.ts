import { generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, publishSignature, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { NOTICES_PER_ACCOUNT, noticeRoom } from "./accounts.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { Scanner } from "./virus-scan.ts";

// Audit 2026-11-22 (run 4): notices about publishing draw from their own share of the day's emails, so publishers can't
// use up the emails for signing in.

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const cleanScanner: Scanner = { scan: async () => ({ clean: true }) };
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);

function moduleZip(key: KeyObject, id: string, version: string): Buffer {
  const manifest = { id, name: id, version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

/** `failing`: how many sends fail before the mail service works again. */
function setup(mailDailyLimit: number | undefined, uploadsPerDay = 10, failing = { sends: 0 }) {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-notices-")));
  const inbox = createTestInbox();
  const mailer = { send: async (mail: Parameters<typeof inbox.send>[0]) => (failing.sends-- > 0 ? Promise.reject(new Error("down")) : inbox.send(mail)) };
  const clock = { now: Date.parse("2026-11-22T12:00:00Z") };
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    publishRateLimiter: roomy(),
    publishLimits: { uploadsPerDay },
    scanner: cleanScanner,
    catalogueKey: catalogPublicKey(generateKeyPairSync("ed25519").privateKey),
    maintainerEmail: "maintainer@example.com",
    clientKey: (request) => request.headers.get("x-client") ?? "local",
    accounts: { store, mailer, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now, ...(mailDailyLimit === undefined ? {} : { mailDailyLimit }) },
  });
  /** A developer with a linked key and a version approved before, so every upload lists at once and mails a notice. */
  /** `discord`: an account with a Discord login and no address. */
  const developer = (name: string, discord = false) => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const account = store.createAccount(discord ? { discord: { id: `id-${name}`, name } } : { email: `${name}@example.com` }, clock.now - 86_400_000);
    catalog.trustAccount(account.id, new Date(clock.now));
    store.linkKey(account.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
    const token = store.createSession(account.id, "windows", clock.now).token;
    return { key, token, publish: (version: string) => publishZip(key, token, moduleZip(key, `${name}.timer`, version)) };
  };
  const publishZip = (key: KeyObject, token: string, zip: Buffer) =>
    app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "content-length": String(zip.length), "x-tavora-signature": publishSignature(key, zip), authorization: `Bearer ${token}` },
      body: new Uint8Array(zip),
    });
  const askCode = (email: string, client: string) =>
    app.request("http://tavora.test/v1/account/code", { method: "POST", headers: { "content-type": "application/json", "x-client": client }, body: JSON.stringify({ email }) });
  const developerSide = async (token: string) =>
    (await (await app.request("http://tavora.test/v1/account/developer", { headers: { authorization: `Bearer ${token}` } })).json()) as { unsentNotices: { kind: string; id: string; version: string }[] };
  return { store, inbox, clock, developer, askCode, developerSide, app };
}

describe("notices about publishing", () => {
  it("can't use up the day's sign-in emails, however many publishers send them", async () => {
    // 50 a day: 30 for sign-in codes, of which 20 also go to new addresses, and 6 for publishing notices.
    const { store, inbox, developer, askCode } = setup(50);
    store.createAccount({ email: "player@example.com" }, Date.parse("2026-11-01T00:00:00Z"));
    for (const name of ["alpha", "bravo", "charlie"]) {
      const dev = developer(name);
      for (let patch = 0; patch < 10; patch++) expect((await dev.publish(`1.0.${patch}`)).status).toBe(201);
    }
    expect(inbox.mails()).toHaveLength(noticeRoom(50).perDay);
    // An existing account still gets its sign-in code.
    const asked = await askCode("player@example.com", "203.0.113.9");
    expect(asked.status).toBe(202);
    expect(inbox.mails()[0]).toMatchObject({ to: "player@example.com" });
  });

  it("keeps every notice that couldn't go out, so Publishing can show it (S5)", async () => {
    const { developer, developerSide, inbox } = setup(50);
    const alpha = developer("alpha");
    for (let patch = 0; patch < 6; patch++) await alpha.publish(`1.0.${patch}`);
    const bravo = developer("bravo");
    for (let patch = 0; patch < 3; patch++) await bravo.publish(`1.0.${patch}`);
    expect(inbox.mails()).toHaveLength(6);
    expect((await developerSide(alpha.token)).unsentNotices).toEqual([]);
    // Newest first.
    expect((await developerSide(bravo.token)).unsentNotices.map(({ kind, id, version }) => ({ kind, id, version }))).toEqual([
      { kind: "published", id: "bravo.timer", version: "1.0.2" },
      { kind: "published", id: "bravo.timer", version: "1.0.1" },
      { kind: "published", id: "bravo.timer", version: "1.0.0" },
    ]);
  });

  it("lists everything for an account without an address, which no mail can reach", async () => {
    const { developer, developerSide, inbox } = setup(300);
    const dev = developer("delta", true);
    expect((await dev.publish("1.0.0")).status).toBe(201);
    expect(inbox.mails()).toEqual([]);
    expect((await developerSide(dev.token)).unsentNotices).toEqual([expect.objectContaining({ kind: "published", id: "delta.timer", version: "1.0.0" })]);
  });

  it("sends one account at most its own share a day", async () => {
    const { inbox, developer } = setup(undefined, 20);
    const dev = developer("alpha");
    for (let patch = 0; patch < NOTICES_PER_ACCOUNT + 3; patch++) expect((await dev.publish(`1.0.${patch}`)).status).toBe(201);
    expect(inbox.mails()).toHaveLength(NOTICES_PER_ACCOUNT);
  });

  it("gives back the account's notice when its send fails, and still lists it as unsent (hunt 2026-11-25 E7)", async () => {
    const failing = { sends: 3 };
    const { inbox, developer, developerSide } = setup(undefined, 20, failing);
    const dev = developer("alpha");
    for (let patch = 0; patch < NOTICES_PER_ACCOUNT + 3; patch++) expect((await dev.publish(`1.0.${patch}`)).status).toBe(201);
    // The 3 that failed didn't spend the account's share: it still got all of its own.
    expect(inbox.mails()).toHaveLength(NOTICES_PER_ACCOUNT);
    expect((await developerSide(dev.token)).unsentNotices.map(({ version }) => version)).toEqual(["1.0.2", "1.0.1", "1.0.0"]);
  });
});
