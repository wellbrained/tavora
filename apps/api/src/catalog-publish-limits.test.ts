import { createHash, createPublicKey, generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { catalogPublicKey, nextCatalogList, PUBLISH_TIMEOUT_MS, publishReadMs, publishSignature, publishTimeoutMs, signCatalogList, signFiles, writeZip, ZIP_LIMITS, zipDirectory, zipFiles, type ZipFile } from "@tavora/pack";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { publishHandlers, type PublishLimits, type PublishOptions } from "./catalog-publish.ts";
import { CatalogStore, checkCatalogZip, copyHashes, REMOVED_ZIP } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { moderationRoutes } from "./moderation-admin.ts";
import { SCAN_LIMIT_MS } from "./moderation.ts";
import { encodePng } from "./png.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createUploadMemory, freeMemory, MAX_MANIFEST_BYTES, MAX_SIGNATURE_BYTES, readUpload, UPLOAD_MEMORY_BYTES, zipMemory, type UploadMemory } from "./upload-memory.ts";
import type { Scanner } from "./virus-scan.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const fingerprintOf = (key: KeyObject) => keyFingerprint(rawKey(key));
const clean: Scanner = { scan: async () => ({ clean: true }) };
const catalogue = generateKeyPairSync("ed25519").privateKey;
const picture = (seed: number) => Buffer.from(encodePng(16, 16, Uint8Array.from({ length: 16 * 16 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (i * seed) % 256))));
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function moduleZip(key: KeyObject, { id = "wellbrained.timer", name = "Timer", version = "1.0.0", network = [], extra = [], icon }: { id?: string; name?: string; version?: string; network?: string[]; extra?: ZipFile[]; icon?: Buffer } = {}): Buffer {
  const manifest = { id, name, version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network }, ...(icon ? { icon: "icon.png" } : {}) };
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
  const approveAndList = (zip: Buffer) => admin.request("http://admin.test/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: sha(zip), relist: true }) });
  const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;
  return { store, catalog, dir, clock, inbox, app, developer, send, withdraw, approve, approveAndList, reason };
}

/** A body sent in 1 MB chunks, as a client without a Content-Length does; it counts how much was asked of it. */
function chunkedBody(chunks: number, { stallAfter }: { stallAfter?: number } = {}) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stallAfter !== undefined && pulled >= stallAfter) return new Promise<void>(() => {});
      if (pulled >= chunks) {
        controller.close();
        return undefined;
      }
      pulled += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
      return undefined;
    },
  }, { highWaterMark: 0 });
  return { stream, pulled: () => pulled };
}

const chunkedRequest = (url: string, stream: ReadableStream<Uint8Array>, token?: string) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/zip", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: stream, duplex: "half" } as RequestInit);

/** The publish route alone, with its own memory budget. */
function withMemory(memory: UploadMemory, scanner: Scanner = clean, options: Pick<PublishOptions, "readLimits" | "scanLimitMs"> = {}) {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-publish-memory-")));
  const now = Date.parse("2026-11-21T12:00:00Z");
  const { handler } = publishHandlers({ catalog, store, clientKey: () => "test", rateLimiter: roomy(), scanner, memory, now: () => now, ...options });
  const app = new Hono().post("/publish", handler);
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
  return { store, catalog, developer, send, app };
}

