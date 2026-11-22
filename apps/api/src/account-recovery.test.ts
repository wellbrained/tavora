import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, publishSignature, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint, LINK_STATEMENT } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { Scanner } from "./virus-scan.ts";

// Audit 2026-11-22 (run 4): what a stolen sign-in made for publishing must not outlive the owner taking the account back.

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const cleanScanner: Scanner = { scan: async () => ({ clean: true }) };
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const fingerprintOf = (key: KeyObject) => keyFingerprint(rawKey(key));

function moduleZip(key: KeyObject, version: string, id: string): Buffer {
  const manifest = { id, name: id, version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup() {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-recovery-")));
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-11-22T12:00:00Z") };
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    publishRateLimiter: roomy(),
    scanner: cleanScanner,
    catalogueKey: catalogPublicKey(generateKeyPairSync("ed25519").privateKey),
    accounts: { store, mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now },
  });
  const call = (method: string, url: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test${url}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const codeTo = (email: string) => /\n {4}(\d{6})\n/.exec(inbox.mails().find((mail) => mail.to === email)?.text ?? "")?.[1] ?? "";
  /** Links `key` to the account through a link code the sign-in `token` asked for, as `tavora-pack link` does. */
  const link = async (token: string, key: KeyObject) => {
    const { code } = (await (await call("POST", "/v1/account/keys/code", {}, token)).json()) as { code: string };
    const signature = sign(null, Buffer.from(`${LINK_STATEMENT}\n${code}`, "utf8"), key).toString("base64");
    return call("POST", "/v1/publishers/link", { code, publicKey: rawKey(key).toString("base64"), signature });
  };
  /** Each key publishes its own module under the account's prefix: a module's versions all come from one key. */
  const publish = (key: KeyObject, version: string, auth: string, id = "wellbrained.timer") => {
    const zip = moduleZip(key, version, id);
    return app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "content-length": String(zip.length), "x-tavora-signature": publishSignature(key, zip), authorization: `Bearer ${auth}` },
      body: new Uint8Array(zip),
    });
  };
  const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;
  return { store, catalog, clock, call, codeTo, link, publish, reason };
}

