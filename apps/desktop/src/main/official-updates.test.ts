import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { firstKeyOf, OFFICIAL_PINS, type SuccessionStatement } from "@tavora/module-schema";
import { fingerprint, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { beforeEach, describe, expect, it } from "vitest";
import { backupData } from "./backup";
import { CatalogUpdater, findUpdates } from "./catalog-updates";
import type { CatalogEntry } from "./catalog-client";
import { copyRoots } from "./cloud-copy";
import { checkZipData, installZipData, readOwnerRecords, type InstallOptions } from "./installer";
import { loadInstalledModules } from "./installed-modules";
import { OFFICIAL_UPDATES_DIR, OFFICIAL_UPDATES_FILE, OfficialUpdates, readOfficialRecords, resolveOfficialPins, type OfficialSafety } from "./official-updates";
import { GrantStore } from "./grants";
import { ModuleLifecycle } from "./module-lifecycle";
import { discoverModules, type InstalledModule } from "./registry";

const TAVORA = "0.30.0";
const ACCOUNT = "account-tavora";
const tavoraKey = generateKeyPairSync("ed25519").privateKey;
const PINNED = fingerprint(tavoraKey);
const sha = (zip: Buffer) => createHash("sha256").update(zip).digest("hex");

const manifest = (id: string, version: string, extra: object = {}) => ({
  id,
  name: "Notes",
  version,
  apiVersion: "1",
  entry: "dist/index.html",
  games: [],
  viewport: { minWidth: 100, minHeight: 100 },
  permissions: { network: [] },
  ...extra,
});

function files(id: string, version: string, extra: object = { minTavora: "0.23.0" }, page = `<p>${version}</p>`): ZipFile[] {
  return [
    { name: "tavora.module.json", data: Buffer.from(JSON.stringify(manifest(id, version, extra))) },
    { name: "dist/index.html", data: Buffer.from(page) },
  ];
}

function zipOf(id: string, version: string, key: KeyObject | null = tavoraKey, extra?: object, page?: string): Buffer {
  const set = files(id, version, extra, page);
  return writeZip(key ? [...set, signFiles(set, key)] : set);
}

interface Lists {
  blocked: string[];
  revoked: { fingerprint: string; allow: string[] }[];
  successions: SuccessionStatement[];
}

function safetyOf(lists: Lists): OfficialSafety {
  return {
    blocked: (hash) => (lists.blocked.includes(hash) ? { sha256: hash, reason: "bad" } : null),
    revoked: (key, hash) => {
      const found = lists.revoked.find((entry) => entry.fingerprint === key);
      return found !== undefined && !found.allow.includes(hash);
    },
    firstKeyChain: (key) => firstKeyOf(lists.successions, key),
  };
}

let userData: string;
let shipped: string;
let lists: Lists;

beforeEach(async () => {
  userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-official-")));
  shipped = path.join(userData, "shipped");
  lists = { blocked: [], revoked: [], successions: [] };
  await shipModule("tavora.notes", "1.0.0");
});

/** A module as it ships in the app: a folder in the official modules folder. */
async function shipModule(id: string, version: string): Promise<void> {
  const root = path.join(shipped, id.replace("tavora.", ""));
  await rm(root, { recursive: true, force: true });
  for (const file of files(id, version, {})) {
    await mkdir(path.dirname(path.join(root, file.name)), { recursive: true });
    await writeFile(path.join(root, file.name), file.data);
  }
}

const officialOf = (pins = { key: PINNED, account: ACCOUNT }) => new OfficialUpdates({ userData, pins, safety: safetyOf(lists) });

async function load(official: OfficialUpdates) {
  return loadInstalledModules({ userData, userModules: path.join(userData, "modules"), sources: { official: [shipped] }, tavoraVersion: TAVORA, safety: { blocked: () => null }, official });
}

async function installOptions(official: OfficialUpdates, zip: Buffer, id = "tavora.notes"): Promise<InstallOptions> {
  const loaded = await load(official);
  return {
    userData,
    userModules: path.join(userData, "modules"),
    modules: loaded.modules,
    tavoraVersion: TAVORA,
    safety: { blocked: (hash) => (lists.blocked.includes(hash) ? { sha256: hash, reason: "bad" } : null), revoked: (key, hash) => safetyOf(lists).revoked(key, hash), firstKey: (key) => firstKeyOf(lists.successions, key).key },
    expect: { id, owner: fingerprint(tavoraKey) },
    catalog: true,
    official,
  };
}

async function install(official: OfficialUpdates, zip: Buffer, signer = PINNED) {
  const options = await installOptions(official, zip);
  return installZipData(zip, { ...options, expect: { id: "tavora.notes", owner: signer } });
}

async function running(official: OfficialUpdates, id = "tavora.notes") {
  return (await load(official)).modules.get(id)!;
}

describe("the official install path", () => {
  it("installs a newer copy signed by the pinned key, into official-updates, and records its high-water mark", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0");
    const installed = await install(official, zip);
    expect(installed).toMatchObject({ owner: "official", updated: true });
    expect(await readFile(path.join(userData, OFFICIAL_UPDATES_DIR, "tavora.notes", "dist", "index.html"), "utf8")).toBe("<p>1.1.0</p>");
    expect(await readOfficialRecords(userData)).toEqual({ "tavora.notes": { id: "tavora.notes", version: "1.1.0", sha256: sha(zip), signer: PINNED, highWater: "1.1.0" } });
    // Not an installed-from-zip module: the owner records and the user's modules folder are untouched.
    expect(await readOwnerRecords(userData)).toEqual({});
    expect(await readdir(path.join(userData, "module-staging"))).toEqual([]);
    const module = await running(official);
    expect(module).toMatchObject({ provenance: "official", owner: "official", downloaded: true, shippedVersion: "1.0.0" });
    expect(module.manifest.version).toBe("1.1.0");
  });

  it("takes a later update over the first, and a succession key of the pinned account", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    const next = generateKeyPairSync("ed25519").privateKey;
    lists.successions.push({ old: PINNED, new: fingerprint(next), account: ACCOUNT });
    await install(official, zipOf("tavora.notes", "1.2.0", next), fingerprint(next));
    expect((await running(official)).manifest.version).toBe("1.2.0");
  });

  it("refuses a signer that is not the pinned key, or whose chain names another account", async () => {
    const official = officialOf();
    const other = generateKeyPairSync("ed25519").privateKey;
    await expect(install(official, zipOf("tavora.notes", "1.1.0", other), fingerprint(other))).rejects.toMatchObject({ key: "error.installRefused" });
    lists.successions.push({ old: PINNED, new: fingerprint(other), account: "someone-else" });
    await expect(install(official, zipOf("tavora.notes", "1.1.0", other), fingerprint(other))).rejects.toMatchObject({ key: "error.installRefused" });
    await expect(install(official, zipOf("tavora.notes", "1.1.0", null), "local")).rejects.toMatchObject({ key: "error.installRefused" });
  });

  it("refuses a revoked signer, a blocked zip, and one without minTavora", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0");
    lists.revoked.push({ fingerprint: PINNED, allow: [] });
    await expect(install(official, zip)).rejects.toMatchObject({ key: "error.installRefused" });
    lists.revoked = [{ fingerprint: PINNED, allow: [sha(zip)] }];
    await expect(install(official, zip)).resolves.toBeDefined();
    lists.blocked.push(sha(zipOf("tavora.notes", "1.2.0")));
    await expect(install(official, zipOf("tavora.notes", "1.2.0"))).rejects.toMatchObject({ key: "error.installBlocked" });
    await expect(install(official, zipOf("tavora.notes", "1.3.0", tavoraKey, {}))).rejects.toMatchObject({ key: "error.installRefused" });
  });

  it("refuses an id that does not ship, one that moved to the catalog, and a version that is not newer", async () => {
    const official = officialOf();
    await shipModule("tavora.discord", "1.0.0");
    const options = await installOptions(official, Buffer.alloc(0));
    for (const id of ["tavora.unknown", "tavora.discord"]) {
      const zip = zipOf(id, "2.0.0");
      await expect(installZipData(zip, { ...options, expect: { id, owner: PINNED } })).rejects.toMatchObject({ key: "error.installRefused" });
    }
    await expect(install(official, zipOf("tavora.notes", "1.0.0"))).rejects.toMatchObject({ key: "error.installNotNewer" });
    await expect(install(official, zipOf("tavora.notes", "1.1.0-beta.1"))).rejects.toMatchObject({ key: "error.installRefused" });
  });

  it("never goes back below the high-water mark, also after the copy was removed", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.2.0"));
    await expect(install(official, zipOf("tavora.notes", "1.1.0"))).rejects.toMatchObject({ key: "error.installNotNewer" });
    await rm(path.join(userData, OFFICIAL_UPDATES_DIR, "tavora.notes"), { recursive: true });
    await official.load();
    expect((await running(official)).downloaded).toBeUndefined();
    await expect(install(official, zipOf("tavora.notes", "1.2.0"))).rejects.toMatchObject({ key: "error.installNotNewer" });
    await expect(install(official, zipOf("tavora.notes", "1.3.0"))).resolves.toBeDefined();
  });

  it("does nothing without pins, and Install from zip still refuses tavora.* ids", async () => {
    const off = officialOf({ key: "", account: "" });
    await expect(install(off, zipOf("tavora.notes", "1.1.0"))).rejects.toMatchObject({ key: "error.installRefused" });
    const options = await installOptions(off, Buffer.alloc(0));
    const { official: _unused, ...plain } = options;
    await expect(checkZipData(zipOf("tavora.notes", "1.1.0"), plain)).rejects.toMatchObject({ key: "error.installRefused" });
    // The official path takes no community zip either.
    const on = officialOf();
    const community = await installOptions(on, Buffer.alloc(0));
    await expect(checkZipData(zipOf("wellbrained.tracker", "1.0.0"), { ...community, expect: { id: "wellbrained.tracker", owner: PINNED } })).rejects.toMatchObject({ key: "error.installRefused" });
  });
});