describe("reading an upload", () => {
  const url = "http://tavora.test/publish";

  it("reads nothing of a chunked upload without a sign-in", async () => {
    // Through the service's own route, with everything that runs in front of the handler.
    const { app } = setup();
    const body = chunkedBody(45);
    const response = await app.request(chunkedRequest("http://tavora.test/v1/catalog/publish", body.stream));
    expect(response.status).toBe(401);
    expect(body.pulled()).toBe(0);
  });

  it("reads nothing for an account with no linked key, and holds no memory for it", async () => {
    const memory = createUploadMemory();
    const { app, store } = withMemory(memory);
    const account = store.createAccount({ email: "nokey@example.com" }, Date.parse("2026-11-21T12:00:00Z"));
    const { token } = store.createSession(account.id, "windows", Date.parse("2026-11-21T12:00:00Z"));
    const body = chunkedBody(45);
    const response = await app.request(chunkedRequest(url, body.stream, token));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ reason: "key-not-linked" });
    expect(body.pulled()).toBe(0);
    expect(memory.take(UPLOAD_MEMORY_BYTES)).not.toBeNull();
  });

  it("stops reading a chunked upload at the size limit", async () => {
    const memory = createUploadMemory();
    const { app, developer } = withMemory(memory);
    const dev = developer("dev@example.com");
    const body = chunkedBody(200);
    const response = await app.request(chunkedRequest(url, body.stream, dev.token));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ reason: "too-big" });
    expect(body.pulled()).toBeLessThanOrEqual(ZIP_LIMITS.maxArchiveBytes / (1024 * 1024) + 1);
    expect(memory.take(UPLOAD_MEMORY_BYTES)).not.toBeNull();
  });

  it("holds memory while it reads, so unfinished uploads can't add up past the budget", async () => {
    const memory = createUploadMemory(ZIP_LIMITS.maxArchiveBytes + 1024);
    const { app, developer, send } = withMemory(memory, clean, { readLimits: { idleMs: 200 } });
    const first = developer("first@example.com");
    const second = developer("second@example.com");
    const stalled = app.request(chunkedRequest(url, chunkedBody(45, { stallAfter: 1 }).stream, first.token));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const refused = await send(second, moduleZip(second.key));
    expect(refused.status).toBe(429);
    expect((await stalled).status).toBe(408);
    expect((await send(second, moduleZip(second.key))).status).toBe(201);
  });

  it("ends an upload that stops sending, and gives its memory back", async () => {
    const memory = createUploadMemory();
    const { app, developer } = withMemory(memory, clean, { readLimits: { idleMs: 30 } });
    const dev = developer("dev@example.com");
    const response = await app.request(chunkedRequest(url, chunkedBody(45, { stallAfter: 2 }).stream, dev.token));
    expect(response.status).toBe(408);
    expect(await response.json()).toMatchObject({ reason: "invalid" });
    expect(memory.take(UPLOAD_MEMORY_BYTES)).not.toBeNull();
  });

  it("ends an upload that keeps dripping slower than the slowest line it allows", async () => {
    const { app, developer } = withMemory(createUploadMemory(), clean, { readLimits: { idleMs: 200, graceMs: 60, bytesPerSecond: 100_000 } });
    const dev = developer("dev@example.com");
    const drip = new ReadableStream<Uint8Array>({
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        controller.enqueue(new Uint8Array(1));
      },
    }, { highWaterMark: 0 });
    expect((await app.request(chunkedRequest(url, drip, dev.token))).status).toBe(408);
  });

  it("lets a slow honest line finish long past the grace time", async () => {
    // On a fake clock: readUpload measures speed against Date.now, so a slow CI runner delaying real timers could push this
    // line under the limit. Here 10 chunks take exactly 250 ms, about 330 KB/s against a floor of 100 KB/s plus 40 ms grace.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          if (sent++ === 10) controller.close();
          else controller.enqueue(new Uint8Array(8192));
        },
      }, { highWaterMark: 0 });
      const request = new Request(url, { method: "POST", body, duplex: "half" } as RequestInit);
      const reading = readUpload(request, 1024 * 1024, { idleMs: 500, graceMs: 40, bytesPerSecond: 100_000 });
      await vi.advanceTimersByTimeAsync(400);
      expect(await reading).toMatchObject({ bytes: expect.objectContaining({ length: 81_920 }) });
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a bigger upload longer to arrive, and its client longer to wait", () => {
    const biggest = ZIP_LIMITS.maxArchiveBytes;
    // 50 MB at about 1 Mbit/s, where a flat 3 minutes needed 2.3 Mbit/s.
    expect(publishReadMs(biggest)).toBeGreaterThan(biggest / 125);
    expect(publishTimeoutMs(biggest)).toBeGreaterThanOrEqual(publishReadMs(biggest) + SCAN_LIMIT_MS);
    expect(publishTimeoutMs(1024)).toBe(PUBLISH_TIMEOUT_MS);
  });

  it("takes one upload per account while it is being read", async () => {
    const { app, developer, send } = withMemory(createUploadMemory(), clean, { readLimits: { idleMs: 200 } });
    const dev = developer("dev@example.com");
    const stalled = app.request(chunkedRequest(url, chunkedBody(5, { stallAfter: 1 }).stream, dev.token));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await send(dev, moduleZip(dev.key));
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
    await stalled;
    expect((await send(dev, moduleZip(dev.key))).status).toBe(201);
  });
});

describe("a zip's manifest and signature file", () => {
  const manifest = (padding: number) =>
    Buffer.from(`${JSON.stringify({ id: "wellbrained.timer", name: "Timer", version: "1.0.0", apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } })}${" ".repeat(padding)}`);
  const page = { name: "index.html", data: Buffer.from("<p>timer</p>") };
  // Doesn't compress, so the padded files below stay under the zip-bomb ratio and reach the size caps.
  const filler = { name: "filler.bin", data: randomBytes(64 * 1024) };

  it("refuses a manifest past the cap from the directory", async () => {
    const { developer, send } = withMemory(createUploadMemory());
    const dev = developer("dev@example.com");
    const files = [{ name: "tavora.module.json", data: manifest(MAX_MANIFEST_BYTES + 1) }, page, filler];
    const response = await send(dev, writeZip([...files, signFiles(files, dev.key)]));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "invalid", error: "Its tavora.module.json is too big." });
    expect(() => checkCatalogZip(writeZip([...files, signFiles(files, dev.key)]))).toThrow(/too big/);
  });

  it("refuses a signature file past the cap from the directory", async () => {
    const { developer, send } = withMemory(createUploadMemory());
    const dev = developer("dev@example.com");
    const files = [{ name: "tavora.module.json", data: manifest(0) }, page, filler];
    const signature = signFiles(files, dev.key);
    const padded = { name: signature.name, data: Buffer.concat([signature.data, Buffer.alloc(MAX_SIGNATURE_BYTES, " ")]) };
    const response = await send(dev, writeZip([...files, padded]));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "invalid", error: "Its tavora.signature.json is too big." });
  });

  it("refuses a changelog past the cap before parsing it", () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const withChangelog = Buffer.from(JSON.stringify({ ...JSON.parse(manifest(0).toString()), changelog: "changelog.json" }));
    const files = [{ name: "tavora.module.json", data: withChangelog }, page, filler, { name: "changelog.json", data: Buffer.from(`[${" ".repeat(MAX_MANIFEST_BYTES)}]`) }];
    expect(() => checkCatalogZip(writeZip([...files, signFiles(files, key)]))).toThrow(/changelog\.json is too big/);
  });

  it("refuses a zip with no signature without unpacking it", async () => {
    const { developer, send } = withMemory(createUploadMemory());
    const dev = developer("dev@example.com");
    const zip = writeZip([{ name: "tavora.module.json", data: manifest(0) }, { name: "big.bin", data: randomBytes(4096) }]);
    // A damaged file: unpacking it would answer that the file is damaged.
    const at = zip.indexOf("big.bin") + "big.bin".length + 2000;
    zip[at] = zip[at]! ^ 0xff;
    const response = await send(dev, zip);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "invalid", error: expect.stringContaining("It is not signed") });
  });

  it("refuses a signature file with no readable key without unpacking the rest", async () => {
    const { developer, send } = withMemory(createUploadMemory());
    const dev = developer("dev@example.com");
    const zip = writeZip([{ name: "tavora.module.json", data: manifest(0) }, { name: "big.bin", data: randomBytes(4096) }, { name: "tavora.signature.json", data: Buffer.from("{ not json") }]);
    const at = zip.indexOf("big.bin") + "big.bin".length + 2000;
    zip[at] = zip[at]! ^ 0xff;
    const response = await send(dev, zip);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ reason: "invalid", error: expect.stringContaining("signature file cannot be read") });
  });
});

