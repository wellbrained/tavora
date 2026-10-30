import { createHash, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, nextCatalogList, publishSignature, signCatalogList, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { TAVORA_ACCOUNT_ID, TAVORA_PUBLISHER_KEY } from "@tavora/module-schema";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import { CatalogStore } from "./catalog.ts";
import { OFFICIAL_PINS } from "./catalog-trust.ts";
import { addByHand } from "./catalog-add.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { ConversationStore } from "./conversations.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint, LINK_STATEMENT } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { ReviewStore } from "./reviews.ts";
import type { Scanner } from "./virus-scan.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const cleanScanner: Scanner = { scan: async () => ({ clean: true }) };
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
const fingerprint = (key: KeyObject) => keyFingerprint(rawKey(key));
const catalogue = generateKeyPairSync("ed25519").privateKey;
const newKey = () => generateKeyPairSync("ed25519").privateKey;

function moduleZip(key: KeyObject, id: string, version = "1.0.0", options: { minTavora?: string | null; extra?: ZipFile[]; changelog?: boolean; network?: string[] } = {}): Buffer {
  const { minTavora = "0.23.0", extra = [] } = options;
  const manifest = {
    id,
    name: "Notes",
    version,
    apiVersion: "1",
    entry: "index.html",
    games: [],
    viewport: { minWidth: 200, minHeight: 150 },
    permissions: { network: options.network ?? [] },
    ...(minTavora ? { minTavora } : {}),
    ...(options.changelog ? { changelog: "changelog.json" } : {}),
  };
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "index.html", data: Buffer.from("<p>notes</p>") },
    ...(options.changelog ? [{ name: "changelog.json", data: Buffer.from(JSON.stringify([{ version, notes: ["Fixed a thing."] }])) }] : []),
    ...extra,
  ];
  return writeZip([...files, signFiles(files, key)]);
}

