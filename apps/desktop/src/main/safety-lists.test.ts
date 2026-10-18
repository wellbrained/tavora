import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, fingerprint, signCatalogList, signFiles, writeZip, type CatalogList, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { installZip, readOwnerRecords } from "./installer";
import type { InstalledModule, ModuleProblem } from "./registry";
import { CATALOGUE_PUBLIC_KEY, SafetyLists, stopBlocked } from "./safety-lists";

const TAVORA = "0.18.0";
const ID = "wellbrained.tracker";
const catalogue = generateKeyPairSync("ed25519").privateKey;
const publicKey = catalogPublicKey(catalogue);
const ISSUED = "2026-10-18T12:00:00Z";

const manifest = (version: string) =>
  JSON.stringify({ id: ID, name: "Tracker", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } });

/** The bytes of a module zip signed by `key`. */
function zip(key: KeyObject, version = "1.0.0", page = "<p>hi</p>"): Buffer {
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(manifest(version)) },
    { name: "dist/index.html", data: Buffer.from(page) },
  ];
  return writeZip([...files, signFiles(files, key)]);
}

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function setup() {
  const userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-safety-")));
  const userModules = path.join(userData, "modules");
  await mkdir(userModules);
  return { userData, userModules };
}

async function save(dir: string, bytes: Buffer): Promise<string> {
  const file = path.join(dir, `pkg-${Math.random().toString(36).slice(2)}.zip`);
  await writeFile(file, bytes);
  return file;
}

/** A service that serves these signed lists, and records what it was asked. */
function service(lists: Partial<Record<CatalogList["kind"], string>>) {
  const asked: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    asked.push({ url, init });
    const kind = /\/v1\/catalog\/lists\/(\w+)\.json$/.exec(url)?.[1] as CatalogList["kind"] | undefined;
    const text = kind ? lists[kind] : undefined;
    return text === undefined ? new Response("", { status: 404 }) : new Response(text);
  }) as typeof fetch;
  return { asked, fetchImpl };
}

function lists(userData: string, served: Partial<Record<CatalogList["kind"], string>> = {}, online = true) {
  const { asked, fetchImpl } = service(served);
  const safety = new SafetyLists({ file: path.join(userData, "catalog-lists.json"), baseUrl: "https://api.example.test/", publicKey, online: () => online, fetchImpl });
  return { safety, asked };
}

const revocations = (sequence: number, revoked: { fingerprint: string; allow: string[] }[], key = catalogue) =>
  signCatalogList({ kind: "revocations", sequence, issued: ISSUED, revoked: revoked.map((entry) => ({ ...entry, revoked: ISSUED })) }, key);
const blocks = (sequence: number, blocked: string[], key = catalogue) =>
  signCatalogList({ kind: "blocks", sequence, issued: ISSUED, blocked: blocked.map((sha256) => ({ sha256, reason: "It sends your files to a stranger's server." })) }, key);
const successions = (sequence: number, statements: { old: string; new: string; account: string }[], key = catalogue) =>
  signCatalogList({ kind: "successions", sequence, issued: ISSUED, successions: statements }, key);

function loaded(root: string, owner: string, version = "1.0.0"): InstalledModule {
  return { manifest: JSON.parse(manifest(version)), root, provenance: "local", owner };
}

describe("SafetyLists", () => {
  it("ships without a catalogue key until Dom fills it in, and then accepts nothing", async () => {
    expect(CATALOGUE_PUBLIC_KEY).toBe("");
    const { userData } = await setup();
    const { fetchImpl, asked } = service({ blocks: blocks(1, ["a".repeat(64)]) });
    const safety = new SafetyLists({ file: path.join(userData, "l.json"), baseUrl: "https://api.example.test", publicKey: CATALOGUE_PUBLIC_KEY, online: () => true, fetchImpl });
    expect(await safety.refresh()).toBe(false);
    expect(asked).toEqual([]);
  });

  it("asks only while online features are on, with nothing that says who asks, and keeps what it got", async () => {
    const { userData } = await setup();
    const off = lists(userData, { blocks: blocks(1, ["a".repeat(64)]) }, false);
    expect(await off.safety.refresh()).toBe(false);
    expect(off.asked).toEqual([]);

    const on = lists(userData, { blocks: blocks(1, ["a".repeat(64)]) });
    expect(await on.safety.refresh()).toBe(true);
    expect(on.asked.map(({ url }) => url)).toEqual(["revocations", "blocks", "successions"].map((kind) => `https://api.example.test/v1/catalog/lists/${kind}.json`));
    expect(on.asked[0]!.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });

    // A new run reads the kept lists, checking their signature again.
    const later = lists(userData);
    await later.safety.load();
    expect(later.safety.blocked("a".repeat(64))).not.toBeNull();
  });

  it("ignores a list signed by another key, an older list and the same list again (C2, C6, C14)", async () => {
    const { userData } = await setup();
    const other = generateKeyPairSync("ed25519").privateKey;
    const { safety } = lists(userData);
    expect(safety.accept("blocks", blocks(1, ["a".repeat(64)], other))).toBe(false);
    expect(safety.accept("revocations", revocations(1, [{ fingerprint: "0".repeat(32), allow: [] }], other))).toBe(false);
    expect(safety.revoked("0".repeat(32), "a".repeat(64))).toBe(false);

    expect(safety.accept("blocks", blocks(2, ["a".repeat(64)]))).toBe(true);
    // A server holding an older list back cannot lift a block with it.
    expect(safety.accept("blocks", blocks(1, []))).toBe(false);
    expect(safety.accept("blocks", blocks(2, []))).toBe(false);
    expect(safety.blocked("a".repeat(64))).not.toBeNull();
    expect(safety.accept("blocks", blocks(3, []))).toBe(true);
    expect(safety.blocked("a".repeat(64))).toBeNull();
  });
});