describe("a scan that runs out of time", () => {
  it("keeps the upload's memory until the scanner has really stopped", async () => {
    let stop!: () => void;
    let seen: AbortSignal | undefined;
    const scanner: Scanner = {
      scan: (_zip, _files, signal) => {
        seen = signal;
        return new Promise((_, reject) => (stop = () => reject(new Error("stopped"))));
      },
    };
    const memory = createUploadMemory();
    const { developer, send } = withMemory(memory, scanner, { scanLimitMs: 20 });
    const dev = developer("dev@example.com");
    const response = await send(dev, moduleZip(dev.key));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ reasons: [expect.objectContaining({ check: "virus" })] });
    expect(seen?.aborted).toBe(true);
    expect(memory.take(UPLOAD_MEMORY_BYTES)).toBeNull();

    stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(memory.take(UPLOAD_MEMORY_BYTES)).not.toBeNull();
  });
});

describe("the copy check and older versions", () => {
  it("reads stored hashes only, and the start-up backfill gives older versions theirs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-copy-backfill-"));
    const catalog = new CatalogStore(dir);
    const key = generateKeyPairSync("ed25519").privateKey;
    const shared = { name: "shared.bin", data: randomBytes(4096) };
    const zip = moduleZip(key, { extra: [shared] });
    catalog.add(zip, new Date("2026-11-20T12:00:00Z"), "older-account");
    const raw = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    raw.exec("update versions set file_hashes = null");
    raw.close();
    const self = { moduleId: "other.copy", accountId: "someone", fingerprints: [] };
    const hashes = copyHashes([shared]);

    expect(catalog.mostSimilar(self, hashes)).toBeNull();
    expect(catalog.backfillSignedHashes()).toEqual({ filled: 1, skipped: [] });
    expect(catalog.mostSimilar(self, hashes)).toMatchObject({ id: "wellbrained.timer", share: 1 });
    expect(catalog.backfillSignedHashes()).toEqual({ filled: 0, skipped: [] });
    catalog.close();
  });

  it("leaves a zip too big for the budget unread at the server's start", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-copy-backfill-"));
    const catalog = new CatalogStore(dir);
    const key = generateKeyPairSync("ed25519").privateKey;
    const zip = moduleZip(key, { extra: [{ name: "big.bin", data: randomBytes(8192) }] });
    catalog.add(zip, new Date("2026-11-20T12:00:00Z"), "older-account");
    const raw = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    raw.exec("update versions set file_hashes = null");
    const hashes = () => (raw.prepare("select file_hashes from versions").get() as { file_hashes: string | null }).file_hashes;

    const started = catalog.backfillSignedHashes({ skipStalled: true, memoryLimit: 1024 });
    expect(started).toEqual({ filled: 0, skipped: [expect.objectContaining({ sha256: sha(zip), reason: expect.stringContaining("too big") })] });
    expect(hashes()).toBeNull();
    // The command has no such limit.
    expect(catalog.backfillSignedHashes({ memoryLimit: 1024 }).filled).toBe(1);
    expect(hashes()).not.toBeNull();
    raw.close();
    catalog.close();
  });
});

describe("the memory budget", () => {
  it("leaves the service room under its 256 MB limit", () => {
    expect(UPLOAD_MEMORY_BYTES).toBeLessThanOrEqual(96 * 1024 * 1024);
  });

  it("really hands memory back when asked", async () => {
    let big: { data: Uint8Array } | null = { data: new Uint8Array(1024) };
    const ref = new WeakRef(big);
    big = null;
    await new Promise((resolve) => setTimeout(resolve, 0));
    freeMemory();
    expect(ref.deref()).toBeUndefined();
  });

  it("unpacks a big file into one block, never holding it twice", () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const data = randomBytes(1024 * 1024);
    const file = [...zipFiles(moduleZip(key, { extra: [{ name: "big.bin", data }] }))].find((entry) => entry.name === "big.bin")!;
    expect(file.data.equals(data)).toBe(true);
    expect(file.data.buffer.byteLength).toBe(data.length + 1);
  });
});

