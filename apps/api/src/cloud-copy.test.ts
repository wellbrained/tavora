import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { COPY_LIMIT, copyLimitsFromEnv, CopyStore, FREE_FLOOR, MAX_PART_BYTES, NETWORK_DAY_LIMIT, NETWORK_SHARE, NEW_ACCOUNT_MS, NEW_ACCOUNT_SHARE, readParts, readSwap, STORED_LIMIT, TOTAL_LIMIT, UNUSED_PART_MS, writeParts, type CopyHolder, type CopyStoreOptions } from "./cloud-copy.ts";
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

  it("keeps room for accounts with a copy to replace their own version when saved versions fill the total (audit)", () => {
    // As the audit planned it, at a smaller scale: saved versions fill the total, and nothing ages out.
    const copies = new CopyStore(":memory:", { totalLimit: 1604 });
    const saved = new Map<string, ReturnType<typeof part>>();
    for (const id of ["a1", "a2", "a3", "a4"]) {
      const kept = part(400);
      saved.set(id, kept);
      expect(copies.addParts(id, [kept], 0)).toBe("ok");
      expect(copies.swap(id, 0, new Uint8Array(1), [kept.id], 1)).toMatchObject({ ok: true, version: 1 });
    }
    expect(copies.sweep(2 * UNUSED_PART_MS)).toEqual({ parts: 0, bytes: 0 });
    expect(copies.storedTotal()).toBe(1604);
    // An account without a copy finds no room ...
    expect(copies.addParts("b", [part(100)], 2 * UNUSED_PART_MS)).toBe("no-room");
    // ... one with a copy still uploads its next version, as big as the one it has, and saves it.
    const next = part(400);
    expect(copies.addParts("a4", [next], 2 * UNUSED_PART_MS)).toBe("ok");
    expect(copies.swap("a4", 1, new Uint8Array(1), [next.id], 2 * UNUSED_PART_MS)).toMatchObject({ ok: true, version: 2 });
    expect(copies.storedTotal()).toBe(1604);
    // Only growth needs room in the total.
    const after = 2 * UNUSED_PART_MS + 1000;
    expect(copies.addParts("a4", [part(200), part(300)], after)).toBe("no-room");
    expect(copies.addParts("a4", [part(400)], after)).toBe("ok");
    expect(copies.addParts("a4", [part(1)], after)).toBe("no-room");
    // Unsaved, the extra goes after a day, and the total is what it was.
    copies.sweep(4 * UNUSED_PART_MS);
    expect(copies.storedTotal()).toBe(1604);
  });

  it("lets accounts younger than a week hold only a quarter of the total together", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const day = 24 * 60 * 60_000;
    const copies = new CopyStore(":memory:", { totalLimit: 1000 });
    const young = { since: now - day };
    expect(copies.addParts("y1", [part(200)], now, young)).toBe("ok");
    const kept = part(30);
    expect(copies.addParts("y2", [kept], now, young)).toBe("ok");
    expect(copies.swap("y2", 0, new Uint8Array(10), [kept.id], now, young)).toMatchObject({ ok: true });
    // 240 of 250: no room for 20 more, from any young account; their manifests count too.
    expect(copies.addParts("y3", [part(20)], now, young)).toBe("no-room");
    expect(copies.swap("y2", 1, new Uint8Array(30), [kept.id], now, young)).toEqual({ ok: false, reason: "unavailable" });
    expect(copies.addParts("y3", [part(10)], now, young)).toBe("ok");
    // Older accounts still have the rest.
    expect(copies.addParts("old", [part(400)], now, { since: now - 30 * day })).toBe("ok");
    expect(copies.addParts("legacy", [part(10)], now)).toBe("ok");
    // A week on, those accounts are no longer young: their bytes leave the slice.
    const later = now + 7 * day;
    expect(copies.addParts("y4", [part(250)], later, { since: later - day })).toBe("ok");
    expect(copies.addParts("y5", [part(30)], later, { since: later - day })).toBe("no-room");
    // Deleting an account frees its share of the slice.
    copies.remove("y4", true);
    expect(copies.addParts("y5", [part(30)], later, { since: later - day })).toBe("ok");
  });

  it("never lets uploading and saving again grow a copy past the total, the young slice or the network's day (review)", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const day = 24 * 60 * 60_000;
    /** Saves `start` bytes, then over and over uploads as much again (the room for its next version) and saves both. */
    const grow = (copies: CopyStore, who: { since: number; network?: string } | undefined, start: number) => {
      const first = part(start);
      expect(copies.addParts("a", [first], now, who)).toBe("ok");
      let kept = [first.id];
      expect(copies.swap("a", 0, new Uint8Array(1), kept, now, who)).toMatchObject({ ok: true });
      let refused = false;
      for (let round = 1; round <= 16 && !refused; round++) {
        const saved = copies.info("a")!.size - 1;
        const next = part(saved);
        expect(copies.addParts("a", [next], now + round, who)).toBe("ok");
        const result = copies.swap("a", round, new Uint8Array(1), [...kept, next.id], now + round, who);
        if (result.ok) kept = [...kept, next.id];
        else {
          expect(result).toEqual({ ok: false, reason: "unavailable" });
          refused = true;
        }
      }
      expect(refused).toBe(true);
      return copies.info("a")!.size;
    };
    // The total: 1 + 100, 200, 400, 800, then 1600 doesn't fit in 1000.
    const total = new CopyStore(":memory:", { totalLimit: 1000 });
    expect(grow(total, undefined, 100)).toBe(801);
    total.sweep(now + 2 * day);
    expect(total.storedTotal()).toBe(801);
    // The young accounts' slice: a quarter of 100 000.
    expect(grow(new CopyStore(":memory:", { totalLimit: 100_000 }), { since: now - day }, 1000)).toBe(16_001);
    // The network's day: 1000 counted at the upload, then 1000, 2000 when saved; 4000 more doesn't fit in 5000.
    expect(grow(new CopyStore(":memory:", { networkDayLimit: 5000 }), { since: now - 30 * day, network: "198.51.100.0/24" }, 1000)).toBe(4001);
  });

  it("counts bytes against the network's day once, at the upload or at the save", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const who = { since: now - 30 * 24 * 60 * 60_000, network: "198.51.100.0/24" };
    const copies = new CopyStore(":memory:", { networkDayLimit: 1000 });
    const kept = part(600);
    expect(copies.addParts("a", [kept], now, who)).toBe("ok");
    expect(copies.swap("a", 0, new Uint8Array(1), [kept.id], now, who)).toMatchObject({ ok: true });
    // 601 counted: 399 left for the network.
    expect(copies.addParts("b", [part(400)], now, who)).toBe("no-room");
    expect(copies.addParts("b", [part(399)], now, who)).toBe("ok");
  });

  it("lets one network add at most its bytes a day to the total, but never stops a version that replaces one", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    const old = (network: string) => ({ since: now - 30 * 24 * 60 * 60_000, network });
    const copies = new CopyStore(":memory:", { networkDayLimit: 1000 });
    const kept = part(600);
    expect(copies.addParts("a", [kept], now, old("198.51.100.0/24"))).toBe("ok");
    expect(copies.swap("a", 0, new Uint8Array(1), [kept.id], now, old("198.51.100.0/24"))).toMatchObject({ ok: true });
    expect(copies.addParts("b", [part(400)], now, old("198.51.100.0/24"))).toBe("no-room");
    expect(copies.addParts("b", [part(399)], now, old("198.51.100.0/24"))).toBe("ok");
    expect(copies.addParts("c", [part(400)], now, old("203.0.113.0/24"))).toBe("ok");
    // Replacing its own version draws nothing from the network's day.
    expect(copies.addParts("a", [part(600)], now, old("198.51.100.0/24"))).toBe("ok");
    // A day later the network has its bytes again.
    expect(copies.addParts("b", [part(400)], now + 24 * 60 * 60_000, old("198.51.100.0/24"))).toBe("ok");
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
    expect(copyLimitsFromEnv({}, dir, warn)).toMatchObject({ newAccountMs: NEW_ACCOUNT_MS, newAccountShare: NEW_ACCOUNT_SHARE, networkDayLimit: NETWORK_DAY_LIMIT });
    expect([NEW_ACCOUNT_MS, NEW_ACCOUNT_SHARE, NETWORK_DAY_LIMIT]).toEqual([7 * 24 * 60 * 60_000, 0.25, 2 * 1024 ** 3]);
    expect(copyLimitsFromEnv({ COPY_NEW_ACCOUNT_DAYS: "3", COPY_NEW_ACCOUNT_SHARE: "0.1", COPY_NETWORK_DAY_GB: "0.5" }, dir, warn)).toMatchObject({
      newAccountMs: 3 * 24 * 60 * 60_000,
      newAccountShare: 0.1,
      networkDayLimit: 512 * 1024 ** 2,
    });
    expect(warnings).toEqual([]);
    expect(copyLimitsFromEnv({ COPY_TOTAL_LIMIT_GB: "lots", COPY_FREE_FLOOR_GB: "-1" }, dir, warn)).toMatchObject({ totalLimit: TOTAL_LIMIT, freeFloor: FREE_FLOOR });
    expect(warnings).toHaveLength(2);
    expect(copyLimitsFromEnv({ COPY_NEW_ACCOUNT_SHARE: "2", COPY_NEW_ACCOUNT_DAYS: "soon" }, dir, warn)).toMatchObject({ newAccountShare: NEW_ACCOUNT_SHARE, newAccountMs: NEW_ACCOUNT_MS });
    expect(warnings).toHaveLength(4);
    expect(NETWORK_SHARE).toBe(0.1);
    expect(copyLimitsFromEnv({}, dir, warn).networkShare).toBe(NETWORK_SHARE);
    expect(copyLimitsFromEnv({ COPY_NETWORK_SHARE: "0.05" }, dir, warn).networkShare).toBe(0.05);
    expect(copyLimitsFromEnv({ COPY_NETWORK_SHARE: "0" }, dir, warn).networkShare).toBe(0);
    expect(copyLimitsFromEnv({ COPY_NETWORK_SHARE: "1.5" }, dir, warn).networkShare).toBe(NETWORK_SHARE);
    expect(warnings).toHaveLength(5);
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

  it("answers 503 over the routes when young accounts used up their slice, without telling the log the copies are full", async () => {
    const { copy, signIn, clock } = setup({ totalLimit: 1000, networkShare: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const token = await signIn("new@example.com");
      expect((await copy("POST", "/parts", token, writeParts([part(200)]))).status).toBe(200);
      const refused = await copy("POST", "/parts", token, writeParts([part(100)]));
      expect([refused.status, ((await refused.json()) as { reason: string }).reason]).toEqual([503, "unavailable"]);
      expect(warn).not.toHaveBeenCalled();
      // A week on, the account is no longer young.
      clock.now += 7 * 24 * 60 * 60_000;
      expect((await copy("POST", "/parts", token, writeParts([part(100)]))).status).toBe(200);
    } finally {
      warn.mockRestore();
    }
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

describe("the cloud copy's shares of the total (audit)", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  const day = 24 * 60 * 60_000;
  const minute = 60_000;
  const aged = (network?: string) => ({ since: now - 30 * day, ...(network === undefined ? {} : { network }) });
  /** Stores one part of `size` bytes for the account and saves it as its copy, with a 1-byte manifest. */
  const save = (copies: CopyStore, accountId: string, size: number, who: CopyHolder | undefined, at = now) => {
    const kept = part(size);
    expect(copies.addParts(accountId, [kept], at, who)).toBe("ok");
    expect(copies.swap(accountId, copies.info(accountId)?.version ?? 0, new Uint8Array(1), [kept.id], at, who)).toMatchObject({ ok: true });
    return kept;
  };

  it("never lets the bytes on top of a copy take room in the total or the network's day from anyone else (audit)", () => {
    // As the audit planned it, without the networks' shares of the total, which it didn't know.
    const copies = new CopyStore(":memory:", { totalLimit: 1000, networkDayLimit: 600, networkShare: 0 });
    for (const id of ["a1", "a2"]) save(copies, id, 250, aged("n1"));
    expect([copies.storedTotal(), copies.pooledTotal()]).toEqual([502, 502]);
    // Each uploads its next version, as big as its copy: on top of it, counted nowhere.
    for (const id of ["a1", "a2"]) expect(copies.addParts(id, [part(250)], now + minute, aged("n1"))).toBe("ok");
    expect([copies.storedTotal(), copies.pooledTotal()]).toEqual([1002, 502]);
    // n1's day has 98 left: the bytes on top weren't counted there.
    expect(copies.addParts("c", [part(98)], now + minute, aged("n1"))).toBe("ok");
    expect(copies.addParts("c", [part(1)], now + minute, aged("n1"))).toBe("no-room");
    // Another account has the rest of the total.
    expect(copies.addParts("b", [part(50)], now + 2 * minute, aged("n2"))).toBe("ok");
    expect(copies.addParts("b", [part(350)], now + 2 * minute, aged("n2"))).toBe("ok");
    expect(copies.pooledTotal()).toBe(1000);
    expect(copies.addParts("d", [part(1)], now + 2 * minute, aged("n3"))).toBe("no-room");
    // After the sweep, the next upload on top again costs nothing, and still takes nothing from the others.
    copies.sweep(now + minute + UNUSED_PART_MS + 1);
    expect(copies.pooledTotal()).toBe(902);
    expect(copies.addParts("a1", [part(250)], now + 2 * minute + UNUSED_PART_MS, aged("n1"))).toBe("ok");
    expect(copies.pooledTotal()).toBe(902);
    expect(copies.addParts("d", [part(98)], now + 2 * minute + UNUSED_PART_MS, aged("n3"))).toBe("ok");
  });

  it("counts what is saved of the bytes on top once a version keeps them, and drops them with the account", () => {
    const copies = new CopyStore(":memory:", { totalLimit: 1000, networkShare: 0 });
    save(copies, "a", 300, aged());
    const next = part(300);
    expect(copies.addParts("a", [next], now + minute)).toBe("ok");
    expect([copies.storedTotal(), copies.pooledTotal()]).toEqual([601, 301]);
    // A version that keeps both parts counts all of them.
    expect(copies.swap("a", 1, new Uint8Array(1), [next.id], now + minute)).toMatchObject({ ok: true });
    expect([copies.storedTotal(), copies.pooledTotal()]).toEqual([301, 301]);
    expect(copies.addParts("a", [part(300)], now + 2 * minute)).toBe("ok");
    copies.remove("a");
    expect([copies.storedTotal(), copies.pooledTotal()]).toEqual([0, 0]);
  });

  it("still keeps the disk's free space from the bytes on top", () => {
    let free = 1000;
    const copies = new CopyStore(":memory:", { totalLimit: 1000, networkShare: 0, freeBytes: () => free, freeFloor: 600 });
    save(copies, "a", 300, aged());
    free = 800;
    expect(copies.addParts("a", [part(250)], now + minute)).toBe("no-room");
    expect(copies.addParts("a", [part(200)], now + minute)).toBe("ok");
  });

  it("keeps the bytes on top of young accounts' copies out of their slice", () => {
    // A quarter of 1000 for young accounts: one saves 200 and uploads as much again on top; another still has 49.
    const copies = new CopyStore(":memory:", { totalLimit: 1000, networkShare: 0 });
    const young = { since: now - day };
    save(copies, "y1", 200, young);
    expect(copies.addParts("y1", [part(200)], now + minute, young)).toBe("ok");
    expect(copies.addParts("y2", [part(49)], now + minute, young)).toBe("ok");
    expect(copies.addParts("y2", [part(1)], now + minute, young)).toBe("no-room");
  });

  it("counts the bytes on top again when it starts", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tavora-copies-")), "copies.sqlite");
    const first = new CopyStore(file, { totalLimit: 1000, networkShare: 0 });
    save(first, "a", 400, aged());
    expect(first.addParts("a", [part(400)], now + minute)).toBe("ok");
    const again = new CopyStore(file, { totalLimit: 1000, networkShare: 0 });
    expect([again.storedTotal(), again.pooledTotal()]).toEqual([801, 401]);
    expect(again.addParts("b", [part(599)], now + minute)).toBe("ok");
  });

  it("lets the accounts of one network hold only their share of the total, so aged accounts can't fill it (audit)", () => {
    // As the audit planned it: aged accounts on three networks try to fill all 1000 bytes. Each network may hold 300.
    const copies = new CopyStore(":memory:", { totalLimit: 1000, networkDayLimit: 400, networkShare: 0.3 });
    const saved = new Map<string, ReturnType<typeof part>>();
    for (const network of ["n1", "n2", "n3"]) {
      saved.set(network, save(copies, `${network}-a`, 199, aged(network)));
      expect(copies.addParts(`${network}-b`, [part(199)], now, aged(network))).toBe("no-room");
      expect(copies.addParts(`${network}-b`, [part(100)], now, aged(network))).toBe("ok");
      expect(copies.addParts(`${network}-c`, [part(1)], now, aged(network))).toBe("no-room");
    }
    expect(copies.storedTotal()).toBe(900);
    expect(copies.sweep(now + 2 * day)).toEqual({ parts: 3, bytes: 300 });
    // Saved versions never age out, but there is room for an account on another network: its parts and its copy.
    const later = now + 2 * day;
    const kept = part(10);
    expect(copies.addParts("b", [kept], later, aged("n9"))).toBe("ok");
    expect(copies.swap("b", 0, new Uint8Array(5), [kept.id], later, aged("n9"))).toMatchObject({ ok: true });
    // A saved version that grows past its network's share is refused as well, one within it is not.
    const n1Kept = saved.get("n1")!.id;
    const grown = part(150);
    expect(copies.addParts("n1-a", [grown], later, aged("n1"))).toBe("ok");
    expect(copies.swap("n1-a", 1, new Uint8Array(1), [n1Kept, grown.id], later, aged("n1"))).toEqual({ ok: false, reason: "unavailable" });
    const fits = part(100);
    expect(copies.addParts("n1-a", [fits], later, aged("n1"))).toBe("ok");
    expect(copies.swap("n1-a", 1, new Uint8Array(1), [n1Kept, fits.id], later, aged("n1"))).toMatchObject({ ok: true, size: 300 });
  });

  it("counts an account for the network it first stored from, and one from before networks as a network of its own", () => {
    const copies = new CopyStore(":memory:", { totalLimit: 2000, networkShare: 0.15 });
    save(copies, "a", 150, aged("n1"));
    save(copies, "b", 200, aged("n2"));
    // Asking from another network doesn't move its bytes there: it still grows within n1's share ...
    expect(copies.addParts("a", [part(150), part(100)], now + minute, aged("n2"))).toBe("ok");
    // ... and n2 still has its own room.
    expect(copies.addParts("b2", [part(99)], now + minute, aged("n2"))).toBe("ok");
    expect(copies.addParts("b2", [part(1)], now + minute, aged("n2"))).toBe("no-room");
    // Accounts that stored before networks were kept (no network) don't add up as one network.
    const legacy = { since: now - 30 * day };
    for (const id of ["l1", "l2"]) save(copies, id, 150, legacy);
    expect(copies.addParts("c", [part(1)], now + minute, aged("n3"))).toBe("ok");
    // The next time one stores from a network, it counts for that one.
    expect(copies.addParts("l1", [part(160)], now + minute, aged("n2"))).toBe("no-room");
    expect(copies.addParts("l1", [part(1)], now + minute, aged("n3"))).toBe("ok");
    expect(copies.addParts("c", [part(149)], now + minute, aged("n3"))).toBe("no-room");
    expect(copies.addParts("c", [part(148)], now + minute, aged("n3"))).toBe("ok");
  });

  it("opens a copies file from before networks, which the older service can still write", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "tavora-copies-")), "copies.sqlite");
    const old = new DatabaseSync(file);
    old.exec("create table holders (account_id text primary key, since integer not null)");
    old.prepare("insert into holders (account_id, since) values (?, ?)").run("legacy", now - 30 * day);
    old.close();
    const copies = new CopyStore(file, { totalLimit: 1000, networkShare: 0.3, networkSalt: "s".repeat(32) });
    save(copies, "legacy", 200, aged("198.51.100.0/24"));
    save(copies, "other", 50, aged("198.51.100.0/24"));
    expect(copies.addParts("third", [part(50)], now, aged("198.51.100.0/24"))).toBe("no-room");
    // The file keeps a mark of the network under the secret, never the network.
    const marks = new DatabaseSync(file).prepare("select network from holders order by account_id").all() as { network: string }[];
    expect(marks.map((row) => row.network)).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/), expect.stringMatching(/^[0-9a-f]{16}$/)]);
    expect(marks[0]!.network).toBe(marks[1]!.network);
    // The same secret after a restart finds the same network.
    expect(new CopyStore(file, { totalLimit: 1000, networkShare: 0.3, networkSalt: "s".repeat(32) }).addParts("third", [part(50)], now, aged("198.51.100.0/24"))).toBe("no-room");
    // What the older service writes still goes in.
    const older = new DatabaseSync(file);
    older.prepare("insert into holders (account_id, since) values (?, ?) on conflict (account_id) do nothing").run("newer", now);
    expect(older.prepare("select network from holders where account_id = ?").get("newer")).toEqual({ network: null });
    older.close();
  });
});