function setup(pinned: "on" | "off" = "on") {
  const store = new AccountStore(":memory:");
  const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-official-")));
  const reviews = new ReviewStore(":memory:");
  const conversations = new ConversationStore(":memory:");
  const clock = { now: Date.parse("2026-10-30T12:00:00Z") };
  const day = 86_400_000;
  const account = (email: string, key: KeyObject | null, trusted = true) => {
    const created = store.createAccount({ email }, clock.now - 5 * day);
    store.setProfile(created.id, { name: "Someone", initials: "S", picture: null, updatedAt: clock.now });
    if (trusted) catalog.trustAccount(created.id, new Date(clock.now));
    if (key) store.linkKey(created.id, fingerprint(key), rawKey(key).toString("base64"), clock.now);
    return { id: created.id, key, token: store.createSession(created.id, "windows", clock.now).token };
  };
  const pinnedKey = newKey();
  const tavora = account("tavora@example.com", pinnedKey, false);
  const pins = pinned === "on" ? { key: fingerprint(pinnedKey), account: tavora.id } : { key: "", account: "" };
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    publishRateLimiter: roomy(),
    reviewRateLimiter: roomy(),
    conversationRateLimiter: roomy(),
    scanner: cleanScanner,
    catalogueKey: catalogPublicKey(catalogue),
    officialPins: pins,
    accounts: { store, mailer: createTestInbox(), reviews, conversations, catalog, now: () => clock.now, verifyRateLimiter: roomy() },
  });
  const call = (method: string, pathname: string, token?: string | null, body?: unknown) =>
    app.request(`http://tavora.test${pathname}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const send = (key: KeyObject, zip: Buffer, token: string) =>
    app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "x-tavora-signature": publishSignature(key, zip), authorization: `Bearer ${token}` },
      body: new Uint8Array(zip),
    });
  const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;
  const setList = (kind: "revocations" | "successions", entries: unknown[]) =>
    catalog.setList(kind, Buffer.from(signCatalogList(nextCatalogList(kind, entries, null, new Date(clock.now)), catalogue)));
  return { store, catalog, clock, account, tavora, pinnedKey, pins, app, call, send, reason, setList };
}

describe("Tavora's own modules in the catalogue", () => {
  it("ships with empty pins, which refuses every tavora.* upload as before", async () => {
    expect(TAVORA_PUBLISHER_KEY).toBe("");
    expect(TAVORA_ACCOUNT_ID).toBe("");
    expect(OFFICIAL_PINS).toEqual({ key: "", account: "" });
    const { tavora, pinnedKey, send, reason, catalog } = setup("off");
    const answer = await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes"), tavora.token);
    expect(answer.status).toBe(400);
    expect(await reason(answer)).toBe("invalid");
    expect(((await (await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes"), tavora.token)).json()) as { error: string }).error).toContain("reserved for Tavora's own modules");
    expect(catalog.index({}, { official: true })).toEqual([]);
  });

  it("refuses the by-hand add script even with the pins set", () => {
    const { store, catalog, pinnedKey } = setup();
    expect(() => addByHand(catalog, store, moduleZip(pinnedKey, "tavora.notes"))).toThrow(/reserved for Tavora's own modules/);
  });

  it("lists an update from the pinned key and account at once, keeping check reasons apart from the notes", async () => {
    const { tavora, pinnedKey, send, catalog, store } = setup();
    // A first version that asks for network access fails a check, and the account has nothing approved yet; it lists all the same.
    const answer = await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes", "1.0.0", { network: ["example.com"], changelog: true }), tavora.token);
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ status: "published", id: "tavora.notes" });
    const [entry] = catalog.index({}, { official: true });
    expect(entry).toMatchObject({ id: "tavora.notes", version: "1.0.0", notes: ["Fixed a thing."] });
    expect(catalog.waitingVersions()).toEqual([]);
    const row = catalog.adminModules().find((module) => module.id === "tavora.notes")!;
    expect(row.versions[0]).toMatchObject({ status: "listed", notes: ["Fixed a thing."] });
    expect(catalog.versionReview(entry!.zip.sha256)?.official).toBe(true);
    expect(catalog.versionReview(entry!.zip.sha256)?.reasons.map((reason) => reason.check)).toEqual(["permissions"]);
    // The prefix "tavora" is never reserved.
    expect(store.prefixes(tavora.id)).toEqual([]);
    expect(store.prefixCheck(tavora.id, "tavora", undefined)).toBe("reserved");
  });

  it("refuses a wrong key, the pinned key from another account, and a publish token", async () => {
    const { tavora, pinnedKey, account, send, reason, store, clock } = setup();
    const other = account("other@example.com", newKey());
    expect(await reason(await send(other.key!, moduleZip(other.key!, "tavora.notes"), other.token))).toBe("invalid");
    expect(await reason(await send(other.key!, moduleZip(other.key!, "tavora.notes"), tavora.token))).toBe("wrong-account");
    expect(await reason(await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes"), other.token))).toBe("wrong-account");
    // A pinned-key zip sent with a token of the pinned account.
    const { token } = store.createPublishToken(tavora.id, "CI", clock.now)!;
    store.setDeveloperName(tavora.id, "Tavora Team", clock.now - 40 * 86_400_000);
    expect(await reason(await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes"), token))).toBe("invalid");
    expect((await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes"), tavora.token)).status).toBe(201);
  });

  it("refuses a revoked pinned key, and a manifest without minTavora", async () => {
    const { tavora, pinnedKey, send, reason, setList } = setup();
    const missing = await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes", "1.0.0", { minTavora: null }), tavora.token);
    expect(missing.status).toBe(400);
    expect(await reason(missing)).toBe("invalid");
    setList("revocations", [{ fingerprint: fingerprint(pinnedKey), revoked: "2026-10-30T11:00:00Z", allow: [] }]);
    expect(await reason(await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes"), tavora.token))).toBe("key-revoked");
  });

  it("follows a succession inside the pinned account, and refuses a step through another account", async () => {
    const { tavora, pinnedKey, send, reason, store, clock, setList } = setup();
    const next = newKey();
    store.linkKey(tavora.id, fingerprint(next), rawKey(next).toString("base64"), clock.now);
    const zip = moduleZip(next, "tavora.notes");
    expect(await reason(await send(next, zip, tavora.token))).toBe("invalid");
    setList("successions", [{ old: fingerprint(pinnedKey), new: fingerprint(next), account: "someone-else" }]);
    expect(await reason(await send(next, zip, tavora.token))).toBe("invalid");
    setList("successions", [{ old: fingerprint(pinnedKey), new: fingerprint(next), account: tavora.id }]);
    expect((await send(next, zip, tavora.token)).status).toBe(201);
    // A second step that crosses into another account breaks the chain.
    const third = newKey();
    store.linkKey(tavora.id, fingerprint(third), rawKey(third).toString("base64"), clock.now);
    setList("successions", [
      { old: fingerprint(pinnedKey), new: fingerprint(next), account: tavora.id },
      { old: fingerprint(next), new: fingerprint(third), account: "someone-else" },
    ]);
    expect(await reason(await send(third, moduleZip(third, "tavora.notes", "1.1.0"), tavora.token))).toBe("invalid");
  });

  it("hides them from the public index but serves them with ?include=official, and the module page has no contact", async () => {
    const { tavora, pinnedKey, send, call, catalog, account } = setup();
    const other = account("other@example.com", newKey());
    expect((await send(other.key!, moduleZip(other.key!, "wellbrained.timer"), other.token)).status).toBe(201);
    expect((await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes", "1.0.0", { changelog: true }), tavora.token)).status).toBe(201);
    const ids = async (query = "") => ((await (await call("GET", `/v1/catalog${query}`)).json()) as { modules: { id: string }[] }).modules.map((module) => module.id);
    expect(await ids()).toEqual(["wellbrained.timer"]);
    expect(await ids("?game=elden-ring")).toEqual(["wellbrained.timer"]);
    expect(await ids("?include=official")).toEqual(["tavora.notes", "wellbrained.timer"]);
    expect(catalog.index().map((entry) => entry.id)).toEqual(["wellbrained.timer"]);
    const page = await call("GET", "/v1/catalog/modules/tavora.notes");
    expect(page.status).toBe(200);
    const body = (await page.json()) as { module: Record<string, unknown>; versions: { version: string; notes: string[] }[] };
    expect(body.versions).toEqual([expect.objectContaining({ version: "1.0.0", notes: ["Fixed a thing."] })]);
    expect(body.module.contact).toBeUndefined();
  });

  it("leaves them out of the copy checks", async () => {
    const { tavora, pinnedKey, send, catalog, account } = setup();
    const big: ZipFile = { name: "lib.js", data: Buffer.from("x".repeat(5000)) };
    expect((await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes", "1.0.0", { extra: [big] }), tavora.token)).status).toBe(201);
    const other = account("other@example.com", newKey());
    const self = { moduleId: "wellbrained.timer", accountId: other.id, fingerprints: [fingerprint(other.key!)] };
    expect(catalog.othersNames(self)).toEqual([]);
    const hashes = [[createHash("sha256").update(big.data).digest("hex"), big.data.length]] as [string, number][];
    expect(catalog.mostSimilar(self, hashes)).toBeNull();
  });

  it("takes no reviews, ratings, reports or conversations for them", async () => {
    const { tavora, pinnedKey, send, call, account } = setup();
    expect((await send(pinnedKey, moduleZip(pinnedKey, "tavora.notes"), tavora.token)).status).toBe(201);
    const user = account("user@example.com", null);
    expect((await call("GET", "/v1/catalog/modules/tavora.notes/reviews")).status).toBe(404);
    expect((await call("GET", "/v1/catalog/modules/tavora.notes/review", user.token)).status).toBe(404);
    expect((await call("PUT", "/v1/catalog/modules/tavora.notes/review", user.token, { stars: 5 })).status).toBe(404);
    expect((await call("GET", "/v1/catalog/modules/tavora.notes/contact", tavora.token)).status).toBe(404);
    const sha = ((await (await call("GET", "/v1/catalog?include=official")).json()) as { modules: { zip: { sha256: string } }[] }).modules[0]!.zip.sha256;
    expect((await call("POST", "/v1/catalog/report", user.token, { id: "tavora.notes", owner: fingerprint(pinnedKey), sha256: sha })).status).toBe(404);
    const talk = await call("POST", "/v1/conversations", user.token, { moduleId: "tavora.notes", type: "bug", text: "Hello there.", versions: { tavora: "0.23.2", module: "1.0.0" } });
    expect(talk.status).toBe(404);
  });

  it("links the pinned key to the pinned account only", async () => {
    const { store, clock, account, tavora, pinnedKey, call } = setup();
    const other = account("other@example.com", null);
    expect(store.unlinkKey(tavora.id, fingerprint(pinnedKey))).toBe(true);
    const link = async (accountId: string) => {
      const { code } = store.linkCode(accountId, clock.now);
      const signature = sign(null, Buffer.from(`${LINK_STATEMENT}\n${code}`, "utf8"), pinnedKey).toString("base64");
      return call("POST", "/v1/publishers/link", null, { code, publicKey: rawKey(pinnedKey).toString("base64"), signature });
    };
    const refused = await link(other.id);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { reason: string }).reason).toBe("key-taken");
    expect(store.keys(other.id)).toEqual([]);
    expect((await link(tavora.id)).status).toBe(200);
    expect(store.keys(tavora.id).map((linked) => linked.fingerprint)).toEqual([fingerprint(pinnedKey)]);
  });

  it("refuses key replacement requests that touch the pinned key's chain", () => {
    const store = new AccountStore(":memory:");
    const now = Date.now();
    const pinned = newKey();
    const a = store.createAccount({ email: "a@example.com" }, now).id;
    const b = store.createAccount({ email: "b@example.com" }, now).id;
    const link = (accountId: string, key: KeyObject) => store.linkKey(accountId, fingerprint(key), rawKey(key).toString("base64"), now);
    const [x, y] = [newKey(), newKey()];
    link(a, x);
    link(a, y);
    link(a, pinned);
    const pins = { key: fingerprint(pinned), account: b };
    // Nothing moves onto the pinned key, even inside the pinned account.
    expect(store.requestReplacement(a, fingerprint(x), fingerprint(pinned), false, now, pins)).toBe("pinned");
    expect(store.requestReplacement(b, fingerprint(x), fingerprint(pinned), false, now, pins)).toBe("pinned");
    // The pinned key's own account may replace it; another account may not.
    expect(store.requestReplacement(a, fingerprint(pinned), fingerprint(y), false, now, pins)).toBe("pinned");
    expect(store.requestReplacement(a, fingerprint(x), fingerprint(y), false, now, pins)).toBe("ok");
    // With the pins empty nothing changes.
    expect(store.requestReplacement(a, fingerprint(pinned), fingerprint(y), false, now, { key: "", account: "" })).toBe("ok");
  });
});