describe("a version that can't be added", () => {
  const countingScanner = () => {
    const state = { scans: 0, release: () => {} };
    const gate = new Promise<void>((resolve) => (state.release = resolve));
    const held = { value: false };
    const scanner: Scanner = {
      scan: async () => {
        state.scans += 1;
        if (held.value) await gate;
        return { clean: true };
      },
    };
    return { state, held, scanner };
  };

  it("is refused before the scan, so it can't hold the shared memory through one", async () => {
    const { state, scanner } = countingScanner();
    const { developer, send, reason, catalog } = setup({}, scanner);
    const dev = developer("dev@example.com");
    expect((await send(dev, moduleZip(dev.key))).status).toBe(201);
    expect(state.scans).toBe(1);

    const same = await send(dev, moduleZip(dev.key, { extra: [{ name: "big.bin", data: randomBytes(4096) }] }));
    expect(same.status).toBe(409);
    expect(await reason(same)).toBe("conflict");
    expect(state.scans).toBe(1);
    expect(catalog.uploadsSince(dev.accountId, new Date(0))).toBe(1);
  });

  it("counts towards the daily limit when it is only refused after its scan", async () => {
    const { state, held, scanner } = countingScanner();
    const { developer, send, reason, catalog, clock } = setup({}, scanner);
    const dev = developer("dev@example.com");
    held.value = true;
    const upload = send(dev, moduleZip(dev.key));
    while (state.scans < 1) await new Promise((resolve) => setTimeout(resolve, 1));
    // A newer version arrives by hand during the scan, so this one can't be added any more.
    catalog.add(moduleZip(dev.key, { version: "2.0.0" }), new Date(clock.now));
    state.release();
    const answer = await upload;
    expect(answer.status).toBe(409);
    expect(await reason(answer)).toBe("conflict");
    expect(catalog.uploadsSince(dev.accountId, new Date(0))).toBe(1);
  });
});

describe("comparing with versions that have no stored hashes", () => {
  const shared = { name: "shared.bin", data: randomBytes(4096) };

  it("makes an upload wait, and finds the copy once the hashes are there", async () => {
    const { developer, send, catalog, dir } = setup();
    const original = developer("original@example.com");
    const other = developer("other@example.com");
    expect((await send(original, moduleZip(original.key, { extra: [shared] }))).status).toBe(201);
    const raw = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    raw.exec("update versions set file_hashes = null");
    raw.close();

    const copy = (version: string) => moduleZip(other.key, { id: "other.clock", name: "Clock", version, extra: [shared] });
    const waiting = await send(other, copy("1.0.0"));
    expect(waiting.status).toBe(202);
    expect(await waiting.json()).toMatchObject({ reasons: [expect.objectContaining({ check: "compare" })] });

    expect(catalog.backfillSignedHashes().filled).toBe(1);
    const found = await send(other, copy("1.0.1"));
    expect(found.status).toBe(202);
    expect(await found.json()).toMatchObject({ reasons: [expect.objectContaining({ check: "copy" })] });
  });

  it("doesn't hold an upload back for the account's own older version", async () => {
    const { developer, send, dir } = setup();
    const dev = developer("dev@example.com");
    await send(dev, moduleZip(dev.key, { extra: [shared] }));
    const raw = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    raw.exec("update versions set file_hashes = null");
    raw.close();
    expect((await send(dev, moduleZip(dev.key, { version: "1.0.1", extra: [shared] }))).status).toBe(201);
  });
});