describe("the load-time check", () => {
  const copy = () => path.join(userData, OFFICIAL_UPDATES_DIR, "tavora.notes");

  it("uses the shipped copy when a file of the downloaded one was changed", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    await writeFile(path.join(copy(), "dist", "index.html"), "<script>evil()</script>");
    const module = await running(official);
    expect(module.downloaded).toBeUndefined();
    expect(module.manifest.version).toBe("1.0.0");
  });

  it("uses the shipped copy when a file was added, a link dropped in, or the signature file removed", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    await writeFile(path.join(copy(), "extra.js"), "x");
    expect((await running(official)).downloaded).toBeUndefined();
    await rm(path.join(copy(), "extra.js"));
    expect((await running(official)).downloaded).toBe(true);
    await symlink(path.join(userData, "shipped"), path.join(copy(), "link"));
    expect((await running(official)).downloaded).toBeUndefined();
    await rm(path.join(copy(), "link"));
    await rm(path.join(copy(), "tavora.signature.json"));
    expect((await running(official)).downloaded).toBeUndefined();
  });

  it("drops a folder signed by another key, even with a record naming that key", async () => {
    const official = officialOf();
    const other = generateKeyPairSync("ed25519").privateKey;
    const zip = zipOf("tavora.notes", "1.1.0", other);
    await mkdir(path.dirname(copy()), { recursive: true });
    for (const file of [...files("tavora.notes", "1.1.0"), signFiles(files("tavora.notes", "1.1.0"), other)]) {
      await mkdir(path.dirname(path.join(copy(), file.name)), { recursive: true });
      await writeFile(path.join(copy(), file.name), file.data);
    }
    await writeFile(
      path.join(userData, OFFICIAL_UPDATES_FILE),
      JSON.stringify({ version: 1, modules: { "tavora.notes": { id: "tavora.notes", version: "1.1.0", sha256: sha(zip), signer: fingerprint(other), highWater: "1.1.0" } } }),
    );
    expect((await running(official)).downloaded).toBeUndefined();
  });

  it("drops an unsigned folder dropped in by hand, with or without a record", async () => {
    const official = officialOf();
    for (const file of files("tavora.notes", "9.0.0")) {
      await mkdir(path.dirname(path.join(copy(), file.name)), { recursive: true });
      await writeFile(path.join(copy(), file.name), file.data);
    }
    expect((await running(official)).manifest.version).toBe("1.0.0");
    await writeFile(
      path.join(userData, OFFICIAL_UPDATES_FILE),
      JSON.stringify({ version: 1, modules: { "tavora.notes": { id: "tavora.notes", version: "9.0.0", sha256: "a".repeat(64), signer: PINNED, highWater: "9.0.0" } } }),
    );
    expect((await running(official)).manifest.version).toBe("1.0.0");
  });

  it("falls back when the signer is revoked or the zip is blocked later, and when the pins are empty", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0");
    await install(official, zip);
    expect((await running(official)).downloaded).toBe(true);
    lists.blocked.push(sha(zip));
    expect((await running(official)).downloaded).toBeUndefined();
    // Blocked: the copy is gone for good (cleanup), and the same version is not taken again.
    lists.blocked = [];
    await install(official, zipOf("tavora.notes", "1.2.0"));
    expect((await running(official)).downloaded).toBe(true);
    lists.revoked.push({ fingerprint: PINNED, allow: [] });
    expect((await running(official)).downloaded).toBeUndefined();
    lists.revoked = [];
    expect((await running(officialOf({ key: "", account: "" }))).downloaded).toBeUndefined();
  });

  it("stays on the shipped copy when the app already ships the same or a newer version", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    await shipModule("tavora.notes", "1.1.0");
    expect((await running(official)).downloaded).toBeUndefined();
    expect((await running(official)).manifest.version).toBe("1.1.0");
  });

  it("uses the shipped copy when the record names a version below its high-water mark", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    const file = path.join(userData, OFFICIAL_UPDATES_FILE);
    const saved = JSON.parse(await readFile(file, "utf8"));
    saved.modules["tavora.notes"].highWater = "1.2.0";
    await writeFile(file, JSON.stringify(saved));
    expect((await running(official)).manifest.version).toBe("1.0.0");
  });

  it("does not read the folder again while nothing in it changed", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    expect((await running(official)).downloaded).toBe(true);
    // Same size and mtime would be needed to fool the stamp; a rewrite changes the mtime, so it is checked again.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(path.join(copy(), "dist", "index.html"), "<p>1.1.0</p>");
    expect((await running(official)).downloaded).toBe(true);
  });
});