describe("C6: a revoked key", () => {
  it("is refused unless the zip is on the allowlist, and an older list is ignored", async () => {
    const { userData, userModules } = await setup();
    const publisher = generateKeyPairSync("ed25519").privateKey;
    const before = zip(publisher, "1.0.0");
    const after = zip(publisher, "1.0.0", "<p>made with the stolen key</p>");
    const { safety } = lists(userData);
    safety.accept("revocations", revocations(2, [{ fingerprint: fingerprint(publisher), allow: [sha(before)] }]));

    await expect(installZip(await save(userData, after), { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety })).rejects.toMatchObject({
      key: "error.installRevoked",
      params: { name: "Tracker" },
    });
    expect(await readdir(userModules)).toEqual([]);

    // An older list without the revocation changes nothing.
    expect(safety.accept("revocations", revocations(1, []))).toBe(false);
    await expect(installZip(await save(userData, after), { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety })).rejects.toMatchObject({ key: "error.installRevoked" });

    const installed = await installZip(await save(userData, before), { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety });
    expect(installed.owner).toBe(fingerprint(publisher));
  });

  it("also cannot update a module it signed before", async () => {
    const { userData, userModules } = await setup();
    const publisher = generateKeyPairSync("ed25519").privateKey;
    const { safety } = lists(userData);
    await installZip(await save(userData, zip(publisher)), { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety });
    safety.accept("revocations", revocations(1, [{ fingerprint: fingerprint(publisher), allow: [] }]));
    const modules = new Map([[ID, loaded(path.join(userModules, ID), fingerprint(publisher))]]);
    await expect(installZip(await save(userData, zip(publisher, "1.1.0")), { userData, userModules, tavoraVersion: TAVORA, modules, safety })).rejects.toMatchObject({ key: "error.installRevoked" });
    expect(await readFile(path.join(userModules, ID, "dist", "index.html"), "utf8")).toBe("<p>hi</p>");
  });
});