describe("what the review page reads", () => {
  const big = () => [{ name: "big.bin", data: randomBytes(200_000) }];
  const waitingZip = async () => {
    const context = setup();
    const dev = context.developer("dev@example.com", false);
    const zip = moduleZip(dev.key, { extra: big() });
    expect((await context.send(dev, zip)).status).toBe(202);
    return { ...context, zip };
  };
  const fileUrl = (zip: Buffer, name: string) => `http://admin.test/waiting/${sha(zip)}/file?name=${encodeURIComponent(name)}`;

  it("reads a zip's file list from its directory on disk, also with a zip comment", async () => {
    const { catalog, dir, zip } = await waitingZip();
    expect(catalog.zipListing(sha(zip))).toEqual({ size: zip.length, files: zipDirectory(zip) });
    const commented = Buffer.concat([zip, Buffer.from("hello")]);
    commented.writeUInt16LE(5, zip.length - 2);
    writeFileSync(path.join(dir, "zips", `${sha(zip)}.zip`), commented);
    expect(catalog.zipListing(sha(zip))!.files).toEqual(zipDirectory(zip));
    writeFileSync(path.join(dir, "zips", `${sha(zip)}.zip`), "not a zip");
    expect(catalog.zipListing(sha(zip))).toBeNull();
  });

  it("lists waiting versions without reading any of them whole", async () => {
    const { catalog, store, zip } = await waitingZip();
    const read = vi.spyOn(catalog, "zipBytes");
    const admin = moderationRoutes({ catalog, accounts: store });
    const answer = (await (await admin.request("http://admin.test/waiting")).json()) as { waiting: { module: { files: { name: string; size: number }[] } }[] };
    expect(answer.waiting[0]!.module.files).toEqual(zipDirectory(zip));
    expect(read).not.toHaveBeenCalled();
  });

  it("says the file list is unavailable instead of showing no files", async () => {
    const { catalog, store, zip, dir } = await waitingZip();
    writeFileSync(path.join(dir, "zips", `${sha(zip)}.zip`), Buffer.alloc(zip.length, 1));
    const admin = moderationRoutes({ catalog, accounts: store });
    const answer = (await (await admin.request("http://admin.test/waiting")).json()) as { waiting: { module: { files: unknown[]; filesUnavailable?: boolean } }[] };
    expect(answer.waiting[0]!.module).toMatchObject({ files: [], filesUnavailable: true });
    const file = await admin.request(fileUrl(zip, "index.html"));
    expect(file.status).toBe(404);
    expect(await file.json()).toMatchObject({ error: "The file list is unavailable." });
  });

  it("lists every file of a signed zip whose end record gives no directory size", async () => {
    const { catalog, store, developer, send } = setup();
    const dev = developer("other@example.com", false);
    const zip = Buffer.from(moduleZip(dev.key, { id: "other.clock", name: "Clock", extra: big() }));
    zip.writeUInt32LE(0, zip.length - 22 + 12);
    expect((await send(dev, zip)).status).toBe(202);
    const admin = moderationRoutes({ catalog, accounts: store });
    const answer = (await (await admin.request("http://admin.test/waiting")).json()) as { waiting: { module: { files: unknown[]; filesUnavailable?: boolean } }[] };
    expect(answer.waiting[0]!.module.files).toEqual(zipDirectory(zip));
    expect(answer.waiting[0]!.module.filesUnavailable).toBeUndefined();
    expect((await admin.request(fileUrl(zip, "index.html"))).status).toBe(200);
  });

  it("approves without loading the zip into memory, and still refuses one that's gone", async () => {
    const { catalog, approve, zip, dir, developer, send } = await waitingZip();
    const read = vi.spyOn(catalog, "zipBytes");
    expect((await approve(zip)).status).toBe(200);
    expect(read).not.toHaveBeenCalled();

    const other = developer("other@example.com", false);
    const gone = moduleZip(other.key, { id: "other.clock", name: "Clock" });
    expect((await send(other, gone)).status).toBe(202);
    rmSync(path.join(dir, "zips", `${sha(gone)}.zip`));
    expect((await approve(gone)).status).toBe(409);
  });

  it("refuses a waiting zip damaged by one byte, and keeps the good zips it would have pushed out", async () => {
    const { developer, send, approve, catalog, dir, reason } = setup({ keepVersions: 1 });
    const dev = developer("dev@example.com");
    const good = moduleZip(dev.key);
    expect((await send(dev, good)).status).toBe(201);
    const next = moduleZip(dev.key, { version: "1.0.1", network: ["example.org"] });
    expect((await send(dev, next)).status).toBe(202);
    const file = path.join(dir, "zips", `${sha(next)}.zip`);
    const damaged = Buffer.from(next);
    damaged[40] = damaged[40]! ^ 0xff;
    writeFileSync(file, damaged);

    const answer = await approve(next);
    expect(answer.status).toBe(409);
    expect(await reason(answer)).toBeUndefined();
    expect(catalog.waitingVersion(sha(next))).not.toBeNull();
    expect(catalog.index()).toEqual([expect.objectContaining({ version: "1.0.0" })]);
    expect(await catalog.openZip(sha(good))).not.toBeNull();
  });

  it("checks the zip before the ban and key checks, so a ban during that read still stops the approval", async () => {
    const { developer, send, approve, catalog, store, clock } = setup();
    const dev = developer("dev@example.com", false);
    const zip = moduleZip(dev.key);
    await send(dev, zip);
    const state = catalog.waitingZipState.bind(catalog);
    catalog.waitingZipState = async (hash) => {
      const answer = await state(hash);
      store.ban(dev.accountId, "spam", null, [], clock.now);
      return answer;
    };
    expect((await approve(zip)).status).toBe(409);
    expect(catalog.waitingVersion(sha(zip))).not.toBeNull();
  });

  it("waits for room before reading a zip to show one of its files", async () => {
    const { catalog, store, zip } = await waitingZip();
    const memory = createUploadMemory(zip.length + 300_000);
    const admin = moderationRoutes({ catalog, accounts: store, memory });
    const read = vi.spyOn(catalog, "zipBytes");
    const held = memory.take(memory.budget)!;
    const busy = await admin.request(fileUrl(zip, "index.html"));
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("60");
    expect(read).not.toHaveBeenCalled();
    held.release();

    const shown = await admin.request(fileUrl(zip, "index.html"));
    expect(shown.status).toBe(200);
    expect(await shown.text()).toBe("<p>timer</p>");
    expect(memory.take(memory.budget)).not.toBeNull();
  });

  it("doesn't unpack a live zip whose directory can't be read, as nothing says what it would take", async () => {
    const { catalog, store, developer, send, dir } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key, { extra: big() });
    await send(dev, zip);
    writeFileSync(path.join(dir, "zips", `${sha(zip)}.zip`), Buffer.alloc(zip.length, 1));
    const admin = moderationRoutes({ catalog, accounts: store, scanner: clean, memory: createUploadMemory() });
    const read = vi.spyOn(catalog, "zipBytes");
    const response = await admin.request("http://admin.test/live-check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const { result } = (await response.json()) as { result: { flagged: number; results: { error?: string }[] } };
    expect(result.results[0]!.error).toBe("Its zip can't be read.");
    expect(result.flagged).toBe(1);
    expect(read).not.toHaveBeenCalled();
  });

  it("waits for room before reading a live zip in the check of what is live", async () => {
    const { catalog, store, developer, send } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key, { extra: big() });
    await send(dev, zip);
    const memory = createUploadMemory(zip.length + 400_000);
    const admin = moderationRoutes({ catalog, accounts: store, scanner: clean, memory });
    const read = vi.spyOn(catalog, "zipBytes");
    const held = memory.take(memory.budget)!;
    const response = await admin.request("http://admin.test/live-check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const { result } = (await response.json()) as { result: { results: { error?: string }[] } };
    expect(result.results[0]!.error).toMatch(/enough memory/);
    expect(read).not.toHaveBeenCalled();
    held.release();
  });
});

