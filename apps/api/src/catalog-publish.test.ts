import { generateKeyPairSync, createPublicKey, randomBytes, type KeyObject } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, nextCatalogList, publishSignature, signCatalogList, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { AccountStore } from "./account-store.ts";
import { createApp } from "./app.ts";
import type { PublishLimits } from "./catalog-publish.ts";
import { CatalogStore } from "./catalog.ts";
import { buildDataset, writeDatabase } from "./dataset.ts";
import { createTestInbox } from "./mail.ts";
import { keyFingerprint } from "./publishers.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { Scanner } from "./virus-scan.ts";

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
/** A virus scanner that finds nothing, so the tests of publishing see only the checks they mean to. */
const cleanScanner: Scanner = { scan: async () => ({ clean: true }) };
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
/** A catalogue key for the tests, standing in for Tavora's offline one. */
const catalogue = generateKeyPairSync("ed25519").privateKey;

function moduleZip(key: KeyObject, id = "wellbrained.timer", version = "1.0.0", extra: ZipFile[] = []): Buffer {
  const manifest = { id, name: id.startsWith("wellbrained.") ? "Timer" : `Timer ${id.split(".")[0]}`, version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
  const files: ZipFile[] = [{ name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest)) }, { name: "index.html", data: Buffer.from("<p>timer</p>") }, ...extra];
  return writeZip([...files, signFiles(files, key)]);
}

/** The central (and local) headers of one entry, found by its name, for zips no honest packer writes. */
function hostile(zip: Buffer, name: string, change: (out: Buffer, central: number, local: number) => void): Buffer {
  const out = Buffer.from(zip);
  const wanted = Buffer.from(name);
  for (let at = out.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); at >= 0; at = out.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), at + 4)) {
    const length = out.readUInt16LE(at + 28);
    if (!out.subarray(at + 46, at + 46 + length).equals(wanted)) continue;
    change(out, at, out.readUInt32LE(at + 42));
    return out;
  }
  throw new Error(`no entry ${name}`);
}