describe("cleanup at start", () => {
  const copy = () => path.join(userData, OFFICIAL_UPDATES_DIR, "tavora.notes");
  const exists = (target: string) => readdir(target).then(() => true, () => false);

  it("removes the copy once the shipped one is equal or newer, and keeps the high-water mark", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    await load(official);
    expect(await exists(copy())).toBe(true);
    await shipModule("tavora.notes", "1.1.0");
    await load(official);
    expect(await exists(copy())).toBe(false);
    expect((await readOfficialRecords(userData))["tavora.notes"]?.highWater).toBe("1.1.0");
    await expect(install(official, zipOf("tavora.notes", "1.1.0"))).rejects.toMatchObject({ key: "error.installNotNewer" });
  });

  it("removes the copy of an id the app no longer ships, and of a blocked or revoked zip", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0");
    await install(official, zip);
    lists.blocked.push(sha(zip));
    await load(official);
    expect(await exists(copy())).toBe(false);

    lists.blocked = [];
    await install(official, zipOf("tavora.notes", "1.2.0"));
    lists.revoked.push({ fingerprint: PINNED, allow: [] });
    await load(official);
    expect(await exists(copy())).toBe(false);

    lists.revoked = [];
    await install(official, zipOf("tavora.notes", "1.3.0"));
    await rm(path.join(shipped, "notes"), { recursive: true });
    await load(official);
    expect(await exists(copy())).toBe(false);
    expect((await readOfficialRecords(userData))["tavora.notes"]?.highWater).toBe("1.3.0");
  });

  it("keeps the copy of a shipped module that cannot load for a moment, and does nothing without pins", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    await rm(path.join(shipped, "notes", "dist"), { recursive: true });
    await load(official);
    expect(await exists(copy())).toBe(true);
    await load(officialOf({ key: "", account: "" }));
    expect(await exists(copy())).toBe(true);
  });

  it("does not touch grants: it only removes the folder", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    await writeFile(path.join(userData, "grants.json"), "{}");
    await shipModule("tavora.notes", "2.0.0");
    await load(official);
    expect(await readFile(path.join(userData, "grants.json"), "utf8")).toBe("{}");
  });

  it("leaves a copy alone while it is being installed, before its record is saved", async () => {
    const official = officialOf();
    await official.install("tavora.notes", async () => {
      await mkdir(copy(), { recursive: true });
      await official.cleanup(new Map([["tavora.notes", "1.0.0"]]));
      expect(await exists(copy())).toBe(true);
    });
    await official.cleanup(new Map([["tavora.notes", "1.0.0"]]));
    expect(await exists(copy())).toBe(false);
  });

  it("keeps every record when two saves run at once", async () => {
    const official = officialOf();
    await Promise.all([
      official.save({ id: "tavora.notes", version: "1.1.0", sha256: "a".repeat(64), signer: PINNED }),
      official.save({ id: "tavora.files", version: "2.1.0", sha256: "b".repeat(64), signer: PINNED }),
    ]);
    expect(Object.keys(await readOfficialRecords(userData)).sort()).toEqual(["tavora.files", "tavora.notes"]);
  });
});

