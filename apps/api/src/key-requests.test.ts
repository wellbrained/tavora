import { createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, nextCatalogList, signCatalogList, signFiles, writeZip, type Revocation, type Succession, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createAdminApp } from "./admin-app.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createHostedStore } from "./hosted-store.ts";
import { IconState } from "./icon-state.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createSubmissions } from "./submissions.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const TOKEN = "t0ken-".repeat(5);
/** A catalogue key for the tests, standing in for Tavora's offline one. */
const catalogue = generateKeyPairSync("ed25519").privateKey;
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const fingerprintOf = (key: KeyObject) => keyFingerprint(rawKey(key));

function moduleZip(key: KeyObject, version: string): Buffer {
  const manifest = { id: "wellbrained.timer", name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }];
  return writeZip([...files, signFiles(files, key)]);
}

function setup() {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
  const inbox = createTestInbox();
  const clock = { now: Date.parse("2026-10-20T12:00:00Z") };
  const catalogueKey = catalogPublicKey(catalogue);
  const app = createApp({ db, catalog, catalogueKey, rateLimiter: roomy(), accounts: { store, mailer: inbox, codeRateLimiter: roomy(), verifyRateLimiter: roomy(), now: () => clock.now } });
  const state = new IconState(":memory:");
  const icons = createHostedStore({ list: () => [], file: () => null }, state);
  const admin = createAdminApp({ token: TOKEN, submissions: createSubmissions({ state, store: icons, gameName: () => null, gamesNamed: () => [] }), state, store: icons, catalog, accounts: store, catalogueKey });
  const request = (method: string, url: string, body?: unknown, token?: string) =>
    app.request(`http://tavora.test${url}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const adminCall = (url: string, body?: unknown) =>
    admin.request(`http://admin.test${url}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Admin-Token": TOKEN, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  /** A signed-in developer with two linked keys: the one they lose, and its replacement. */
  const developer = async (email: string) => {
    await request("POST", "/v1/account/code", { email });
    const code = /\n {4}(\d{6})\n/.exec(inbox.mails()[0]?.text ?? "")?.[1] ?? "";
    inbox.clear();
    const { token } = (await (await request("POST", "/v1/account/verify", { email, code, os: "windows", create: true })).json()) as { token: string };
    const accountId = store.accountByEmail(email)!.id;
    const lost = generateKeyPairSync("ed25519").privateKey;
    const next = generateKeyPairSync("ed25519").privateKey;
    store.linkKey(accountId, fingerprintOf(lost), rawKey(lost).toString("base64"), clock.now - 86_400_000 * 30);
    store.linkKey(accountId, fingerprintOf(next), rawKey(next).toString("base64"), clock.now);
    return { token, accountId, lost, next, old: fingerprintOf(lost), new: fingerprintOf(next) };
  };
  const sign = (kind: "successions" | "revocations", entries: Succession[] | Revocation[]) =>
    catalog.setList(kind, Buffer.from(signCatalogList(nextCatalogList(kind, entries, null, new Date(clock.now)), catalogue)));
  return { store, catalog, inbox, clock, request, adminCall, developer, sign };
}

type Answer = { keys: { fingerprint: string }[]; requests: { old: string; new: string; leaked: boolean; status: string }[] };

describe("asking to replace a lost key", () => {
  it("queues the request, tells the account's address, and shows it waiting", async () => {
    const { request, inbox, developer } = setup();
    const dev = await developer("dev@example.com");
    const answer = await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: false, language: "en" }, dev.token);
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as Answer).requests).toEqual([{ old: dev.old, new: dev.new, leaked: false, requestedAt: "2026-10-20T12:00:00.000Z", status: "waiting" }]);
    expect(inbox.mails()).toHaveLength(1);
    expect(inbox.mails()[0]).toMatchObject({ to: "dev@example.com", subject: "You asked to replace a publisher key" });
    // Asking again is fine and sends nothing new; marking it leaked does.
    await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: false }, dev.token);
    expect(inbox.mails()).toHaveLength(1);
    const leaked = (await (await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: true, language: "de" }, dev.token)).json()) as Answer;
    expect(leaked.requests[0]).toMatchObject({ leaked: true, status: "waiting" });
    expect(inbox.mails()[0]!.subject).toBe("Du hast einen Herausgeberschlüssel als geleakt gemeldet");
    // The developer side lists the requests too.
    expect(((await (await request("GET", "/v1/account/developer", undefined, dev.token)).json()) as Answer).requests).toHaveLength(1);
  });

  it("needs both keys linked to this account, and one open request per key", async () => {
    const { request, store, developer } = setup();
    const dev = await developer("dev@example.com");
    const other = await developer("other@example.com");
    const replace = (old: string, body: unknown, token = dev.token) => request("POST", `/v1/account/keys/${old}/replace`, body, token);
    expect((await replace(dev.old, { new: dev.old, leaked: false })).status).toBe(400);
    expect((await replace(dev.old, { new: other.new, leaked: false })).status).toBe(404);
    expect((await replace(other.old, { new: dev.new, leaked: false })).status).toBe(404);
    expect((await replace(dev.old, { new: dev.new })).status).toBe(400);
    expect((await replace("nope", { new: dev.new, leaked: false })).status).toBe(400);
    expect((await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: false })).status).toBe(401);
    expect((await replace(dev.old, { new: dev.new, leaked: false })).status).toBe(200);
    // Another replacement for the same key waits until this one is turned down.
    const third = generateKeyPairSync("ed25519").privateKey;
    store.linkKey(dev.accountId, fingerprintOf(third), rawKey(third).toString("base64"), Date.now());
    const busy = await replace(dev.old, { new: fingerprintOf(third), leaked: false });
    expect(busy.status).toBe(409);
    expect(((await busy.json()) as { reason: string }).reason).toBe("key-in-request");
    store.declineKeyRequest(dev.old, Date.now());
    expect((await replace(dev.old, { new: fingerprintOf(third), leaked: false })).status).toBe(200);
  });

  it("keeps both keys linked while the request waits", async () => {
    const { request, developer } = setup();
    const dev = await developer("dev@example.com");
    await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: false }, dev.token);
    for (const key of [dev.old, dev.new]) {
      const answer = await request("DELETE", `/v1/account/keys/${key}`, undefined, dev.token);
      expect(answer.status).toBe(409);
      expect(((await answer.json()) as { reason: string }).reason).toBe("key-in-request");
    }
  });

  it("is done once the served lists, signed with the catalogue key, hold it", async () => {
    const { request, developer, sign, catalog, clock } = setup();
    const dev = await developer("dev@example.com");
    const status = async () => ((await (await request("GET", "/v1/account/developer", undefined, dev.token)).json()) as Answer).requests[0]!.status;
    await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: true }, dev.token);
    sign("successions", [{ old: dev.old, new: dev.new, account: dev.accountId }]);
    // Leaked: the revocation is still missing.
    expect(await status()).toBe("waiting");
    sign("revocations", [{ fingerprint: dev.old, revoked: "2026-10-20T12:00:00Z", allow: [] }]);
    expect(await status()).toBe("done");
    // A list signed with any other key counts for nothing.
    catalog.setList("successions", Buffer.from(signCatalogList(nextCatalogList("successions", [{ old: dev.old, new: dev.new, account: dev.accountId }], null, new Date(clock.now)), generateKeyPairSync("ed25519").privateKey)));
    expect(await status()).toBe("waiting");
    // Once done, the old key can be unlinked.
    sign("successions", [{ old: dev.old, new: dev.new, account: dev.accountId }]);
    expect((await request("DELETE", `/v1/account/keys/${dev.old}`, undefined, dev.token)).status).toBe(200);
  });

  it("goes when the account is deleted", async () => {
    const { request, store, developer } = setup();
    const dev = await developer("dev@example.com");
    await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: false }, dev.token);
    store.deleteAccount(dev.accountId);
    expect(store.allKeyRequests()).toEqual([]);
  });
});

