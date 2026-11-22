import { createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, publishSignature, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { accountsAdminRoutes } from "./accounts-admin.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { moderationRoutes } from "./moderation-admin.ts";
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

/** `scanner`: undefined makes every version wait for review. */
function setup(scanner: Scanner | undefined = cleanScanner) {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-recovery-")));
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-11-22T12:00:00Z") };
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    publishRateLimiter: roomy(),
    ...(scanner ? { scanner } : {}),
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
  const newToken = async (token: string, name: string) => ((await (await call("POST", "/v1/account/publish-tokens", { name }, token)).json()) as { token: string }).token;
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
  /**
   * An account with a developer name and its prefix, and two sign-ins: the owner's and a stolen one. `trusted`: it had a
   * version approved before, so its new modules list without review.
   */
  const account = async (trusted = true) => {
    const created = store.createAccount({ email: "owner@example.com" }, clock.now - 86_400_000);
    if (trusted) catalog.trustAccount(created.id, new Date(clock.now));
    store.reservePrefix(created.id, "wellbrained", clock.now);
    const owner = store.createSession(created.id, "windows", clock.now, "Desk").token;
    const stolen = store.createSession(created.id, "windows", clock.now, "Desk").token;
    expect((await call("PUT", "/v1/account/developer", { name: "wellbrained" }, owner)).status).toBe(200);
    return { id: created.id, owner, stolen };
  };
  /** The owner moves the account to a new address, proving the current one; the new sign-in token. */
  const changeEmail = async (token: string) => {
    clock.now += 15 * 60_000;
    expect((await call("POST", "/v1/account/email/code", { email: "fresh@example.com", confirmCurrent: true }, token)).status).toBe(202);
    const changed = await call("POST", "/v1/account/email", { email: "fresh@example.com", code: codeTo("fresh@example.com"), currentCode: codeTo("owner@example.com") }, token);
    expect(changed.status).toBe(200);
    return ((await changed.json()) as { token: string }).token;
  };
  return { store, catalog, clock, call, link, newToken, publish, reason, account, changeEmail, inbox };
}

describe("taking an account back by changing its email", () => {
  it("ends every sign-in, this one too, and everything made for publishing: every token goes and every key pauses", async () => {
    const { store, clock, call, link, newToken, publish, reason, account, changeEmail } = setup();
    const { id, owner, stolen } = await account();
    // The owner's own key and CI token, a token from before tokens were kept with their sign-in, and what a thief made with
    // the stolen sign-in alone: a key, a token and a request to move the owner's key onto theirs.
    const ownerKey = generateKeyPairSync("ed25519").privateKey;
    expect((await link(owner, ownerKey)).status).toBe(200);
    const ownerToken = await newToken(owner, "My CI");
    const unknownToken = store.createPublishToken(id, "Old CI", clock.now)!.token;
    const thiefKey = generateKeyPairSync("ed25519").privateKey;
    expect((await link(stolen, thiefKey)).status).toBe(200);
    const thiefToken = await newToken(stolen, "Thief");
    expect((await call("POST", `/v1/account/keys/${fingerprintOf(ownerKey)}/replace`, { new: fingerprintOf(thiefKey), leaked: false }, stolen)).status).toBe(200);
    expect((await publish(thiefKey, "1.0.0", thiefToken, "wellbrained.other")).status).toBe(201);

    const renewed = await changeEmail(owner);

    // Every sign-in ends: the stolen one, and the owner's old token too (a copy of it would be no use); the owner goes on
    // with the new one from the answer.
    expect((await call("GET", "/v1/account", undefined, stolen)).status).toBe(401);
    expect((await call("GET", "/v1/account", undefined, owner)).status).toBe(401);
    expect((await call("GET", "/v1/account", undefined, renewed)).status).toBe(200);
    // Every token goes, whoever made it.
    for (const token of [thiefToken, ownerToken, unknownToken]) expect(store.publishTokenAccount(token, clock.now)).toBeNull();
    expect(await reason(await publish(thiefKey, "1.0.1", thiefToken, "wellbrained.other"))).toBe("sign-in-needed");
    // Every key pauses: it stays the account's (nobody else can link it, its modules stay), but signs nothing.
    expect(await reason(await publish(thiefKey, "1.0.1", renewed, "wellbrained.other"))).toBe("key-not-linked");
    expect(await reason(await publish(ownerKey, "1.0.0", renewed))).toBe("key-not-linked");
    expect(store.publisherKey(fingerprintOf(thiefKey))).toMatchObject({ accountId: id, paused: true });
    expect(store.keyRequest(fingerprintOf(ownerKey))).toBeNull();
    const developer = (await (await call("GET", "/v1/account/developer", undefined, renewed)).json()) as { keys: unknown[]; pausedKeys: { fingerprint: string }[]; publishTokens: unknown[] };
    expect(developer.keys).toEqual([]);
    expect(developer.pausedKeys.map((key) => key.fingerprint).sort()).toEqual([fingerprintOf(ownerKey), fingerprintOf(thiefKey)].sort());
    expect(developer.publishTokens).toEqual([]);
    // Nothing moves onto a paused key.
    expect(await reason(await call("POST", `/v1/account/keys/${fingerprintOf(ownerKey)}/replace`, { new: fingerprintOf(thiefKey), leaked: false }, renewed))).toBe("not-found");

    // The owner links their own key again, which takes its private half, and publishes.
    expect((await link(renewed, ownerKey)).status).toBe(200);
    expect(store.publisherKey(fingerprintOf(ownerKey))).toMatchObject({ paused: false });
    expect((await publish(ownerKey, "1.0.0", renewed)).status).toBe(201);
    // A CI token tells CI why it stopped.
    const refused = (await (await publish(ownerKey, "1.0.1", ownerToken)).json()) as { reason: string; error: string };
    expect(refused).toMatchObject({ reason: "sign-in-needed", error: expect.stringMatching(/token doesn't work any more/) });
  });

  it("never lists a version a paused key uploaded: not by Approve, and not once its scan ends (B1)", async () => {
    const { store, catalog, clock, link, publish, account, changeEmail } = setup(undefined);
    // A first module waits for review.
    const { id, owner, stolen } = await account(false);
    const thiefKey = generateKeyPairSync("ed25519").privateKey;
    await link(stolen, thiefKey);
    // Without a scanner every version waits for review.
    expect((await publish(thiefKey, "1.0.0", stolen, "wellbrained.other")).status).toBe(202);
    const waiting = catalog.waitingVersions()[0]!;
    await changeEmail(owner);
    const admin = moderationRoutes({ catalog, accounts: store, now: () => clock.now });
    const page = (await (await admin.request("http://admin.test/waiting")).json()) as { waiting: { signer: { refused: string | null } }[] };
    expect(page.waiting[0]!.signer.refused).toBe("key-paused");
    const approved = await admin.request("http://admin.test/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sha256: waiting.sha256 }) });
    expect(approved.status).toBe(409);
    expect(await approved.json()).toMatchObject({ reason: "key-paused" });
    expect(catalog.index().map((entry) => entry.id)).toEqual([]);
    // The account page says the key is paused.
    const details = (await (await accountsAdminRoutes({ accounts: store, catalog, now: () => clock.now }).request(`http://admin.test/${id}`)).json()) as { keys: { fingerprint: string; paused: boolean }[] };
    expect(details.keys).toEqual([expect.objectContaining({ fingerprint: fingerprintOf(thiefKey), paused: true })]);
  });

  it("refuses an upload whose key paused while its scan ran", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const running = new Promise<void>((resolve) => (started = resolve));
    const held: Scanner = {
      scan: async () => {
        started();
        await gate;
        return { clean: true };
      },
    };
    const { link, publish, reason, account, changeEmail, catalog } = setup(held);
    const { owner, stolen } = await account();
    const thiefKey = generateKeyPairSync("ed25519").privateKey;
    await link(stolen, thiefKey);
    const upload = publish(thiefKey, "1.0.0", stolen, "wellbrained.other");
    await running;
    await changeEmail(owner);
    release();
    expect(await reason(await upload)).toBe("key-not-linked");
    expect(catalog.index()).toEqual([]);
  });
});

describe("removing a device from another one", () => {
  it("takes what that device made for publishing with it, but signing yourself out keeps yours", async () => {
    const { store, clock, call, link, newToken, publish, reason, account } = setup();
    const { id, owner, stolen } = await account();
    const ownerKey = generateKeyPairSync("ed25519").privateKey;
    await link(owner, ownerKey);
    const ownerToken = await newToken(owner, "My CI");
    const thiefKey = generateKeyPairSync("ed25519").privateKey;
    await link(stolen, thiefKey);
    const thiefToken = await newToken(stolen, "Thief");
    // The owner sees a device they don't know and removes it.
    const { devices } = (await (await call("GET", "/v1/account", undefined, owner)).json()) as { devices: { id: string; current: boolean }[] };
    const other = devices.find((device) => !device.current)!;
    expect((await call("DELETE", `/v1/account/devices/${other.id}`, undefined, owner)).status).toBe(204);
    expect(store.publishTokenAccount(thiefToken, clock.now)).toBeNull();
    expect(await reason(await publish(thiefKey, "1.0.0", owner, "wellbrained.other"))).toBe("key-not-linked");
    // What the owner's device made stays.
    expect(store.publishTokenAccount(ownerToken, clock.now)).toMatchObject({ accountId: id });
    expect((await publish(ownerKey, "1.0.0", ownerToken)).status).toBe(201);
    // Signing out of your own device keeps what it made.
    const laptop = store.createSession(id, "linux", clock.now, "Laptop").token;
    const laptopToken = await newToken(laptop, "Laptop CI");
    expect((await call("POST", "/v1/account/sign-out", {}, laptop)).status).toBe(204);
    expect(store.publishTokenAccount(laptopToken, clock.now)).toMatchObject({ accountId: id });
  });
});
