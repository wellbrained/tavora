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

const db = writeDatabase(":memory:", buildDataset({ builtIns: [{ id: "elden-ring", name: "Elden Ring" }], wikidata: [], steam: [] }));
const roomy = () => createRateLimiter({ limit: 1000, windowMs: 60_000 });
const rawKey = (key: KeyObject) => createPublicKey(key).export({ format: "der", type: "spki" }).subarray(12);
/** A catalogue key for the tests, standing in for Tavora's offline one. */
const catalogue = generateKeyPairSync("ed25519").privateKey;

function moduleZip(key: KeyObject, id = "wellbrained.timer", version = "1.0.0", extra: ZipFile[] = []): Buffer {
  const manifest = { id, name: "Timer", version, apiVersion: "1", entry: "index.html", games: [], viewport: { minWidth: 200, minHeight: 150 }, permissions: { network: [] } };
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

function setup(limits: Partial<PublishLimits> = {}, maintainerEmail?: string) {
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
    catalogueKey: catalogPublicKey(catalogue),
    accounts: { store, mailer: inbox, now: () => clock.now },
    ...(maintainerEmail ? { maintainerEmail } : {}),
  });
  /** An account with a linked key. */
  const developer = (email: string) => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const account = store.createAccount({ email }, clock.now);
    store.linkKey(account.id, keyFingerprint(rawKey(key)), rawKey(key).toString("base64"), clock.now);
    return { key, accountId: account.id };
  };
  const publish = (zip: Buffer, signature?: string, type = "application/zip") =>
    app.request("http://tavora.test/v1/catalog/publish", {
      method: "POST",
      headers: { "content-type": type, ...(signature === undefined ? {} : { "x-tavora-signature": signature }) },
      body: new Uint8Array(zip),
    });
  const send = (key: KeyObject, zip: Buffer) => publish(zip, publishSignature(key, zip));
  const reason = async (response: Response) => ((await response.json()) as { reason?: string }).reason;
  return { store, catalog, dir, inbox, clock, developer, publish, send, reason };
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
    const unlinked = generateKeyPairSync("ed25519").privateKey;
    const unlinkedAnswer = await send(unlinked, moduleZip(unlinked));
    expect(unlinkedAnswer.status).toBe(403);
    expect(await reason(unlinkedAnswer)).toBe("key-not-linked");
    const { key } = developer("dev@example.com");
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
    expect(readdirSync(dir).filter((name) => !name.startsWith("catalog.sqlite")).sort()).toEqual(["lists", "zips"]);
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
});