describe("the registry", () => {
  it("takes the newest trusted version and keeps both official, with the shipped version known", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    const modules = await discoverModules({ official: [shipped], officialUpdates: { dir: official.dir, trusted: (id, dir) => official.trusted(id, dir) }, tavoraVersion: TAVORA });
    expect(modules.get("tavora.notes")).toMatchObject({ provenance: "official", owner: "official", shippedVersion: "1.0.0", downloaded: true });
    expect(modules.get("tavora.notes")?.manifest.version).toBe("1.1.0");
  });

  it("ignores a downloaded id that does not ship, and one that needs a newer Tavora", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    const old = await discoverModules({ official: [shipped], officialUpdates: { dir: official.dir, trusted: () => Promise.resolve(true) }, tavoraVersion: "0.20.0" });
    // minTavora 0.23.0 is not met by 0.20.0: the shipped copy runs.
    expect(old.get("tavora.notes")?.manifest.version).toBe("1.0.0");
    const none = await discoverModules({ official: [], officialUpdates: { dir: official.dir, trusted: () => Promise.resolve(true) }, tavoraVersion: TAVORA });
    expect(none.size).toBe(0);
  });

  it("gives the downloaded copy the rights of the shipped one (WebAssembly)", async () => {
    const official = officialOf();
    const set = files("tavora.notes", "1.1.0", { minTavora: "0.23.0", permissions: { network: [], webAssembly: true } });
    const zip = writeZip([...set, signFiles(set, tavoraKey)]);
    await install(official, zip);
    const module = await running(official);
    expect(module.downloaded).toBe(true);
    expect(module.manifest.permissions.webAssembly).toBe(true);
    expect(module.provenance).toBe("official");
  });
});