describe("a zip that's gone", () => {
  const shared = { name: "shared.bin", data: randomBytes(4096) };
  const twoPublishers = async () => {
    const context = setup();
    const original = context.developer("original@example.com");
    const other = context.developer("other@example.com");
    const kept = moduleZip(original.key, { extra: [shared] });
    expect((await context.send(original, kept)).status).toBe(201);
    const raw = new DatabaseSync(path.join(context.dir, "catalog.sqlite"));
    raw.exec("update versions set file_hashes = null");
    raw.close();
    const copy = (version: string) => moduleZip(other.key, { id: "other.clock", name: "Clock", version, extra: [{ name: "own.bin", data: randomBytes(4096) }] });
    return { ...context, other, kept, copy, file: path.join(context.dir, "zips", `${sha(kept)}.zip`) };
  };
  const self = { moduleId: "other.clock", accountId: "someone", fingerprints: [] };

  it("stops holding other uploads back once a backfill has seen it, and comes back with its file", async () => {
    const { catalog, send, other, kept, copy, file } = await twoPublishers();
    rmSync(file);
    const held = await send(other, copy("1.0.0"));
    expect(held.status).toBe(202);
    expect(await held.json()).toMatchObject({ reasons: [expect.objectContaining({ check: "compare" })] });

    catalog.backfillSignedHashes();
    expect(catalog.uncomparedVersions(self)).toEqual([]);
    expect((await send(other, copy("1.0.1"))).status).toBe(201);
    expect(await catalog.openZip(sha(kept))).toBeNull();

    writeFileSync(file, kept);
    expect(catalog.backfillSignedHashes().filled).toBe(1);
    expect(await catalog.openZip(sha(kept))).not.toBeNull();
    expect(catalog.mostSimilar(self, copyHashes([shared]))).toMatchObject({ id: "wellbrained.timer" });
  });

  it("comes back as soon as a download finds the right file, with its hashes, without a restart", async () => {
    const { catalog, kept, file } = await twoPublishers();
    rmSync(file);
    catalog.backfillSignedHashes();
    expect(await catalog.openZip(sha(kept))).toBeNull();

    writeFileSync(file, kept);
    expect(await catalog.openZip(sha(kept))).not.toBeNull();
    expect(catalog.keptZipSize(sha(kept))).toBe(kept.length);
    expect(catalog.uncomparedVersions(self)).toEqual([]);
    expect(catalog.mostSimilar(self, copyHashes([shared]))).toMatchObject({ id: "wellbrained.timer" });
  });

  it("still serves a restored zip when its mark can't be written", async () => {
    const { catalog, kept, file } = await twoPublishers();
    rmSync(file);
    catalog.backfillSignedHashes();
    writeFileSync(file, kept);
    const db = (catalog as unknown as { db: DatabaseSync }).db;
    const prepare = db.prepare.bind(db);
    const refused = vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
      if (sql.startsWith("update versions set file_hashes = coalesce")) throw new Error("attempt to write a readonly database");
      return prepare(sql);
    });
    expect(await catalog.openZip(sha(kept))).not.toBeNull();
    expect(refused).toHaveBeenCalled();
  });

  it("lets a waiting version be approved once its right file is back", async () => {
    const { developer, send, approve, catalog, dir } = setup();
    const dev = developer("dev@example.com", false);
    const zip = moduleZip(dev.key);
    await send(dev, zip);
    const target = path.join(dir, "zips", `${sha(zip)}.zip`);
    const raw = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    raw.exec("update versions set file_hashes = null");
    raw.close();
    rmSync(target);
    catalog.backfillSignedHashes();
    expect((await approve(zip)).status).toBe(409);

    writeFileSync(target, zip);
    expect((await approve(zip)).status).toBe(200);
    expect(catalog.index()).toEqual([expect.objectContaining({ version: "1.0.0" })]);
  });

  it("treats a file that isn't what its name says the same way", async () => {
    const { catalog, file } = await twoPublishers();
    writeFileSync(file, "something else");
    catalog.backfillSignedHashes();
    expect(catalog.uncomparedVersions(self)).toEqual([]);
  });

  it("keeps waiting for a zip it only couldn't read right now", async () => {
    const { catalog, file } = await twoPublishers();
    rmSync(file);
    mkdirSync(file);
    catalog.backfillSignedHashes();
    expect(catalog.uncomparedVersions(self)).toEqual([{ id: "wellbrained.timer", version: "1.0.0" }]);
  });

  it("never brings back a zip that was pruned on purpose", async () => {
    const { catalog, dir, kept, file } = await twoPublishers();
    const raw = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    raw.prepare("update versions set zip_removed = ?, signed_sha256 = null").run(new Date().toISOString());
    raw.close();
    expect(existsSync(file)).toBe(true);
    expect(catalog.backfillSignedHashes().skipped).toEqual([expect.objectContaining({ reason: REMOVED_ZIP })]);
    expect(await catalog.openZip(sha(kept))).toBeNull();
  });
});