function setup(limits: Partial<PublishLimits> = {}, maintainerEmail?: string, prefixRateLimiter = roomy()) {
  const store = new AccountStore(":memory:");
  const dir = mkdtempSync(path.join(tmpdir(), "tavora-catalog-"));
  const catalog = new CatalogStore(dir);
  const clock = { now: Date.parse("2026-10-18T12:00:00Z") };
  const inbox = createTestInbox();
  const app = createApp({
    db,
    catalog,
    rateLimiter: roomy(),
    publishRateLimiter: roomy(),
    publishLimits: limits,
    scanner: cleanScanner,
    catalogueKey: catalogPublicKey(catalogue),
    accounts: { store, mailer: inbox, now: () => clock.now, prefixRateLimiter },
    ...(maintainerEmail ? { maintainerEmail } : {}),
  });
  /** Each key's account sign-in; the first developer's is the one a bare publish() sends. */
  const signIns = new Map<KeyObject, string>();
  let firstSignIn: string | undefined;
  /** An account with a linked key, signed in. */
  const developer = (email: string, options: { fresh?: boolean } = {}) => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const account = store.createAccount({ email }, clock.now);
    // Developers with a version approved already (a fresh one has none, so its first module waits).
    if (!options.fresh) catalog.trustAccount(account.id, new Date(clock.now));
    store.linkKey(account.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
    const { token } = store.createSession(account.id, "windows", clock.now);
    signIns.set(key, token);
    firstSignIn ??= token;
    return { key, accountId: account.id, token };
  };
  const publish = (zip: Buffer, signature?: string, type = "application/zip", auth: string | null | undefined = firstSignIn) =>
    app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": type, ...(signature === undefined ? {} : { "x-tavora-signature": signature }), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: new Uint8Array(zip),
    });
  const send = (key: KeyObject, zip: Buffer, auth: string | null | undefined = signIns.get(key) ?? firstSignIn) => publish(zip, publishSignature(key, zip), "application/zip", auth);
  const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;
  /** The account's prefix routes, signed in with a token. */
  const prefixes = (method: "GET" | "POST", token: string, prefix?: string) =>
    app.request(`http://tavora.test/v1/account/prefixes${prefix === undefined ? "" : `/${prefix}`}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
  return { store, catalog, dir, inbox, clock, developer, publish, send, reason, prefixes, app };
}

describe("publishing to the catalog", () => {
  it("lists a zip signed and sent by a linked key, and gives its account the id prefix", async () => {
    const { store, catalog, developer, send } = setup();
    const { key, accountId } = developer("dev@example.com");
    const response = await send(key, moduleZip(key));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ status: "published", id: "wellbrained.timer", version: "1.0.0" });
    expect(catalog.index().map((entry) => entry.id)).toEqual(["wellbrained.timer"]);
    expect(store.prefixes(accountId)).toEqual(["wellbrained"]);
    expect(catalog.uploadsSince(accountId, new Date(0))).toBe(1);
  });

  it("needs the account's sign-in or a publish token besides the key, and tells the developer (decided 2026-10-20)", async () => {
    const { store, clock, inbox, developer, send, reason, app } = setup();
    const { key, accountId } = developer("dev@example.com");
    const other = developer("other@example.com");
    // The key alone, a sign-in of another account, or a made-up token: nothing is published.
    const keyOnly = await send(key, moduleZip(key), null);
    expect(keyOnly.status).toBe(401);
    expect(await reason(keyOnly)).toBe("sign-in-needed");
    expect(await reason(await send(key, moduleZip(key), other.token))).toBe("wrong-account");
    expect(await reason(await send(key, moduleZip(key), `tvp_${"x".repeat(43)}`))).toBe("sign-in-needed");

    // A token claims no new prefix: the module's first version comes from Tavora, signed in.
    const { token } = store.createPublishToken(accountId, "GitHub Actions", clock.now)!;
    expect(await reason(await send(key, moduleZip(key), token))).toBe("token-new-prefix");
    expect((await send(key, moduleZip(key))).status).toBe(201);
    expect(inbox.mails()[0]).toMatchObject({ to: "dev@example.com", subject: "Timer 1.0.0 was published" });
    expect(inbox.mails()[0]!.text).toContain("uploaded from Tavora");

    const update = await app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": "application/zip", "x-tavora-signature": publishSignature(key, moduleZip(key, "wellbrained.timer", "1.1.0")), authorization: `Bearer ${token}`, "accept-language": "de-DE" },
      body: new Uint8Array(moduleZip(key, "wellbrained.timer", "1.1.0")),
    });
    expect(update.status).toBe(201);
    expect(inbox.mails()[0]).toMatchObject({ subject: "Timer 1.1.0 wurde veröffentlicht" });
    expect(inbox.mails()[0]!.text).toContain("„GitHub Actions“");
    expect(store.publishTokens(accountId, clock.now)[0]?.lastUsedAt).toBe(clock.now);

    // A removed or run-out token publishes nothing.
    const id = store.publishTokens(accountId, clock.now)[0]!.id;
    expect(store.deletePublishToken(accountId, id)).toBe(true);
    expect(await reason(await send(key, moduleZip(key, "wellbrained.timer", "1.2.0"), token))).toBe("sign-in-needed");
    const old = store.createPublishToken(accountId, "old", clock.now)!.token;
    clock.now += 366 * 86_400_000;
    expect(await reason(await send(key, moduleZip(key, "wellbrained.timer", "1.2.0"), old))).toBe("sign-in-needed");
  });

  it("refuses an upload not signed by the zip's own key, so a zip shared by hand cannot be published by others", async () => {
    const { catalog, developer, publish, send, reason } = setup();
    const { key } = developer("dev@example.com");
    const other = developer("other@example.com").key;
    const zip = moduleZip(key);
    expect(await reason(await publish(zip))).toBe("bad-signature");
    expect(await reason(await send(other, zip))).toBe("bad-signature");
    // A signature over another zip's hash does not carry over.
    expect(await reason(await publish(zip, publishSignature(key, moduleZip(key, "wellbrained.other"))))).toBe("bad-signature");
    expect(catalog.modules()).toEqual([]);
  });

  it("refuses unlinked keys, unsigned or broken zips and other content types", async () => {
    const { developer, publish, send, reason } = setup();
    const { key } = developer("dev@example.com");
    const unlinked = generateKeyPairSync("ed25519").privateKey;
    const unlinkedAnswer = await send(unlinked, moduleZip(unlinked));
    expect(unlinkedAnswer.status).toBe(403);
    expect(await reason(unlinkedAnswer)).toBe("key-not-linked");
    const unsigned = writeZip([{ name: "tavora.module.json", data: Buffer.from("{}") }]);
    const invalid = await send(key, unsigned);
    expect(invalid.status).toBe(400);
    expect(await reason(invalid)).toBe("invalid");
    expect((await publish(moduleZip(key), publishSignature(key, moduleZip(key)), "application/json")).status).toBe(415);
  });

  it("refuses a zip bomb, a link and a .. path in a signed upload, and stores nothing (C8)", async () => {
    const { store, catalog, dir, developer, send } = setup();
    const { key, accountId } = developer("dev@example.com");
    const extra = (name: string, data = Buffer.from("x")) => moduleZip(key, "wellbrained.timer", "1.0.0", [{ name, data }]);
    const attacks = {
      // 5 MB of zeros packs into a few KB: far past the ratio cap.
      bomb: extra("zeros.bin", Buffer.alloc(5 * 1024 * 1024)),
      // A Unix symlink entry, pointing wherever its data says.
      link: hostile(extra("link.txt", Buffer.from("/etc/passwd")), "link.txt", (out, central) => {
        out.writeUInt16LE((3 << 8) | 20, central + 4);
        out.writeUInt32LE((0o120777 << 16) >>> 0, central + 38);
      }),
      // A name that climbs out of wherever it would be unpacked, in both headers.
      dotdot: hostile(extra("zzzzzzz.txt"), "zzzzzzz.txt", (out, central, local) => {
        Buffer.from("../evil.txt").copy(out, central + 46);
        Buffer.from("../evil.txt").copy(out, local + 30);
      }),
    };
    for (const [attack, zip] of Object.entries(attacks)) {
      const answer = await send(key, zip);
      expect(answer.status, attack).toBe(400);
      // Refused by readZip itself, before the manifest or signature are looked at.
      expect(await answer.json(), attack).toMatchObject({ reason: "invalid", error: expect.stringMatching(/^The zip was refused/) });
    }
    expect(catalog.modules()).toEqual([]);
    expect(catalog.storedBytes()).toBe(0);
    expect(catalog.uploadsSince(accountId, new Date(0))).toBe(0);
    expect(store.prefixes(accountId)).toEqual([]);
    expect(readdirSync(path.join(dir, "zips"))).toEqual([]);
    expect(readdirSync(path.join(dir, "pictures"))).toEqual([]);
    expect(readdirSync(dir).filter((name) => !name.startsWith("catalog.sqlite")).sort()).toEqual(["lists", "pictures", "zips"]);
    expect(existsSync(path.join(dir, "..", "evil.txt"))).toBe(false);
  });

  it("keeps a prefix to the account that has it, refuses reserved ones and holds at most three", async () => {
    const { developer, send, reason } = setup();
    const first = developer("first@example.com");
    const second = developer("second@example.com");
    expect((await send(first.key, moduleZip(first.key, "wellbrained.timer"))).status).toBe(201);
    expect(await reason(await send(second.key, moduleZip(second.key, "wellbrained.notes")))).toBe("prefix-taken");
    expect(await reason(await send(second.key, moduleZip(second.key, "tavoratools.notes")))).toBe("prefix-reserved");
    expect(await reason(await send(second.key, moduleZip(second.key, "official.notes")))).toBe("prefix-reserved");
    for (const prefix of ["alpha", "beta", "gamma"]) expect((await send(second.key, moduleZip(second.key, `${prefix}.notes`))).status).toBe(201);
    expect(await reason(await send(second.key, moduleZip(second.key, "delta.notes")))).toBe("too-many-prefixes");
    // Another module under a prefix the account holds needs nothing new.
    expect((await send(second.key, moduleZip(second.key, "alpha.timer"))).status).toBe(201);
  });

  it("takes only newer versions, from the module's own key", async () => {
    const { store, developer, send, reason } = setup();
    const { key, accountId } = developer("dev@example.com");
    expect((await send(key, moduleZip(key, "wellbrained.timer", "1.1.0"))).status).toBe(201);
    const older = await send(key, moduleZip(key, "wellbrained.timer", "1.0.0"));
    expect(older.status).toBe(409);
    expect(await reason(older)).toBe("conflict");
    // A second key of the same account holds the prefix, but the module stays its first key's (C3).
    const second = generateKeyPairSync("ed25519").privateKey;
    store.linkKey(accountId, keyFingerprint(rawKey(second)), rawKey(second).toString("base64"), Date.now());
    expect(await reason(await send(second, moduleZip(second, "wellbrained.timer", "2.0.0")))).toBe("conflict");
  });

  it("limits uploads per day, room per account and room in the whole catalog", async () => {
    const daily = setup({ uploadsPerDay: 2 });
    const dev = daily.developer("dev@example.com");
    expect((await daily.send(dev.key, moduleZip(dev.key, "wellbrained.timer", "1.0.0"))).status).toBe(201);
    expect((await daily.send(dev.key, moduleZip(dev.key, "wellbrained.timer", "1.0.1"))).status).toBe(201);
    expect(await daily.reason(await daily.send(dev.key, moduleZip(dev.key, "wellbrained.timer", "1.0.2")))).toBe("daily-limit");
    daily.clock.now += 86_400_001;
    expect((await daily.send(dev.key, moduleZip(dev.key, "wellbrained.timer", "1.0.2"))).status).toBe(201);

    // The maintainer's account (MAINTAINER_EMAIL, any case) has no daily limit.
    const own = setup({ uploadsPerDay: 2 }, "Maintainer@Example.com");
    const maintainer = own.developer("maintainer@example.com");
    for (const version of ["1.0.0", "1.0.1", "1.0.2", "1.0.3"]) {
      expect((await own.send(maintainer.key, moduleZip(maintainer.key, "wellbrained.timer", version))).status).toBe(201);
    }
    const other = own.developer("dev@example.com");
    expect((await own.send(other.key, moduleZip(other.key, "other.timer", "1.0.0"))).status).toBe(201);
    expect((await own.send(other.key, moduleZip(other.key, "other.timer", "1.0.1"))).status).toBe(201);
    expect(await own.reason(await own.send(other.key, moduleZip(other.key, "other.timer", "1.0.2")))).toBe("daily-limit");

    const small = moduleZip(dev.key);
    const room = setup({ accountBytes: small.length + 10 });
    const roomDev = room.developer("dev@example.com");
    expect((await room.send(roomDev.key, moduleZip(roomDev.key, "wellbrained.timer", "1.0.0"))).status).toBe(201);
    expect(await room.reason(await room.send(roomDev.key, moduleZip(roomDev.key, "wellbrained.timer", "1.0.1")))).toBe("account-full");

    const full = setup({ catalogBytes: 10 });
    const fullDev = full.developer("dev@example.com");
    const answer = await full.send(fullDev.key, moduleZip(fullDev.key));
    expect(answer.status).toBe(507);
    expect(await full.reason(answer)).toBe("catalog-full");
  });

  it("keeps the zips of a module's newest versions only, so a full account can still publish its next version", async () => {
    const probe = generateKeyPairSync("ed25519").privateKey;
    const size = moduleZip(probe, "wellbrained.timer", "1.0.0").length;
    // Room for three zips of this size and a little more, never four.
    const own = setup({ accountBytes: size * 3 + 50, keepVersions: 3 });
    const dev = own.developer("dev@example.com");
    const sha = new Map<string, string>();
    for (const version of ["1.0.0", "1.0.1", "1.0.2", "1.0.3", "1.0.4"]) {
      const answer = await own.send(dev.key, moduleZip(dev.key, "wellbrained.timer", version));
      expect(answer.status).toBe(201);
      sha.set(version, ((await answer.json()) as { sha256: string }).sha256);
    }
    const zip = (version: string) => own.app.request(`http://tavora.test/v1/catalog/zips/${sha.get(version)}.zip`);
    expect((await zip("1.0.0")).status).toBe(404);
    expect((await zip("1.0.1")).status).toBe(404);
    for (const version of ["1.0.2", "1.0.3", "1.0.4"]) expect((await zip(version)).status).toBe(200);
    expect(existsSync(path.join(own.dir, "zips", `${sha.get("1.0.0")}.zip`))).toBe(false);
    expect(own.catalog.storedBytes(dev.accountId)).toBeLessThanOrEqual(size * 3 + 50);
    // The old versions' notes stay on the module's page.
    const page = (await (await own.app.request("http://tavora.test/v1/catalog/modules/wellbrained.timer")).json()) as { versions: { version: string }[] };
    expect(page.versions.map((v) => v.version)).toEqual(["1.0.4", "1.0.3", "1.0.2", "1.0.1", "1.0.0"]);
    // Another module of the same account still has to fit beside them.
    expect(await own.reason(await own.send(dev.key, moduleZip(dev.key, "wellbrained.clock", "1.0.0")))).toBe("account-full");
  });

  it("tells the maintainer once a day when the catalog is full, and shows it until an upload fits (C9)", async () => {
    const first = moduleZip(generateKeyPairSync("ed25519").privateKey);
    const full = setup({ catalogBytes: 2 * first.length + 100 }, "maintainer@example.com");
    const dev = full.developer("dev@example.com");
    expect((await full.send(dev.key, moduleZip(dev.key, "wellbrained.timer", "1.0.0"))).status).toBe(201);
    expect(full.catalog.fullSince()).toBeNull();
    let patch = 0;
    const tooMuch = () => full.send(dev.key, moduleZip(dev.key, "wellbrained.timer", `1.1.${++patch}`, [{ name: "noise.bin", data: randomBytes(2000) }]));
    expect((await tooMuch()).status).toBe(507);
    expect((await tooMuch()).status).toBe(507);
    const told = full.inbox.mails().filter((mail) => mail.to === "maintainer@example.com");
    expect(told).toHaveLength(1);
    expect(told[0]!.subject).toMatch(/catalog is full/);
    expect(full.catalog.fullSince()).toBe(new Date(full.clock.now).toISOString());
    // Once a day at most; the moment it got full stays.
    full.clock.now += 86_400_001;
    expect((await tooMuch()).status).toBe(507);
    expect(full.inbox.mails().filter((mail) => mail.to === "maintainer@example.com")).toHaveLength(2);
    expect(full.catalog.fullSince()).toBe("2026-10-18T12:00:00.000Z");
    // An upload that fits again clears it.
    expect((await full.send(dev.key, moduleZip(dev.key, "wellbrained.timer", "2.0.0"))).status).toBe(201);
    expect(full.catalog.fullSince()).toBeNull();

    // Without a maintainer address nobody is mailed, but the admin page still shows it.
    const quiet = setup({ catalogBytes: 10 });
    const quietDev = quiet.developer("dev@example.com");
    expect((await quiet.send(quietDev.key, moduleZip(quietDev.key))).status).toBe(507);
    expect(quiet.inbox.mails()).toEqual([]);
    expect(quiet.catalog.fullSince()).not.toBeNull();
  });

  it("answers 503 without accounts, and 429 when a client uploads too often", async () => {
    const catalog = new CatalogStore(mkdtempSync(path.join(tmpdir(), "tavora-catalog-")));
    const key = generateKeyPairSync("ed25519").privateKey;
    const zip = moduleZip(key);
    const request = () => ({ method: "POST", headers: { "content-type": "application/zip", "x-tavora-signature": publishSignature(key, zip) }, body: new Uint8Array(zip) });
    expect((await createApp({ db, catalog }).request("http://tavora.test/v1/catalog/publish", request())).status).toBe(503);
    const busy = createApp({ db, catalog, publishRateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }), accounts: { store: new AccountStore(":memory:"), mailer: createTestInbox() } });
    await busy.request("http://tavora.test/v1/catalog/publish", request());
    expect((await busy.request("http://tavora.test/v1/catalog/publish", request())).status).toBe(429);
  });

  it("takes new versions from a successor key named in the signed successions list, for the same account only (C7)", async () => {
    const { store, catalog, clock, developer, send, reason } = setup();
    const { key: lost, accountId } = developer("dev@example.com");
    expect((await send(lost, moduleZip(lost, "wellbrained.timer", "1.0.0"))).status).toBe(201);
    const next = generateKeyPairSync("ed25519").privateKey;
    store.linkKey(accountId, keyFingerprint(rawKey(next)), rawKey(next).toString("base64"), clock.now);
    const successions = (account: string, signer: KeyObject = catalogue) =>
      signCatalogList(nextCatalogList("successions", [{ old: keyFingerprint(rawKey(lost)), new: keyFingerprint(rawKey(next)), account }], null, new Date(clock.now)), signer);

    // No list, a list signed by another key, or one naming another account: still the first key's module.
    expect(await reason(await send(next, moduleZip(next, "wellbrained.timer", "1.1.0")))).toBe("conflict");
    catalog.setList("successions", Buffer.from(successions(accountId, generateKeyPairSync("ed25519").privateKey)));
    expect(await reason(await send(next, moduleZip(next, "wellbrained.timer", "1.1.0")))).toBe("conflict");
    catalog.setList("successions", Buffer.from(successions("someone-else")));
    expect(await reason(await send(next, moduleZip(next, "wellbrained.timer", "1.1.0")))).toBe("conflict");

    catalog.setList("successions", Buffer.from(successions(accountId)));
    const zip = moduleZip(next, "wellbrained.timer", "1.1.0");
    expect((await send(next, zip)).status).toBe(201);
    // The listing names the key that signed the newest zip, which the app checks the zip against.
    const [entry] = catalog.index();
    expect(entry).toMatchObject({ id: "wellbrained.timer", version: "1.1.0", owner: keyFingerprint(rawKey(next)) });
    expect(catalog.modules()[0]!.owner).toBe(keyFingerprint(rawKey(lost)));
    // Reports of the new zip name its key, or the module's first key.
    expect(catalog.report({ id: "wellbrained.timer", owner: keyFingerprint(rawKey(next)), sha256: entry!.zip.sha256 })).toBe(true);
    expect(catalog.report({ id: "wellbrained.timer", owner: keyFingerprint(rawKey(lost)), sha256: entry!.zip.sha256 })).toBe(true);
  });

  it("refuses uploads signed by a revoked key (C6)", async () => {
    const { catalog, clock, developer, send, reason } = setup();
    const { key } = developer("dev@example.com");
    expect((await send(key, moduleZip(key, "wellbrained.timer", "1.0.0"))).status).toBe(201);
    const revoked = [{ fingerprint: keyFingerprint(rawKey(key)), revoked: "2026-10-18T11:00:00Z", allow: [] }];
    catalog.setList("revocations", Buffer.from(signCatalogList(nextCatalogList("revocations", revoked, null, new Date(clock.now)), catalogue)));
    const answer = await send(key, moduleZip(key, "wellbrained.timer", "1.0.1"));
    expect(answer.status).toBe(403);
    expect(await reason(answer)).toBe("key-revoked");
    // A revocation signed by any other key counts for nothing.
    catalog.setList("revocations", Buffer.from(signCatalogList(nextCatalogList("revocations", revoked, null, new Date(clock.now)), generateKeyPairSync("ed25519").privateKey)));
    expect((await send(key, moduleZip(key, "wellbrained.timer", "1.0.1"))).status).toBe(201);
  });

  it("refuses uploads signed by a key the account reported as leaked, until the request is turned down", async () => {
    const { store, clock, developer, send, reason } = setup();
    const { key, accountId } = developer("dev@example.com");
    const next = generateKeyPairSync("ed25519").privateKey;
    store.linkKey(accountId, keyFingerprint(rawKey(next)), rawKey(next).toString("base64"), clock.now);
    const old = keyFingerprint(rawKey(key));
    expect(store.requestReplacement(accountId, old, keyFingerprint(rawKey(next)), false, clock.now)).toBe("ok");
    // Lost is not leaked: the key may still publish.
    expect((await send(key, moduleZip(key, "wellbrained.timer", "1.0.0"))).status).toBe(201);
    expect(store.requestReplacement(accountId, old, keyFingerprint(rawKey(next)), true, clock.now)).toBe("ok");
    const answer = await send(key, moduleZip(key, "wellbrained.timer", "1.0.1"));
    expect(answer.status).toBe(403);
    expect(await reason(answer)).toBe("key-leaked");
    expect(store.declineKeyRequest(old, clock.now)).toBe(true);
    expect((await send(key, moduleZip(key, "wellbrained.timer", "1.0.1"))).status).toBe(201);
  });
});