describe("C7: a lost key's successor", () => {
  it("updates the old key's module and its data stays with the first key", async () => {
    const { userData, userModules } = await setup();
    const lost = generateKeyPairSync("ed25519").privateKey;
    const replacement = generateKeyPairSync("ed25519").privateKey;
    const { safety } = lists(userData);
    await installZip(await save(userData, zip(lost)), { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety });
    const modules = new Map([[ID, loaded(path.join(userModules, ID), fingerprint(lost))]]);

    safety.accept("successions", successions(1, [{ old: fingerprint(lost), new: fingerprint(replacement), account: "acct_1" }]));
    const next = zip(replacement, "1.1.0", "<p>new</p>");
    const updated = await installZip(await save(userData, next), { userData, userModules, tavoraVersion: TAVORA, modules, safety });
    expect(updated).toMatchObject({ owner: fingerprint(lost), updated: true });
    expect(await readOwnerRecords(userData)).toEqual({ [ID]: { id: ID, owner: fingerprint(lost), signer: fingerprint(replacement), sha256: sha(next) } });
    expect(await readFile(path.join(userModules, ID, "dist", "index.html"), "utf8")).toBe("<p>new</p>");
  });

  it("follows a chain of successions within one account to the first key", async () => {
    const { userData } = await setup();
    const [a, b, c] = ["a", "b", "c"].map((x) => x.repeat(32)) as [string, string, string];
    const { safety } = lists(userData);
    safety.accept("successions", successions(1, [{ old: a, new: b, account: "acct_1" }, { old: b, new: c, account: "acct_1" }]));
    expect(safety.firstKey(c)).toBe(a);
    // A step into another account, or a key claimed by two old keys, is not followed.
    safety.accept("successions", successions(2, [{ old: a, new: b, account: "acct_1" }, { old: b, new: c, account: "acct_2" }]));
    expect(safety.firstKey(c)).toBe(b);
    safety.accept("successions", successions(3, [{ old: a, new: c, account: "acct_1" }, { old: b, new: c, account: "acct_1" }]));
    expect(safety.firstKey(c)).toBe(c);
  });

  it("moves nothing without a valid statement", async () => {
    const { userData, userModules } = await setup();
    const lost = generateKeyPairSync("ed25519").privateKey;
    const stranger = generateKeyPairSync("ed25519").privateKey;
    const other = generateKeyPairSync("ed25519").privateKey;
    const { safety } = lists(userData);
    await installZip(await save(userData, zip(lost)), { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety });
    const modules = new Map([[ID, loaded(path.join(userModules, ID), fingerprint(lost))]]);

    // A statement signed by any other key than the catalogue key is ignored.
    expect(safety.accept("successions", successions(1, [{ old: fingerprint(lost), new: fingerprint(stranger), account: "acct_1" }], other))).toBe(false);
    for (const attempt of [undefined, safety]) {
      await expect(installZip(await save(userData, zip(stranger, "2.0.0")), { userData, userModules, tavoraVersion: TAVORA, modules, ...(attempt ? { safety: attempt } : {}) })).rejects.toMatchObject({
        key: "error.installOtherPublisher",
      });
    }
    expect(await readOwnerRecords(userData)).toMatchObject({ [ID]: { owner: fingerprint(lost) } });
    expect((await readOwnerRecords(userData))[ID]!.signer).toBeUndefined();
  });
});

describe("C14: a blocked zip", () => {
  it("is stopped with its data kept and the reason said, and only an unblocked zip brings it back", async () => {
    const { userData, userModules } = await setup();
    const publisher = generateKeyPairSync("ed25519").privateKey;
    const harmful = zip(publisher, "1.0.0", "<p>harmful</p>");
    const { safety } = lists(userData);
    await installZip(await save(userData, harmful), { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety });
    const root = path.join(userModules, ID);
    // The module's data lives elsewhere, keyed by owner and id; stopping it touches no file.
    await writeFile(path.join(root, "kept.txt"), "data");

    // A block signed by another key changes nothing.
    expect(safety.accept("blocks", blocks(1, [sha(harmful)], generateKeyPairSync("ed25519").privateKey))).toBe(false);
    const records = await readOwnerRecords(userData);
    const untouched = new Map([[ID, loaded(root, fingerprint(publisher))]]);
    expect(stopBlocked(untouched, userModules, records, safety, []).size).toBe(0);
    expect(untouched.has(ID)).toBe(true);

    expect(safety.accept("blocks", blocks(1, [sha(harmful)]))).toBe(true);
    const modules = new Map([[ID, loaded(root, fingerprint(publisher))]]);
    const problems: ModuleProblem[] = [];
    const stopped = stopBlocked(modules, userModules, records, safety, problems);
    expect(modules.has(ID)).toBe(false);
    expect([...stopped.keys()]).toEqual([ID]);
    expect(problems).toEqual([{ folder: ID, message: expect.stringContaining("Tavora stopped Tracker 1.0.0 because it can do harm: It sends your files to a stranger's server. Its data is kept") }]);
    expect(await readFile(path.join(root, "kept.txt"), "utf8")).toBe("data");

    // The same zip cannot be installed again, from anywhere.
    await expect(installZip(await save(userData, harmful), { userData, userModules, tavoraVersion: TAVORA, modules: stopped, safety })).rejects.toMatchObject({
      key: "error.installBlocked",
      params: { name: "Tracker", reason: "It sends your files to a stranger's server." },
    });
    // A fixed version installs as an update of the stopped one, with the same owner.
    const fixed = zip(publisher, "1.0.1", "<p>fixed</p>");
    expect(await installZip(await save(userData, fixed), { userData, userModules, tavoraVersion: TAVORA, modules: stopped, safety })).toMatchObject({ updated: true, owner: fingerprint(publisher) });
    const after = new Map([[ID, loaded(root, fingerprint(publisher), "1.0.1")]]);
    expect(stopBlocked(after, userModules, await readOwnerRecords(userData), safety, []).size).toBe(0);
  });
});