describe("downloading a zip", () => {
  const big = () => [{ name: "big.bin", data: randomBytes(300_000) }];
  const url = (hash: string) => `http://tavora.test/v1/catalog/zips/${hash}.zip`;

  it("sends it from disk with the headers the shipped app gets, never loading it whole", async () => {
    const { developer, send, catalog, app } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key, { extra: big() });
    await send(dev, zip);
    catalog.zip = () => {
      throw new Error("loaded whole");
    };
    const response = await app.request(url(sha(zip)));
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/zip",
      "content-length": String(zip.length),
      "content-disposition": "attachment",
      "cache-control": "public, max-age=31536000, immutable",
    });
    expect(Buffer.from(await response.arrayBuffer()).equals(zip)).toBe(true);
  });

  it("answers HEAD as before, with no body and no file opened", async () => {
    const { developer, send, app } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key);
    await send(dev, zip);
    const response = await app.request(url(sha(zip)), { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.body).toBeNull();
  });

  it("holds one small chunk at a time, however slowly it is read", async () => {
    const { developer, send, catalog } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key, { extra: big() });
    await send(dev, zip);
    const reader = (await catalog.openZip(sha(zip)))!.stream().getReader();
    const first = await reader.read();
    expect(first.value!.length).toBeLessThanOrEqual(64 * 1024);
    await reader.cancel();
    expect((await reader.read()).done).toBe(true);
  });

  it("answers 404 for a file that isn't what its name says, also after it was served", async () => {
    const { developer, send, app, dir } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key, { extra: big() });
    await send(dev, zip);
    await (await app.request(url(sha(zip)))).arrayBuffer();
    const changed = Buffer.from(zip);
    changed[100] = changed[100]! ^ 0xff;
    const file = path.join(dir, "zips", `${sha(zip)}.zip`);
    writeFileSync(file, changed);
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect((await app.request(url(sha(zip)))).status).toBe(404);
  });

  it("answers 404 for a zip of a module taken down", async () => {
    const { developer, send, catalog, app } = setup();
    const dev = developer("dev@example.com");
    const zip = moduleZip(dev.key);
    await send(dev, zip);
    catalog.setListed("wellbrained.timer", false);
    expect((await app.request(url(sha(zip)))).status).toBe(404);
  });
});

describe("the check of what is live", () => {
  it("says a zip too big for the budget is too big, not to run it again", async () => {
    const { catalog, store, developer, send } = setup();
    const dev = developer("dev@example.com");
    await send(dev, moduleZip(dev.key, { extra: [{ name: "big.bin", data: randomBytes(64 * 1024) }] }));
    const admin = moderationRoutes({ catalog, accounts: store, scanner: clean, memory: createUploadMemory(1024) });
    const response = await admin.request("http://admin.test/live-check", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const { result } = (await response.json()) as { result: { flagged: number; results: { error?: string }[] } };
    expect(result.flagged).toBe(1);
    expect(result.results[0]!.error).toBe("It's too big to check here.");
  });
});

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

  it("asks a retry sent during the first try's scan to come back, then answers it", async () => {
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
    while (started < 1) await new Promise((resolve) => setTimeout(resolve, 1));
    const retry = await send(dev, zip);
    expect(retry.status).toBe(429);
    expect(retry.headers.get("retry-after")).toBe("60");
    finish();
    expect((await first).status).toBe(201);
    expect((await send(dev, zip)).status).toBe(201);
    expect(started).toBe(1);
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

  it("approves a fixed version and lists the module in one step, so the bad version is never served again", async () => {
    const { developer, send, approve, approveAndList, catalog, reason } = setup();
    const dev = developer("dev@example.com");
    const bad = moduleZip(dev.key);
    await send(dev, bad);
    catalog.setListed("wellbrained.timer", false);
    const fixed = moduleZip(dev.key, { version: "1.0.1" });
    expect((await send(dev, fixed)).status).toBe(202);

    const refused = await approve(fixed);
    expect(refused.status).toBe(409);
    expect(await reason(refused)).toBe("taken-down");
    expect(catalog.index()).toEqual([]);
    expect(catalog.zip(sha(bad))).toBeNull();

    expect((await approveAndList(fixed)).status).toBe(200);
    expect(catalog.index()).toEqual([expect.objectContaining({ version: "1.0.1" })]);
    expect(catalog.isTakenDown("wellbrained.timer")).toBe(false);
  });

  it("won't approve and list a version while a newer one is listed, which would go live instead", async () => {
    const { developer, send, approve, approveAndList, catalog, reason } = setup();
    const dev = developer("dev@example.com");
    await send(dev, moduleZip(dev.key));
    const waiting = moduleZip(dev.key, { version: "1.1.0", network: ["example.org"] });
    expect((await send(dev, waiting)).status).toBe(202);
    expect((await send(dev, moduleZip(dev.key, { version: "1.2.0", network: [] }))).status).toBe(201);
    catalog.setListed("wellbrained.timer", false);

    for (const answer of [await approve(waiting), await approveAndList(waiting)]) {
      expect(answer.status).toBe(409);
      expect(await reason(answer)).toBe("newer-version-listed");
    }
    expect(catalog.isTakenDown("wellbrained.timer")).toBe(true);
    expect(catalog.waitingVersion(sha(waiting))).not.toBeNull();
    // It isn't a replacement either, so it doesn't stop the maintainer from deciding about the module.
    expect(catalog.replacementWaits("wellbrained.timer")).toBe(false);
  });

  it("stays taken down when its only waiting version is withdrawn, so a new upload can't list by itself", async () => {
    const { developer, send, withdraw, catalog } = setup();
    const dev = developer("dev@example.com", false);
    const first = moduleZip(dev.key);
    expect((await send(dev, first)).status).toBe(202);
    catalog.setListed("wellbrained.timer", false);
    expect((await withdraw(dev, first)).status).toBe(200);
    expect(catalog.isTakenDown("wellbrained.timer")).toBe(true);

    catalog.trustAccount(dev.accountId);
    const again = await send(dev, moduleZip(dev.key, { version: "1.0.1" }));
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ reasons: [expect.objectContaining({ check: "taken-down" })] });
    expect(catalog.index()).toEqual([]);
  });

  it("still forgets a module that was never taken down when its only version is withdrawn", async () => {
    const { developer, send, withdraw, catalog } = setup();
    const dev = developer("dev@example.com", false);
    const first = moduleZip(dev.key);
    await send(dev, first);
    await withdraw(dev, first);
    expect(catalog.adminModules()).toEqual([]);
  });
});