describe("the update check", () => {
  const entry = (version: string, owner = PINNED, hash = "b".repeat(64)): CatalogEntry => ({ id: "tavora.notes", name: "Notes", version, minTavora: "0.23.0", owner, zip: { sha256: hash, size: 1 }, notes: [] }) as unknown as CatalogEntry;
  const installed = [{ id: "tavora.notes", owner: "official", version: "1.0.0", asks: { network: [], connectors: [] }, official: true as const }];

  it("counts a shipped official module when a trusted Tavora key signed the newer listing", () => {
    const trusted = (key: string) => key === PINNED;
    expect(findUpdates([entry("1.1.0")], installed, TAVORA, undefined, trusted)).toHaveLength(1);
    expect(findUpdates([entry("1.1.0", "f".repeat(32))], installed, TAVORA, undefined, trusted)).toHaveLength(0);
    expect(findUpdates([entry("1.0.0")], installed, TAVORA, undefined, trusted)).toHaveLength(0);
    // Without a signer rule no official listing counts, and a community owner match never applies to it.
    expect(findUpdates([entry("1.1.0")], installed, TAVORA)).toHaveLength(0);
    expect(findUpdates([entry("1.1.0", "official")], installed, TAVORA, undefined, trusted)).toHaveLength(0);
  });

  it("asks the index with ?include=official only when Tavora's own modules are on, then installs through the official path", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0");
    const asked: (boolean | undefined)[] = [];
    const updater = new CatalogUpdater({
      client: {
        index: async (options) => {
          asked.push(options?.official);
          return [entry("1.1.0", PINNED, sha(zip))];
        },
        details: async () => ({ entry: entry("1.1.0"), versions: [], readme: null }),
        download: async () => zip,
      },
      installed: () => installed,
      autoInstall: () => true,
      tavoraVersion: TAVORA,
      officialSigner: (key, hash) => official.signerTrusted(key, hash),
      official: () => official.on,
      check: async (bytes, expect) => checkZipData(bytes, { ...(await installOptions(official, bytes)), expect }),
      install: async (bytes, expect) => installZipData(bytes, { ...(await installOptions(official, bytes)), expect, catalog: true }),
    });
    const outcome = await updater.check();
    expect(asked).toEqual([true]);
    expect(outcome.updated).toHaveLength(1);
    expect((await running(official)).manifest.version).toBe("1.1.0");
    // The next check finds nothing newer.
    expect((await updater.check()).updated).toHaveLength(0);
  });

  it("waits for the user when the update asks for a new network host (no grant bypass)", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0", tavoraKey, { minTavora: "0.23.0", permissions: { network: ["api.example.com"] } });
    const updater = new CatalogUpdater({
      client: { index: async () => [entry("1.1.0", PINNED, sha(zip))], details: async () => ({ entry: entry("1.1.0"), versions: [], readme: null }), download: async () => zip },
      installed: () => installed,
      autoInstall: () => true,
      tavoraVersion: TAVORA,
      officialSigner: (key, hash) => official.signerTrusted(key, hash),
      official: () => official.on,
      check: async (bytes, expect) => checkZipData(bytes, { ...(await installOptions(official, bytes)), expect }),
      install: async (bytes, expect) => installZipData(bytes, { ...(await installOptions(official, bytes)), expect, catalog: true }),
    });
    const outcome = await updater.check();
    expect(outcome.updated).toHaveLength(0);
    expect(outcome.waiting[0]?.asks.network).toEqual(["api.example.com"]);
    expect((await running(official)).manifest.version).toBe("1.0.0");
  });
});

