import { createHash, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, nextCatalogList, PUBLISH_TIMEOUT_MS, publishSignature, signCatalogList, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { publishHandlers, type PublishLimits } from "./catalog-publish.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { moderationRoutes } from "./moderation-admin.ts";
import { SCAN_LIMIT_MS } from "./moderation.ts";
import { encodePng } from "./png.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createUploadMemory, UPLOAD_MEMORY_BYTES, zipMemory, type UploadMemory } from "./upload-memory.ts";
import type { Scanner } from "./virus-scan.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const fingerprintOf = (key: KeyObject) => keyFingerprint(rawKey(key));
const clean: Scanner = { scan: async () => ({ clean: true }) };
const catalogue = generateKeyPairSync("ed25519").privateKey;
const picture = (seed: number) => Buffer.from(encodePng(16, 16, Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * seed) % 256))));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function moduleZip(key: KeyObject, { version = "1.0.0", network = [], extra = [], icon }: { version?: string; network?: string[]; extra?: ZipFile[]; icon?: Buffer } = {}): Buffer {
  const manifest = { id: "wellbrained.timer", name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network }, ...(icon ? { icon: "icon.png" } : {}) };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }, ...(icon ? [{ name: "icon.png", data: icon }] : []), ...extra];
  return writeZip([...files, signFiles(files, key)]);
}

function setup(limits: Partial<PublishLimits> = {}, scanner: Scanner = clean) {
  const store = new AccountStore(":memory:");
  const dir = mkdtempSync(path.join(tmpdir(), "tavora-publish-limits-"));
  const catalog = new CatalogStore(dir);
  const clock = { now: Date.parse("2026-11-21T12:00:00Z") };
  const inbox = createTestInbox();
  const app = createApp({ db, catalog, rateLimiter: roomy(), publishRateLimiter: roomy(), publishLimits: limits, scanner, catalogueKey: catalogPublicKey(catalogue), accounts: { store, mailer: inbox, now: () => clock.now, prefixRateLimiter: roomy() } });
  const admin = moderationRoutes({ catalog, accounts: store, scanner, mailer: inbox, now: () => clock.now, ...(limits.keepVersions === undefined ? {} : { keepVersions: limits.keepVersions }) });
  const developer = (email: string, approved = true) => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const account = store.createAccount({ email }, clock.now);
    store.linkKey(account.id, fingerprintOf(key), rawKey(key).toString("base64"), clock.now);
    store.setDeveloperName(account.id, `dev-${email.split("@")[0]}`, clock.now);
    if (approved) catalog.trustAccount(account.id, new Date(clock.now));
    return { key, accountId: account.id, token: store.createSession(account.id, "windows", clock.now).token };
  };
  const send = (who: { key: KeyObject; token: string }, zip: Buffer) =>
    app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "x-tavora-signature": publishSignature(who.key, zip), authorization: `Bearer ${who.token}` },
      body: new Uint8Array(zip),
    });
  const withdraw = (who: { token: string }, zip: Buffer) => app.request(`http://tavora.test/v1/catalog/waiting/${sha(zip)}`, { method: "DELETE", headers: { authorization: `Bearer ${who.token}` } });
  const approve = (zip: Buffer) => admin.request("http://admin.test/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha(zip) }) });
  const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;
  return { store, catalog, dir, clock, inbox, app, developer, send, withdraw, approve, reason };
}

/** The publish route alone, with its own memory budget. */
function withMemory(memory: UploadMemory, scanner: Scanner = clean) {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-publish-memory-")));
  const now = Date.parse("2026-11-21T12:00:00Z");
  const { limit, handler } = publishHandlers({ catalog, store, clientKey: () => "test", rateLimiter: roomy(), scanner, memory, now: () => now });
  const app = new Hono().post("/publish", limit, handler);
  const developer = (email: string) => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const account = store.createAccount({ email }, now);
    store.linkKey(account.id, fingerprintOf(key), rawKey(key).toString("base64"), now);
    catalog.trustAccount(account.id, new Date(now));
    return { key, token: store.createSession(account.id, "windows", now).token };
  };
  const send = (who: { key: KeyObject; token: string }, zip: Buffer) =>
    app.request("http://tavora.test/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "content-length": String(zip.length), "x-tavora-signature": publishSignature(who.key, zip), authorization: `Bearer ${who.token}` },
      body: new Uint8Array(zip),
    });
  return { store, catalog, developer, send };
}