describe("room in the catalog", () => {
  const filler = (seed: number) => Array.from({ length: 4000 }, (_, index) => (index * seed * 7919) % 256);

  it("credits the zip an update replaces for one waiting version of a module, and for one that lists now", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const extra = [{ name: "data.bin", data: Buffer.from(filler(3)) }];
    const roomFor = moduleZip(key, { extra }).length;
    const { developer, send, withdraw, reason } = setup({ keepVersions: 1, accountBytes: Math.floor(roomFor * 1.5) });
    const dev = developer("dev@example.com");
    const data = (seed: number) => [{ name: "data.bin", data: Buffer.from(filler(seed)) }];
    expect((await send(dev, moduleZip(dev.key, { extra }))).status).toBe(201);

    // It waits, because it asks for more. It will replace the first zip, so that one counts as room.
    const update = moduleZip(dev.key, { version: "1.0.1", network: ["example.org"], extra: data(5) });
    expect((await send(dev, update)).status).toBe(202);
    // Only one waiting version gets that credit: a second has to fit next to both.
    const second = await send(dev, moduleZip(dev.key, { version: "1.0.2", network: ["example.org"], extra: data(7) }));
    expect(second.status).toBe(413);
    expect(await reason(second)).toBe("account-full");

    expect((await withdraw(dev, update)).status).toBe(200);
    // It lists at once, so the zip it pushes out counts as free.
    expect((await send(dev, moduleZip(dev.key, { version: "1.0.3", extra: data(9) }))).status).toBe(201);
  });

  it("doesn't count that credit against the whole catalog's disk", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const extra = [{ name: "data.bin", data: Buffer.from(filler(3)) }];
    const roomFor = moduleZip(key, { extra }).length;
    const { developer, send, reason } = setup({ keepVersions: 1, catalogBytes: Math.floor(roomFor * 1.5) });
    const dev = developer("dev@example.com");
    expect((await send(dev, moduleZip(dev.key, { extra }))).status).toBe(201);
    const refused = await send(dev, moduleZip(dev.key, { version: "1.0.1", network: ["example.org"], extra: [{ name: "data.bin", data: Buffer.from(filler(5)) }] }));
    expect(refused.status).toBe(507);
    expect(await reason(refused)).toBe("catalog-full");
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

  it("keeps the pictures of a waiting version whose zip is only marked missing", async () => {
    const { developer, send, catalog, dir, approve } = setup({ keepVersions: 1 });
    const dev = developer("dev@example.com");
    const waitingIcon = picture(7);
    const file = (data: Buffer) => path.join(dir, "pictures", `${sha(data)}.png`);

    const first = moduleZip(dev.key, { icon: picture(3) });
    expect((await send(dev, first)).status).toBe(202);
    expect((await approve(first)).status).toBe(200);
    const second = moduleZip(dev.key, { version: "1.1.0", icon: picture(5) });
    expect((await send(dev, second)).status).toBe(202);
    const later = moduleZip(dev.key, { version: "1.2.0", icon: waitingIcon });
    expect((await send(dev, later)).status).toBe(202);
    const laterFile = path.join(dir, "zips", `${sha(later)}.zip`);
    const raw = new DatabaseSync(path.join(dir, "catalog.sqlite"));
    raw.prepare("update versions set file_hashes = null where sha256 = ?").run(sha(later));
    raw.close();
    rmSync(laterFile);
    catalog.backfillSignedHashes();
    expect((await approve(later)).status).toBe(409);

    // Approving 1.1.0 prunes 1.0.0; the waiting 1.2.0's zip is gone for now, but it comes back.
    expect((await approve(second)).status).toBe(200);
    expect(existsSync(file(waitingIcon))).toBe(true);

    writeFileSync(laterFile, later);
    expect((await approve(later)).status).toBe(200);
    expect(catalog.picture(sha(waitingIcon), "png")).not.toBeNull();
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