describe("the review page's key requests", () => {
  it("lists them, and exports every entry in force plus the waiting ones, ready to sign", async () => {
    const { request, adminCall, developer, sign, catalog, clock } = setup();
    const dev = await developer("dev@example.com");
    const earlier = await developer("earlier@example.com");
    // A module the leaked key published before the report: players keep it.
    catalog.add(moduleZip(dev.lost, "1.0.0"), new Date(clock.now - 3_600_000));
    sign("successions", [{ old: earlier.old, new: earlier.new, account: earlier.accountId }]);
    await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: true }, dev.token);

    const listed = (await (await adminCall("/api/keys")).json()) as { requests: Record<string, unknown>[] };
    expect(listed.requests).toEqual([
      { old: dev.old, new: dev.new, account: dev.accountId, email: "dev@example.com", developer: null, leaked: true, requestedAt: "2026-10-20T12:00:00.000Z", newLinkedAt: "2026-10-20T12:00:00.000Z", status: "waiting" },
    ]);
    const successions = (await (await adminCall("/api/keys/successions.json")).json()) as Succession[];
    expect(successions).toEqual([
      { old: earlier.old, new: earlier.new, account: earlier.accountId },
      { old: dev.old, new: dev.new, account: dev.accountId },
    ]);
    const revocations = (await (await adminCall("/api/keys/revocations.json")).json()) as Revocation[];
    expect(revocations).toEqual([{ fingerprint: dev.old, revoked: "2026-10-20T12:00:00Z", allow: [catalog.index()[0]!.zip.sha256] }]);
    // What the page exports is what the sign script takes.
    expect(() => nextCatalogList("successions", successions, null, new Date())).not.toThrow();
    expect(() => nextCatalogList("revocations", revocations, null, new Date())).not.toThrow();
    expect((await adminCall("/api/keys/successions.json")).headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("turns a request down, which the app then shows", async () => {
    const { request, adminCall, developer } = setup();
    const dev = await developer("dev@example.com");
    await request("POST", `/v1/account/keys/${dev.old}/replace`, { new: dev.new, leaked: false }, dev.token);
    expect((await adminCall("/api/keys/decline", { old: dev.old })).status).toBe(200);
    expect((await adminCall("/api/keys/decline", { old: dev.old })).status).toBe(404);
    expect(((await (await request("GET", "/v1/account/developer", undefined, dev.token)).json()) as Answer).requests[0]!.status).toBe("declined");
    expect(await (await adminCall("/api/keys/successions.json")).json()).toEqual([]);
  });

  it("needs the admin token", async () => {
    const { catalog } = setup();
    const state = new IconState(":memory:");
    const icons = createHostedStore({ list: () => [], file: () => null }, state);
    const admin = createAdminApp({ token: TOKEN, submissions: createSubmissions({ state, store: icons, gameName: () => null, gamesNamed: () => [] }), state, store: icons, catalog });
    expect((await admin.request("http://admin.test/api/keys")).status).toBe(401);
    expect((await admin.request("http://admin.test/api/keys/successions.json")).status).toBe(401);
  });
});