describe("taking an account back by changing its email", () => {
  it("ends what other sign-ins made for publishing: their tokens go and their keys pause until linked again", async () => {
    const { store, catalog, clock, call, codeTo, link, publish, reason } = setup();
    const account = store.createAccount({ email: "owner@example.com" }, clock.now - 86_400_000);
    catalog.trustAccount(account.id, new Date(clock.now));
    const owner = store.createSession(account.id, "windows", clock.now, "Desk").token;
    const stolen = store.createSession(account.id, "windows", clock.now, "Desk").token;
    expect((await call("PUT", "/v1/account/developer", { name: "wellbrained" }, owner)).status).toBe(200);

    // The owner's key and CI token, made from the sign-in that will change the address.
    const ownerKey = generateKeyPairSync("ed25519").privateKey;
    expect((await link(owner, ownerKey)).status).toBe(200);
    const ownerToken = ((await (await call("POST", "/v1/account/publish-tokens", { name: "My CI" }, owner)).json()) as { token: string }).token;
    expect((await publish(ownerKey, "1.0.0", owner)).status).toBe(201);
    // A token from before tokens were kept with their sign-in: nobody can tell who made it.
    const unknownToken = store.createPublishToken(account.id, "Old CI", clock.now)!.token;

    // The thief's own key and token, made with the stolen sign-in alone, and a request to move the owner's key onto theirs.
    const thiefKey = generateKeyPairSync("ed25519").privateKey;
    expect((await link(stolen, thiefKey)).status).toBe(200);
    const thiefToken = ((await (await call("POST", "/v1/account/publish-tokens", { name: "Thief" }, stolen)).json()) as { token: string }).token;
    expect((await call("POST", `/v1/account/keys/${fingerprintOf(ownerKey)}/replace`, { new: fingerprintOf(thiefKey), leaked: false }, stolen)).status).toBe(200);
    expect((await publish(thiefKey, "1.0.0", thiefToken, "wellbrained.other")).status).toBe(201);
    expect(store.keyRequest(fingerprintOf(ownerKey))).not.toBeNull();

    // The owner proves the mailbox and moves the account to a new address.
    clock.now += 15 * 60_000;
    expect((await call("POST", "/v1/account/email/code", { email: "fresh@example.com", confirmCurrent: true }, owner)).status).toBe(202);
    const changed = await call("POST", "/v1/account/email", { email: "fresh@example.com", code: codeTo("fresh@example.com"), currentCode: codeTo("owner@example.com") }, owner);
    expect(changed.status).toBe(200);

    // The stolen sign-in is gone, and so is everything it made: its token publishes nothing, its key signs nothing, and the
    // request onto its key is gone. A token nobody can vouch for goes too.
    expect((await call("GET", "/v1/account", undefined, stolen)).status).toBe(401);
    expect(store.publishTokenAccount(thiefToken, clock.now)).toBeNull();
    expect(store.publishTokenAccount(unknownToken, clock.now)).toBeNull();
    expect(await reason(await publish(thiefKey, "1.0.1", thiefToken, "wellbrained.other"))).toBe("sign-in-needed");
    expect(await reason(await publish(thiefKey, "1.0.1", owner, "wellbrained.other"))).toBe("key-not-linked");
    expect(store.keyRequest(fingerprintOf(ownerKey))).toBeNull();
    // The key stays the account's: nobody else can link it, and its modules stay where they are.
    expect(store.publisherKey(fingerprintOf(thiefKey))).toMatchObject({ accountId: account.id, paused: true });

    // What the owner made from this sign-in still works, and the app sees the paused key apart.
    expect(store.publishTokenAccount(ownerToken, clock.now)).toMatchObject({ accountId: account.id });
    expect((await publish(ownerKey, "1.0.2", ownerToken)).status).toBe(201);
    const developer = (await (await call("GET", "/v1/account/developer", undefined, owner)).json()) as { keys: { fingerprint: string }[]; pausedKeys: { fingerprint: string }[]; publishTokens: { name: string }[] };
    expect(developer.keys.map((key) => key.fingerprint)).toEqual([fingerprintOf(ownerKey)]);
    expect(developer.pausedKeys.map((key) => key.fingerprint)).toEqual([fingerprintOf(thiefKey)]);
    expect(developer.publishTokens.map((token) => token.name)).toEqual(["My CI"]);
    // Nothing moves onto a paused key.
    expect(await reason(await call("POST", `/v1/account/keys/${fingerprintOf(ownerKey)}/replace`, { new: fingerprintOf(thiefKey), leaked: false }, owner))).toBe("not-found");
  });

  it("wakes a paused key when the owner links it again, which takes its private half", async () => {
    const { store, catalog, clock, call, codeTo, link, publish } = setup();
    const account = store.createAccount({ email: "owner@example.com" }, clock.now - 86_400_000);
    catalog.trustAccount(account.id, new Date(clock.now));
    const laptop = store.createSession(account.id, "windows", clock.now, "Laptop").token;
    const desk = store.createSession(account.id, "windows", clock.now, "Desk").token;
    await call("PUT", "/v1/account/developer", { name: "wellbrained" }, desk);
    // The owner's own key, linked from the laptop, which the change signs out.
    const key = generateKeyPairSync("ed25519").privateKey;
    await link(laptop, key);
    clock.now += 15 * 60_000;
    await call("POST", "/v1/account/email/code", { email: "fresh@example.com", confirmCurrent: true }, desk);
    await call("POST", "/v1/account/email", { email: "fresh@example.com", code: codeTo("fresh@example.com"), currentCode: codeTo("owner@example.com") }, desk);
    expect((await publish(key, "1.0.0", desk)).status).toBe(403);
    expect((await link(desk, key)).status).toBe(200);
    expect(store.publisherKey(fingerprintOf(key))).toMatchObject({ paused: false });
    expect((await publish(key, "1.0.0", desk)).status).toBe(201);
  });
});
