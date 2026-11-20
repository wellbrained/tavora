import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { COPY_LIMIT, copyLimitsFromEnv, CopyStore, FREE_FLOOR, MAX_PART_BYTES, readParts, readSwap, STORED_LIMIT, TOTAL_LIMIT, UNUSED_PART_MS, writeParts, type CopyStoreOptions } from "./cloud-copy.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

function setup(options: CopyStoreOptions = {}) {
  const store = new AccountStore(":memory:");
  const copies = new CopyStore(":memory:", options);
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-19T12:00:00Z") };
  const app = createApp({ db, rateLimiter: roomy(), accounts: { store, mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now, copies } });
  const json = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test/v1/account${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const copy = (method: string, path: string, token: string, body?: Uint8Array) =>
    app.request(`http://tavora.test/v1/account/copy${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/octet-stream" } : {}) },
      ...(body ? { body } : {}),
    });
  const signIn = async (email: string) => {
    await json("POST", "/code", { email });
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
    inbox.clear();
    return ((await (await json("POST", "/verify", { email, code, create: true })).json()) as { token: string }).token;
  };
  return { store, copies, clock, app, json, copy, signIn, inbox };
}

const part = (size = 100) => ({ id: new Uint8Array(randomBytes(32)), data: new Uint8Array(randomBytes(size)) });
/** A new version's body: base, part count, ids, manifest. */
function swapBody(base: number, ids: Uint8Array[], manifest: Uint8Array) {
  const out = new Uint8Array(8 + ids.length * 32 + manifest.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, base);
  view.setUint32(4, ids.length);
  ids.forEach((id, index) => out.set(id, 8 + index * 32));
  out.set(manifest, 8 + ids.length * 32);
  return out;
}

describe("the cloud copy's framing", () => {
  it("reads back the parts it wrote", () => {
    const parts = [part(10), part(2000)];
    const read = readParts(writeParts(parts))!;
    expect(read.map((p) => Buffer.from(p.data).equals(Buffer.from(parts[read.indexOf(p)]!.data)))).toEqual([true, true]);
  });

  it("refuses broken or empty uploads", () => {
    expect(readParts(new Uint8Array(0))).toBeNull();
    const body = writeParts([part(10)]);
    expect(readParts(body.subarray(0, body.length - 1))).toBeNull();
    const zero = writeParts([{ id: new Uint8Array(32), data: new Uint8Array(0) }]);
    expect(readParts(zero)).toBeNull();
    const huge = new Uint8Array(36);
    new DataView(huge.buffer).setUint32(32, MAX_PART_BYTES + 1);
    expect(readParts(huge)).toBeNull();
  });

  it("reads a new version and refuses one without a manifest", () => {
    const ids = [part().id, part().id];
    expect(readSwap(swapBody(3, ids, new Uint8Array([1, 2, 3])))).toMatchObject({ base: 3, parts: ids, manifest: new Uint8Array([1, 2, 3]) });
    expect(readSwap(swapBody(0, ids, new Uint8Array(0)))).toBeNull();
    expect(readSwap(new Uint8Array(4))).toBeNull();
  });
});

describe("the cloud copy", () => {
  it("is empty at first and needs a sign-in", async () => {
    const { copy, signIn, app } = setup();
    const token = await signIn("me@example.com");
    expect(await (await copy("GET", "", token)).json()).toEqual({ copy: null, limit: COPY_LIMIT });
    expect((await copy("GET", "/manifest", token)).status).toBe(404);
    expect((await app.request("http://tavora.test/v1/account/copy")).status).toBe(401);
    expect((await copy("GET", "", "x".repeat(43))).status).toBe(401);
  });

  it("stores parts and a version, and gives them back", async () => {
    const { copy, signIn } = setup();
    const token = await signIn("me@example.com");
    const parts = [part(500), part(700)];
    expect(await (await copy("POST", "/parts", token, writeParts(parts))).json()).toEqual({ stored: 2 });
    const manifest = new Uint8Array(randomBytes(64));
    const saved = await copy("PUT", "", token, swapBody(0, parts.map((p) => p.id), manifest));
    expect(await saved.json()).toEqual({ version: 1, size: 1264 });
    expect(await (await copy("GET", "", token)).json()).toEqual({ copy: { version: 1, size: 1264, updatedAt: "2026-10-19T12:00:00.000Z" }, limit: COPY_LIMIT });

    const got = await copy("GET", "/manifest", token);
    expect(got.headers.get("x-copy-version")).toBe("1");
    expect(got.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await got.arrayBuffer()).equals(Buffer.from(manifest))).toBe(true);

    const ask = new Uint8Array(64);
    ask.set(parts[1]!.id, 0);
    ask.set(randomBytes(32), 32); // one it never had
    const back = readParts(new Uint8Array(await (await copy("POST", "/parts/get", token, ask)).arrayBuffer()))!;
    expect(back).toHaveLength(1);
    expect(Buffer.from(back[0]!.data).equals(Buffer.from(parts[1]!.data))).toBe(true);
  });

  it("refuses a version that did not start from the current one", async () => {
    const { copy, signIn } = setup();
    const token = await signIn("me@example.com");
    const a = part();
    await copy("POST", "/parts", token, writeParts([a]));
    expect((await copy("PUT", "", token, swapBody(0, [a.id], new Uint8Array([1])))).status).toBe(200);
    // A second PC that last saw no copy, or version 0, finds version 1 there now.
    const stale = await copy("PUT", "", token, swapBody(0, [a.id], new Uint8Array([2])));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reason: "copy-changed", version: 1 });
    expect(await (await copy("PUT", "", token, swapBody(1, [a.id], new Uint8Array([2])))).json()).toEqual({ version: 2, size: 101 });
  });

  it("never numbers a new copy like a deleted one, so a PC that missed the delete can't write over it", async () => {
    const { copy, signIn, copies, store } = setup();
    const token = await signIn("me@example.com");
    const a = part();
    await copy("POST", "/parts", token, writeParts([a]));
    await copy("PUT", "", token, swapBody(0, [a.id], new Uint8Array([1])));
    await copy("PUT", "", token, swapBody(1, [a.id], new Uint8Array([2])));
    await copy("DELETE", "", token);
    // Another PC starts a new copy: it goes on from the deleted one's number.
    await copy("POST", "/parts", token, writeParts([a]));
    expect(await (await copy("PUT", "", token, swapBody(0, [a.id], new Uint8Array([3])))).json()).toMatchObject({ version: 3 });
    // A PC that last saw version 2 of the deleted copy is refused.
    expect((await copy("PUT", "", token, swapBody(2, [a.id], new Uint8Array([4])))).status).toBe(409);
    // A deleted account takes the number with it.
    const accountId = store.sessionByToken(token, Date.now())!.accountId;
    copies.remove(accountId, true);
    expect(copies.info(accountId)).toBeNull();
    expect(copies.swap(accountId, 0, new Uint8Array([5]), [], Date.now())).toMatchObject({ ok: true, version: 1 });
  });

  it("refuses a version whose parts are missing, and drops parts no version uses", async () => {
    const { copy, signIn, copies, store } = setup();
    const token = await signIn("me@example.com");
    const [a, b] = [part(), part()];
    await copy("POST", "/parts", token, writeParts([a, b]));
    const missing = await copy("PUT", "", token, swapBody(0, [a.id, part().id], new Uint8Array([1])));
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({ reason: "missing-parts", missing: 1 });
    await copy("PUT", "", token, swapBody(0, [a.id], new Uint8Array([1])));
    const accountId = store.accountByEmail("me@example.com")!.id;
    expect(copies.stored(accountId)).toBe(100);
    expect(copies.parts(accountId, [b.id])).toEqual([]);
  });

  it("keeps a copy within 100 MB, and stored parts within twice that", async () => {
    const copies = new CopyStore(":memory:");
    const big = (n: number) => ({ id: new Uint8Array(randomBytes(32)), data: new Uint8Array(n) });
    const parts = Array.from({ length: 26 }, () => big(4 * 1024 * 1024));
    expect(copies.addParts("acc", parts)).toBe("ok");
    const result = copies.swap("acc", 0, new Uint8Array([1]), parts.map((p) => p.id), 1);
    expect(result).toMatchObject({ ok: false, reason: "copy-full" });
    const fits = parts.slice(0, 24);
    expect(copies.swap("acc", 0, new Uint8Array([1]), fits.map((p) => p.id), 1)).toMatchObject({ ok: true, version: 1 });
    expect(copies.stored("acc")).toBe(24 * 4 * 1024 * 1024);
    // Uploading the next version while the old one is still there: up to STORED_LIMIT, then refused.
    const room = Math.floor((STORED_LIMIT - copies.stored("acc")) / (4 * 1024 * 1024));
    expect(copies.addParts("acc", Array.from({ length: room }, () => big(4 * 1024 * 1024)))).toBe("ok");
    expect(copies.addParts("acc", [big(4 * 1024 * 1024)])).toBe("copy-full");
  });

  it("keeps the copies of every account within a total, counted through every change", () => {
    const copies = new CopyStore(":memory:", { totalLimit: 1000 });
    const a = [part(300), part(300)];
    expect(copies.addParts("a", a)).toBe("ok");
    expect(copies.addParts("b", [part(300)])).toBe("ok");
    expect(copies.storedTotal()).toBe(900);
    // Another account, well inside its own limit, finds no room left; nothing of it is stored.
    expect(copies.addParts("c", [part(200)])).toBe("no-room");
    expect(copies.stored("c")).toBe(0);
    // Parts it has already cost nothing, so they always go through.
    expect(copies.addParts("a", [a[0]!])).toBe("ok");
    // A version that keeps one part drops the other (its manifest counts too), and deleting a copy frees all of it.
    expect(copies.swap("a", 0, new Uint8Array(10), [a[0]!.id], 1)).toMatchObject({ ok: true });
    expect(copies.storedTotal()).toBe(610);
    expect(copies.swap("a", 1, new Uint8Array(4), [a[0]!.id], 2)).toMatchObject({ ok: true });
    expect(copies.storedTotal()).toBe(604);
    copies.remove("b");
    expect(copies.storedTotal()).toBe(304);
    expect(copies.addParts("c", [part(200)])).toBe("ok");
    expect(copies.storedTotal()).toBe(504);
    copies.remove("a");
    expect(copies.storedTotal()).toBe(200);
  });

  it("counts what is stored already when it starts, manifests too", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tavora-copies-")), "copies.sqlite");
    const first = new CopyStore(file);
    const kept = part(400);
    first.addParts("a", [kept, part(100)]);
    first.swap("a", 0, new Uint8Array(50), [kept.id], 1);
    expect(new CopyStore(file).storedTotal()).toBe(450);
    expect(new CopyStore(file, { totalLimit: 600 }).addParts("b", [part(200)])).toBe("no-room");
  });

  it("needs room for a bigger manifest as for parts", async () => {
    const copies = new CopyStore(":memory:", { totalLimit: 1000 });
    const a = part(500);
    copies.addParts("a", [a]);
    expect(copies.swap("a", 0, new Uint8Array(400), [a.id], 1)).toMatchObject({ ok: true });
    copies.addParts("b", [part(90)]);
    // 990 stored: a bigger manifest has no room, the same size or smaller always has.
    expect(copies.swap("a", 1, new Uint8Array(420), [a.id], 2)).toEqual({ ok: false, reason: "unavailable" });
    expect(copies.info("a")?.version).toBe(1);
    expect(copies.swap("a", 1, new Uint8Array(400), [a.id], 3)).toMatchObject({ ok: true, version: 2 });
    expect(copies.swap("a", 2, new Uint8Array(10), [a.id], 4)).toMatchObject({ ok: true, version: 3 });
    expect(copies.storedTotal()).toBe(600);
    // The free-space floor holds for a manifest too.
    let free = 10_000;
    const tight = new CopyStore(":memory:", { freeBytes: () => free, freeFloor: 9_000 });
    expect(tight.swap("x", 0, new Uint8Array(500), [], 1)).toMatchObject({ ok: true });
    free = 9_200;
    expect(tight.swap("x", 1, new Uint8Array(800), [], 2)).toEqual({ ok: false, reason: "unavailable" });
    // Over the routes: 503, which the app takes as "try again later".
    const { copy, signIn, copies: routed } = setup({ totalLimit: 1000 });
    const token = await signIn("me@example.com");
    const b = part(100);
    expect((await copy("POST", "/parts", token, writeParts([b]))).status).toBe(200);
    routed.addParts("someone-else", [part(880)]);
    const refused = await copy("PUT", "", token, swapBody(0, [b.id], new Uint8Array(50)));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ reason: "unavailable" });
  });

  it("drops parts no saved version uses once they are a day old, and keeps the total right", () => {
    const copies = new CopyStore(":memory:");
    const day = UNUSED_PART_MS;
    const used = part(100);
    const unusedOld = part(200);
    copies.addParts("a", [used, unusedOld], 1000);
    copies.swap("a", 0, new Uint8Array(5), [used.id], 2000);
    // After the save: one part that never got saved, and one still fresh.
    const late = part(300);
    copies.addParts("a", [late], 3000);
    const fresh = part(50);
    copies.addParts("a", [fresh], 3000 + day);
    // An account that uploaded and never saved.
    copies.addParts("b", [part(400)], 1000);
    expect(copies.storedTotal()).toBe(100 + 5 + 300 + 50 + 400);
    expect(copies.sweep(3000 + day + 1)).toEqual({ parts: 2, bytes: 700 });
    expect(copies.parts("a", [used.id, late.id, fresh.id]).map((p) => p.data.length)).toEqual([100, 50]);
    expect(copies.stored("b")).toBe(0);
    expect(copies.storedTotal()).toBe(155);
    // The running total matches what is there.
    const db = (copies as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db;
    expect(db.prepare("select (select sum(size) from parts) + (select sum(length(manifest)) from copies) as total").get()).toEqual({ total: 155 });
    // A saved version keeps what it uses, however old.
    expect(copies.sweep(10 * day)).toEqual({ parts: 1, bytes: 50 });
    expect(copies.parts("a", [used.id])).toHaveLength(1);
    expect(copies.storedTotal()).toBe(105);
  });

  it("counts parts from before their time as old: kept with a copy until its next save, dropped without one", () => {
    const copies = new CopyStore(":memory:");
    const db = (copies as unknown as { db: { exec(sql: string): void } }).db;
    const used = part(100);
    copies.addParts("a", [used], 1000);
    copies.swap("a", 0, new Uint8Array(5), [used.id], 2000);
    copies.addParts("a", [part(30)], 3000);
    copies.addParts("b", [part(40)], 3000);
    db.exec("update parts set created_at = null");
    expect(copies.sweep(3000 + UNUSED_PART_MS + 1)).toEqual({ parts: 1, bytes: 40 });
    expect(copies.stored("a")).toBe(130);
  });

  it("never drops a part a version uses, even when the clock went back before saving it", () => {
    const copies = new CopyStore(":memory:");
    const used = part(100);
    copies.addParts("a", [used], 50_000);
    copies.swap("a", 0, new Uint8Array(5), [used.id], 10_000);
    expect(copies.info("a")?.updatedAt).toBe(50_000);
    expect(copies.sweep(50_000 + 2 * UNUSED_PART_MS)).toEqual({ parts: 0, bytes: 0 });
  });

  it("sweeps for room before it refuses, at most once a minute", () => {
    const copies = new CopyStore(":memory:", { totalLimit: 1000 });
    copies.addParts("idle", [part(900)], 0);
    // A day later the idle upload goes to make room.
    expect(copies.addParts("a", [part(200)], UNUSED_PART_MS + 1)).toBe("ok");
    expect(copies.stored("idle")).toBe(0);
    copies.addParts("b", [part(700)], UNUSED_PART_MS + 2);
    copies.sweep(UNUSED_PART_MS + 3);
    // Full of fresh parts: refused, and the next try within the minute doesn't sweep again.
    const sweep = vi.spyOn(copies, "sweep");
    expect(copies.addParts("c", [part(200)], UNUSED_PART_MS + 10)).toBe("no-room");
    expect(sweep).not.toHaveBeenCalled();
    expect(copies.addParts("c", [part(200)], UNUSED_PART_MS + 120_000)).toBe("no-room");
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("leaves the total as it was when a save or a delete fails part way", () => {
    const copies = new CopyStore(":memory:");
    const a = part(100);
    const b = part(200);
    copies.addParts("acc", [a, b], 1);
    copies.swap("acc", 0, new Uint8Array(5), [a.id, b.id], 2);
    const before = copies.storedTotal();
    const db = (copies as unknown as { db: { prepare(sql: string): unknown } }).db;
    const prepare = db.prepare.bind(db);
    const failOn = (text: string) =>
      vi.spyOn(db, "prepare").mockImplementation((sql: string) => {
        if (sql.startsWith(text)) throw new Error("disk went away");
        return prepare(sql);
      });
    const spy = failOn("delete from parts where account_id = ? and id = ?");
    expect(() => copies.swap("acc", 1, new Uint8Array(50), [a.id], 3)).toThrow("disk went away");
    spy.mockRestore();
    expect(copies.storedTotal()).toBe(before);
    expect(copies.info("acc")).toMatchObject({ version: 1 });
    const again = failOn("delete from copies where account_id = ?");
    expect(() => copies.remove("acc")).toThrow("disk went away");
    again.mockRestore();
    expect(copies.storedTotal()).toBe(before);
    expect(copies.stored("acc")).toBe(300);
  });

  it("leaves free space on the disk", () => {
    let free = 10_000;
    const copies = new CopyStore(":memory:", { freeBytes: () => free, freeFloor: 9_000 });
    expect(copies.addParts("a", [part(1000)])).toBe("ok");
    free = 9_500;
    expect(copies.addParts("a", [part(1000)])).toBe("no-room");
    // A disk it can't read doesn't stop uploads.
    const unknown = new CopyStore(":memory:", { freeBytes: () => null, freeFloor: 9_000 });
    expect(unknown.addParts("a", [part(1000)])).toBe("ok");
  });

  it("reads its limits from the environment, in GiB", () => {
    const warnings: string[] = [];
    const warn = (message: string) => warnings.push(message);
    const dir = mkdtempSync(path.join(tmpdir(), "tavora-copies-"));
    expect(copyLimitsFromEnv({}, dir, warn)).toMatchObject({ totalLimit: TOTAL_LIMIT, freeFloor: FREE_FLOOR });
    expect(TOTAL_LIMIT).toBe(20 * 1024 ** 3);
    expect(copyLimitsFromEnv({ COPY_TOTAL_LIMIT_GB: "50", COPY_FREE_FLOOR_GB: "0.5" }, dir, warn)).toMatchObject({ totalLimit: 50 * 1024 ** 3, freeFloor: 512 * 1024 ** 2 });
    expect(copyLimitsFromEnv({ COPY_FREE_FLOOR_GB: "0" }, dir, warn).freeFloor).toBe(0);
    expect(warnings).toEqual([]);
    expect(copyLimitsFromEnv({ COPY_TOTAL_LIMIT_GB: "lots", COPY_FREE_FLOOR_GB: "-1" }, dir, warn)).toMatchObject({ totalLimit: TOTAL_LIMIT, freeFloor: FREE_FLOOR });
    expect(warnings).toHaveLength(2);
    // The real disk's free space, and null for a folder that isn't there.
    expect(copyLimitsFromEnv({}, dir, warn).freeBytes()).toBeGreaterThan(0);
    expect(copyLimitsFromEnv({}, path.join(dir, "missing"), warn).freeBytes()).toBeNull();
  });

  it("answers the full error over the routes", async () => {
    const { copy, signIn, copies, store } = setup();
    const token = await signIn("me@example.com");
    const accountId = store.accountByEmail("me@example.com")!.id;
    copies.addParts(accountId, Array.from({ length: 50 }, () => ({ id: new Uint8Array(randomBytes(32)), data: new Uint8Array(4 * 1024 * 1024) })));
    const full = await copy("POST", "/parts", token, writeParts([part()]));
    expect(full.status).toBe(413);
    expect(await full.json()).toMatchObject({ reason: "copy-full" });
  });

  it("answers 503 over the routes when the copies of all accounts have no room", async () => {
    const { copy, signIn, copies } = setup({ totalLimit: 1000 });
    copies.addParts("someone-else", [part(950)]);
    const token = await signIn("me@example.com");
    const full = await copy("POST", "/parts", token, writeParts([part()]));
    expect(full.status).toBe(503);
    expect(await full.json()).toMatchObject({ reason: "unavailable" });
  });

  it("gives back parts up to about 8 MB per answer, at least one", () => {
    const copies = new CopyStore(":memory:");
    const parts = Array.from({ length: 4 }, () => ({ id: new Uint8Array(randomBytes(32)), data: new Uint8Array(3 * 1024 * 1024) }));
    copies.addParts("acc", parts);
    expect(copies.parts("acc", parts.map((p) => p.id))).toHaveLength(2);
    expect(copies.parts("acc", parts.map((p) => p.id), 10)).toHaveLength(1);
  });

  it("only takes octet-stream bodies", async () => {
    const { app, signIn } = setup();
    const token = await signIn("me@example.com");
    const response = await app.request("http://tavora.test/v1/account/copy/parts", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" }, body: "x" });
    expect(response.status).toBe(415);
  });

  it("keeps each account's copy apart", async () => {
    const { copy, signIn } = setup();
    const mine = await signIn("me@example.com");
    const theirs = await signIn("you@example.com");
    const a = part();
    await copy("POST", "/parts", mine, writeParts([a]));
    await copy("PUT", "", mine, swapBody(0, [a.id], new Uint8Array([1])));
    expect(await (await copy("GET", "", theirs)).json()).toMatchObject({ copy: null });
    expect((await copy("POST", "/parts/get", theirs, a.id)).headers.get("content-length") ?? "0").toBe("0");
    expect(await (await copy("PUT", "", theirs, swapBody(0, [a.id], new Uint8Array([1])))).json()).toMatchObject({ reason: "missing-parts" });
  });

  it("is deleted by its button and with the account", async () => {
    const { copy, signIn, json, inbox, copies, store } = setup();
    const token = await signIn("me@example.com");
    const accountId = store.accountByEmail("me@example.com")!.id;
    const a = part();
    await copy("POST", "/parts", token, writeParts([a]));
    await copy("PUT", "", token, swapBody(0, [a.id], new Uint8Array([1])));
    expect((await copy("DELETE", "", token)).status).toBe(204);
    expect(copies.info(accountId)).toBeNull();
    expect(copies.stored(accountId)).toBe(0);

    await copy("POST", "/parts", token, writeParts([a]));
    await copy("PUT", "", token, swapBody(0, [a.id], new Uint8Array([1])));
    await json("POST", "/delete/code", {}, token);
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
    expect((await json("POST", "/delete", { code }, token)).status).toBe(204);
    expect(copies.info(accountId)).toBeNull();
    expect(copies.stored(accountId)).toBe(0);
  });

  it("answers 503 without accounts", async () => {
    const app = createApp({ db });
    expect((await app.request("http://tavora.test/v1/account/copy")).status).toBe(503);
    expect((await app.request("http://tavora.test/v1/account/copy/manifest")).status).toBe(503);
  });
});
