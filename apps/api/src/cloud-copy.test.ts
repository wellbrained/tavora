import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { COPY_LIMIT, CopyStore, MAX_PART_BYTES, readParts, readSwap, STORED_LIMIT, writeParts } from "./cloud-copy.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { createRateLimiter } from "./rate-limit.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });

function setup() {
  const store = new AccountStore(":memory:");
  const copies = new CopyStore(":memory:");
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
    expect(copies.addParts("acc", parts)).toBe(true);
    const result = copies.swap("acc", 0, new Uint8Array([1]), parts.map((p) => p.id), 1);
    expect(result).toMatchObject({ ok: false, reason: "copy-full" });
    const fits = parts.slice(0, 24);
    expect(copies.swap("acc", 0, new Uint8Array([1]), fits.map((p) => p.id), 1)).toMatchObject({ ok: true, version: 1 });
    expect(copies.stored("acc")).toBe(24 * 4 * 1024 * 1024);
    // Uploading the next version while the old one is still there: up to STORED_LIMIT, then refused.
    const room = Math.floor((STORED_LIMIT - copies.stored("acc")) / (4 * 1024 * 1024));
    expect(copies.addParts("acc", Array.from({ length: room }, () => big(4 * 1024 * 1024)))).toBe(true);
    expect(copies.addParts("acc", [big(4 * 1024 * 1024)])).toBe(false);
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