describe("claiming an id prefix before the first publish", () => {
  it("tells what a prefix is to the account, and claims a free one", async () => {
    const { developer, prefixes } = setup();
    const first = developer("first@example.com");
    const second = developer("second@example.com");
    const state = async (token: string, prefix: string) => ((await (await prefixes("GET", token, prefix)).json()) as { state: string }).state;
    expect(await (await prefixes("GET", first.token, "wellbrained")).json()).toEqual({ prefix: "wellbrained", state: "free" });

    const claimed = await prefixes("POST", first.token, "wellbrained");
    expect(claimed.status).toBe(200);
    expect(await claimed.json()).toEqual({ prefix: "wellbrained", state: "held" });
    // Claiming again changes nothing.
    expect(await (await prefixes("POST", first.token, "wellbrained")).json()).toEqual({ prefix: "wellbrained", state: "held" });
    expect(await state(first.token, "wellbrained")).toBe("held");
    expect(await state(second.token, "wellbrained")).toBe("taken");
    expect(await state(second.token, "tavoratools")).toBe("reserved");
    expect(await state(second.token, "local")).toBe("reserved");
    for (const prefix of ["Wellbrained", "9lives", "well-brained", "a".repeat(127)]) expect(await state(second.token, prefix)).toBe("invalid");
  });

  it("refuses taken, reserved and invalid prefixes, and counts claims toward the three", async () => {
    const { store, developer, prefixes, reason } = setup();
    const first = developer("first@example.com");
    const second = developer("second@example.com");
    await prefixes("POST", first.token, "wellbrained");
    const taken = await prefixes("POST", second.token, "wellbrained");
    expect(taken.status).toBe(403);
    expect(await reason(taken)).toBe("prefix-taken");
    expect(await reason(await prefixes("POST", second.token, "official"))).toBe("prefix-reserved");
    const invalid = await prefixes("POST", second.token, "Not-OK");
    expect(invalid.status).toBe(400);
    expect(await reason(invalid)).toBe("invalid");

    for (const prefix of ["alpha", "beta", "gamma"]) expect((await prefixes("POST", second.token, prefix)).status).toBe(200);
    expect(await reason(await prefixes("POST", second.token, "delta"))).toBe("too-many-prefixes");
    expect(((await (await prefixes("GET", second.token, "delta")).json()) as { state: string }).state).toBe("too-many");
    // A held one is still held at the limit.
    expect(((await (await prefixes("POST", second.token, "alpha")).json()) as { state: string }).state).toBe("held");
    expect(store.prefixes(second.accountId)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("lists the account's prefixes with when each was claimed and whether it has a module", async () => {
    const { clock, developer, prefixes, send } = setup();
    const { key, token } = developer("dev@example.com");
    expect(await (await prefixes("GET", token)).json()).toEqual({ prefixes: [], max: 3 });
    await prefixes("POST", token, "notes");
    clock.now += 1000;
    expect((await send(key, moduleZip(key, "wellbrained.timer"))).status).toBe(201);
    expect(await (await prefixes("GET", token)).json()).toEqual({
      prefixes: [
        { prefix: "notes", claimedAt: Date.parse("2026-10-18T12:00:00Z"), published: false },
        { prefix: "wellbrained", claimedAt: Date.parse("2026-10-18T12:00:01Z"), published: true },
      ],
      max: 3,
    });
  });

  it("lets a publish token publish a first version under a claimed prefix", async () => {
    const { store, clock, developer, prefixes, send, reason } = setup();
    const { key, accountId, token } = developer("dev@example.com");
    const { token: ci } = store.createPublishToken(accountId, "GitHub Actions", clock.now)!;
    expect(await reason(await send(key, moduleZip(key), ci))).toBe("token-new-prefix");
    await prefixes("POST", token, "wellbrained");
    expect((await send(key, moduleZip(key), ci)).status).toBe(201);
  });

  it("needs a sign-in, never a publish token, and limits claims per client", async () => {
    const { store, clock, developer, prefixes, reason } = setup({}, undefined, createRateLimiter({ limit: 2, windowMs: 3_600_000 }));
    const { accountId, token } = developer("dev@example.com");
    const { token: ci } = store.createPublishToken(accountId, "GitHub Actions", clock.now)!;
    for (const method of ["GET", "POST"] as const) expect((await prefixes(method, ci, "wellbrained")).status).toBe(401);
    expect((await prefixes("POST", token, "alpha")).status).toBe(200);
    // Checking is not a claim and does not count.
    expect((await prefixes("GET", token, "beta")).status).toBe(200);
    expect((await prefixes("POST", token, "beta")).status).toBe(200);
    const limited = await prefixes("POST", token, "gamma");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await reason(limited)).toBe("too-many");
    expect(store.prefixes(accountId)).toEqual(["alpha", "beta"]);
  });
});