describe("the memory an upload holds", () => {
  it("counts what is held, and gives it back", () => {
    const memory = createUploadMemory(100);
    const first = memory.take(60)!;
    expect(memory.take(50)).toBeNull();
    expect(first.resize(90)).toBe(true);
    expect(memory.take(20)).toBeNull();
    expect(first.resize(30)).toBe(true);
    const second = memory.take(70)!;
    expect(first.resize(31)).toBe(false);
    first.release();
    second.release();
    expect(memory.take(100)).not.toBeNull();
  });

  it("reads a zip's unpacked size from its directory", () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const zip = moduleZip(key, { extra: [{ name: "big.bin", data: randomBytes(2_000_000) }] });
    expect(zipMemory(zip)).toBeGreaterThan(2_000_000 + zip.length);
    expect(zipMemory(Buffer.from("not a zip"))).toBeNull();
  });

  it("refuses a valid zip too big to unpack here, with the limit the service can hold", async () => {
    const { developer, send, catalog } = withMemory(createUploadMemory(2 * 1024 * 1024));
    const dev = developer("dev@example.com");
    // A small zip that unpacks past the budget: repeats compress, but stay under the zip-bomb ratio.
    const block = randomBytes(24 * 1024);
    const repeated = Buffer.concat(Array.from({ length: 128 }, () => block));
    const response = await send(dev, moduleZip(dev.key, { extra: [{ name: "big.bin", data: repeated }] }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ reason: "too-big" });
    expect(catalog.index()).toEqual([]);
  });

  it("refuses a big zip from a key nobody linked before unpacking it", async () => {
    const { developer, send } = withMemory(createUploadMemory());
    const dev = developer("dev@example.com");
    const stranger = generateKeyPairSync("ed25519").privateKey;
    const zip = moduleZip(stranger, { extra: [{ name: "big.bin", data: randomBytes(3 * 1024 * 1024) }] });
    const response = await send({ key: stranger, token: dev.token }, zip);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "key-not-linked" });
  });

  it("asks a second upload to come back while the first one holds the memory, and takes it afterwards", async () => {
    let started = 0;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const scanner: Scanner = {
      scan: async () => {
        started += 1;
        await gate;
        return { clean: true };
      },
    };
    const key = generateKeyPairSync("ed25519").privateKey;
    const big = () => [{ name: "big.bin", data: randomBytes(1024 * 1024) }];
    const size = zipMemory(moduleZip(key, { extra: big() }))!;
    const { developer, send } = withMemory(createUploadMemory(size + 4096), scanner);
    const first = developer("first@example.com");
    const second = developer("second@example.com");
    const firstZip = moduleZip(first.key, { extra: big() });
    const running = send(first, firstZip);
    while (started < 1) await new Promise((resolve) => setTimeout(resolve, 1));

    const refused = await send(second, moduleZip(second.key, { extra: big() }));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("60");
    expect(await refused.json()).toMatchObject({ reason: "too-many" });

    finish();
    expect((await running).status).toBe(201);
    // The memory came back, also after the refusal.
    const next = moduleZip(first.key, { version: "1.0.1", extra: big() });
    expect((await send(first, next)).status).toBe(201);
  });

  it("gives its memory back after a refusal", async () => {
    const memory = createUploadMemory(UPLOAD_MEMORY_BYTES);
    const { developer, send } = withMemory(memory);
    const dev = developer("dev@example.com");
    expect((await send(dev, Buffer.from("not a zip"))).status).toBe(400);
    expect(memory.take(UPLOAD_MEMORY_BYTES)).not.toBeNull();
  });
});