describe("backup and cloud copy", () => {
  it("leave the downloaded copies and their records out", async () => {
    const official = officialOf();
    await install(official, zipOf("tavora.notes", "1.1.0"));
    await mkdir(path.join(userData, "module-data", "official"), { recursive: true });
    await writeFile(path.join(userData, "library.json"), '{"version":1}');
    const result = await backupData({ userData, now: new Date(2026, 9, 30, 12) });
    expect(result.status).toBe("made");
    const names = await readdir(path.join(userData, "backups", "2026-10-30"));
    expect(names).not.toContain(OFFICIAL_UPDATES_DIR);
    expect(names).not.toContain(OFFICIAL_UPDATES_FILE);
    const roots = copyRoots(userData, path.join(userData, "module-blobs")).flatMap((root) => [root.name, root.path]);
    expect(roots.join("\n")).not.toContain("official-updates");
  });
});

describe("the pins", () => {
  it("come from the build when packaged, and from the environment only in a development run", () => {
    expect(resolveOfficialPins(true, { TAVORA_OFFICIAL_PINS: "a:b" })).toEqual(OFFICIAL_PINS);
    expect(resolveOfficialPins(false, { TAVORA_OFFICIAL_PINS: "a:b" })).toEqual({ key: "a", account: "b" });
    expect(resolveOfficialPins(false, {})).toEqual({ key: "", account: "" });
  });
});