describe("the daily upload limit", () => {
  it("counts withdrawn versions, so upload and withdraw can't go past it or use up the emails", async () => {
    const { developer, send, withdraw, reason, catalog, inbox } = setup({ uploadsPerDay: 2 });
    const dev = developer("dev@example.com", false);
    for (const version of ["1.0.0", "1.0.1"]) {
      const zip = moduleZip(dev.key, { version });
      expect((await send(dev, zip)).status).toBe(202);
      expect((await withdraw(dev, zip)).status).toBe(200);
    }
    expect(catalog.uploadsSince(dev.accountId, new Date(0))).toBe(2);
    const mails = inbox.mails().length;
    const third = await send(dev, moduleZip(dev.key, { version: "1.0.2" }));
    expect(third.status).toBe(429);
    expect(await reason(third)).toBe("daily-limit");
    expect(inbox.mails()).toHaveLength(mails);
  });

  it("opens up again a day later, and counts versions from before the log", async () => {
    const { developer, send, clock, catalog } = setup({ uploadsPerDay: 1 });
    const dev = developer("dev@example.com");
    // A version with no log row, as one uploaded before the log existed reads.
    catalog.add(moduleZip(dev.key), new Date(clock.now), dev.accountId);
    catalog.forgetUploads(dev.accountId);
    expect(catalog.uploadsSince(dev.accountId, new Date(clock.now - 1000))).toBe(1);
    expect((await send(dev, moduleZip(dev.key, { version: "1.0.1" }))).status).toBe(429);
    clock.now += 86_400_000 + 1;
    expect((await send(dev, moduleZip(dev.key, { version: "1.0.1" }))).status).toBe(201);
  });

  it("forgets the upload log with the account", async () => {
    const { developer, send, withdraw, catalog } = setup();
    const dev = developer("dev@example.com", false);
    const zip = moduleZip(dev.key);
    await send(dev, zip);
    await withdraw(dev, zip);
    expect(catalog.uploadsSince(dev.accountId, new Date(0))).toBe(1);
    catalog.forgetUploads(dev.accountId);
    expect(catalog.uploadsSince(dev.accountId, new Date(0))).toBe(0);
  });
});

describe("sending the same zip again", () => {
  it("answers a client that lost the answer with what happened, adding nothing and emailing nobody", async () => {
    const { developer, send, catalog, inbox } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key);
    expect((await send(dev, zip)).status).toBe(201);
    const mails = inbox.mails().length;
    const again = await send(dev, zip);
    expect(again.status).toBe(201);
    expect(await again.json()).toMatchObject({ status: "published", version: "1.0.0", sha256: sha(zip) });
    expect(catalog.uploadsSince(dev.accountId, new Date(0))).toBe(1);
    expect(inbox.mails()).toHaveLength(mails);
  });

  it("says a version still waits, with its reasons", async () => {
    const { developer, send, catalog } = setup();
    const dev = developer("dev@example.com", false);
    const zip = moduleZip(dev.key);
    expect((await send(dev, zip)).status).toBe(202);
    const again = await send(dev, zip);
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ status: "waiting", reasons: [expect.objectContaining({ check: "first-module" })] });
    expect(catalog.waitingVersions()).toHaveLength(1);
  });

  it("answers a retry sent while the first try is still being scanned", async () => {
    let started = 0;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const scanner: Scanner = {
      scan: async () => {
        started += 1;
        await gate;
        return { clean: true };
      },
    };
    const { developer, send, catalog, inbox } = setup({}, scanner);
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key);
    const first = send(dev, zip);
    const retry = send(dev, zip);
    while (started < 2) await new Promise((resolve) => setTimeout(resolve, 1));
    finish();
    expect([(await first).status, (await retry).status]).toEqual([201, 201]);
    expect(catalog.uploadsSince(dev.accountId, new Date(0))).toBe(1);
    expect(inbox.mails()).toHaveLength(1);
  });

  it("still refuses an older version sent again", async () => {
    const { developer, send, reason } = setup();
    const dev = developer("dev@example.com");
    const first = moduleZip(dev.key);
    await send(dev, first);
    await send(dev, moduleZip(dev.key, { version: "1.0.1" }));
    const again = await send(dev, first);
    expect(again.status).toBe(409);
    expect(await reason(again)).toBe("conflict");
  });

  it("gives its client more time than the longest scan", () => {
    expect(PUBLISH_TIMEOUT_MS).toBeGreaterThan(SCAN_LIMIT_MS);
  });
});

describe("a taken-down module", () => {
  it("doesn't say a new version is published: it waits, and can't be approved until the module is back", async () => {
    const { developer, send, approve, catalog, inbox } = setup();
    const dev = developer("dev@example.com");
    await send(dev, moduleZip(dev.key));
    catalog.setListed("wellbrained.timer", false);
    inbox.clear();

    const zip = moduleZip(dev.key, { version: "1.0.1" });
    const response = await send(dev, zip);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: "waiting", reasons: [expect.objectContaining({ check: "taken-down" })] });
    expect(inbox.mails()[0]!.text).toContain("taken down");

    expect((await approve(zip)).status).toBe(409);
    expect(catalog.waitingVersion(sha(zip))).not.toBeNull();
    catalog.setListed("wellbrained.timer", true);
    expect((await approve(zip)).status).toBe(200);
    expect(catalog.index()[0]).toMatchObject({ version: "1.0.1" });
  });
});