describe("the module lifecycle", () => {
  async function lifecycleOver(official: OfficialUpdates, zip: Buffer) {
    const grants = await GrantStore.load(userData);
    let current = (await load(official)).modules;
    const steps: string[] = [];
    const safety = safetyOf(lists);
    const entry = { id: "tavora.notes", name: "Notes", version: "1.1.0", minTavora: "0.23.0", owner: PINNED, zip: { sha256: sha(zip), size: zip.length }, notes: [] } as unknown as CatalogEntry;
    const lifecycle = new ModuleLifecycle({
      userData,
      tavoraVersion: TAVORA,
      modules: () => current as ReadonlyMap<string, InstalledModule>,
      blocked: () => new Map(),
      catalogIds: () => new Set(),
      removable: () => false,
      installRules: async () => ({ userModules: path.join(userData, "modules"), safety: { blocked: safety.blocked, revoked: safety.revoked, firstKey: (key: string) => firstKeyOf([], key).key } }),
      grants: () => grants,
      catalog: {
        index: async () => [entry],
        details: async () => ({ entry, versions: [], readme: null }),
        download: async () => zip,
        module: async () => entry,
        installed: async () => undefined,
        updated: async () => undefined,
      },
      online: () => true,
      autoUpdateModules: () => true,
      firstKey: (key) => key,
      official,
      panels: { reload: (id) => steps.push(`reload ${id}`), close: (id) => steps.push(`close ${id}`) },
      trash: async () => undefined,
      reload: async () => {
        steps.push("reload modules");
        current = (await load(official)).modules;
      },
      introduce: async (owner) => void steps.push(`introduce ${owner}`),
    });
    return { lifecycle, steps, modules: () => current };
  }

  it("updates a shipped module through the catalogue updater and reloads its panels, without asking about a publisher", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0");
    const { lifecycle, steps, modules } = await lifecycleOver(official, zip);
    const outcome = await lifecycle.updates.check();
    expect(outcome.updated).toHaveLength(1);
    expect(steps).toEqual(["reload modules", "reload tavora.notes"]);
    expect(modules().get("tavora.notes")?.manifest.version).toBe("1.1.0");
    // The built-in module cannot be removed from Settings.
    await expect(lifecycle.remove("tavora.notes")).rejects.toMatchObject({ key: "error.removeOnlyOwn" });
  });

  it("keeps Install from zip and the catalogue install closed to tavora.* ids", async () => {
    const official = officialOf();
    const zip = zipOf("tavora.notes", "1.1.0");
    const { lifecycle } = await lifecycleOver(official, zip);
    const file = path.join(userData, "tavora-notes.zip");
    await writeFile(file, zip);
    await expect(lifecycle.installFile(file)).rejects.toMatchObject({ key: "error.installRefused" });
    await expect(lifecycle.installFromCatalog("tavora.notes")).rejects.toMatchObject({ key: "error.installRefused" });
    expect(await readdir(userData)).not.toContain(OFFICIAL_UPDATES_DIR);
  });

  it("does nothing while the pins are empty", async () => {
    const off = officialOf({ key: "", account: "" });
    const { lifecycle } = await lifecycleOver(off, zipOf("tavora.notes", "1.1.0"));
    expect(await lifecycle.updates.check()).toEqual({ updated: [], waiting: [] });
  });
});