describe("room in the catalog", () => {
  const filler = (seed: number) => Array.from({ length: 4000 }, (_, index) => (index * seed * 7919) % 256);

  it("counts an older zip as freed only for a version that lists now", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const extra = [{ name: "data.bin", data: Buffer.from(filler(3)) }];
    const roomFor = moduleZip(key, { extra }).length;
    const { developer, send, reason } = setup({ keepVersions: 1, accountBytes: Math.floor(roomFor * 1.5) });
    const dev = developer("dev@example.com");
    expect((await send(dev, moduleZip(dev.key, { extra }))).status).toBe(201);

    // It waits, because it asks for more: nothing is pushed out yet, so it has to fit next to the first.
    const refused = await send(dev, moduleZip(dev.key, { version: "1.0.1", network: ["example.org"], extra: [{ name: "data.bin", data: Buffer.from(filler(5)) }] }));
    expect(refused.status).toBe(413);
    expect(await reason(refused)).toBe("account-full");

    // It lists at once, so the zip it pushes out counts as free.
    expect((await send(dev, moduleZip(dev.key, { version: "1.0.2", extra: [{ name: "data.bin", data: Buffer.from(filler(7)) }] }))).status).toBe(201);
  });

  it("clears the catalog-full warning when a version that waits fits", async () => {
    const { developer, send, catalog } = setup();
    const dev = developer("dev@example.com", false);
    catalog.markFull(new Date());
    expect(catalog.fullSince()).not.toBeNull();
    expect((await send(dev, moduleZip(dev.key))).status).toBe(202);
    expect(catalog.fullSince()).toBeNull();
  });

  it("deletes the pictures only pruned versions named, and keeps the ones still in use", async () => {
    const { developer, send, catalog, dir, approve } = setup({ keepVersions: 1 });
    const dev = developer("dev@example.com");
    const old = picture(3);
    const kept = picture(5);
    const file = (data: Buffer) => path.join(dir, "pictures", `${sha(data)}.png`);

    const first = moduleZip(dev.key, { icon: old });
    expect((await send(dev, first)).status).toBe(202);
    expect((await approve(first)).status).toBe(200);
    const second = moduleZip(dev.key, { version: "1.0.1", icon: kept });
    expect((await send(dev, second)).status).toBe(202);
    expect(existsSync(file(old))).toBe(true);
    expect((await approve(second)).status).toBe(200);

    expect(existsSync(file(old))).toBe(false);
    expect(existsSync(file(kept))).toBe(true);
    expect(catalog.picture(sha(kept), "png")).not.toBeNull();
  });
});

describe("the developer name of a listing", () => {
  it("stays after the signing key was replaced and unlinked, by the signed succession", async () => {
    const { developer, send, store, catalog, clock, app } = setup();
    const dev = developer("dev@example.com");
    const next = generateKeyPairSync("ed25519").privateKey;
    store.linkKey(dev.accountId, fingerprintOf(next), rawKey(next).toString("base64"), clock.now);
    await send(dev, moduleZip(dev.key));
    store.unlinkKey(dev.accountId, fingerprintOf(dev.key));
    const name = async () => ((await (await app.request("http://tavora.test/v1/catalog")).json()) as { modules: { publisher: string | null }[] }).modules[0]!.publisher;
    expect(await name()).toBeNull();

    const list = (account: string, signer: KeyObject = catalogue) =>
      Buffer.from(signCatalogList(nextCatalogList("successions", [{ old: fingerprintOf(dev.key), new: fingerprintOf(next), account }], null, new Date(clock.now)), signer));
    // A list not signed with the catalogue key, or naming another account, counts for nothing.
    catalog.setList("successions", list(dev.accountId, generateKeyPairSync("ed25519").privateKey));
    expect(await name()).toBeNull();
    catalog.setList("successions", list("someone-else"));
    expect(await name()).toBeNull();

    catalog.setList("successions", list(dev.accountId));
    expect(await name()).toBe("dev-dev");
    const page = (await (await app.request("http://tavora.test/v1/catalog/modules/wellbrained.timer")).json()) as { module: { publisher: string; owner: string } };
    expect(page.module).toMatchObject({ publisher: "dev-dev", owner: fingerprintOf(dev.key) });
  });
});
