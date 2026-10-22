import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { CatalogClient, type CatalogEntry, type CatalogVersion } from "./catalog-client";
import { CatalogUpdater, findUpdates, newAsks, notesSince, type CatalogInstalled } from "./catalog-updates";
import { checkZipData, installZipData, readOwnerRecords } from "./installer";
import type { InstalledModule } from "./registry";
import type { SafetyCheck } from "./safety-lists";

const TAVORA = "0.18.4";
const ID = "wellbrained.tracker";

function zipOf(version: string, key: KeyObject, network: string[] = [], page = `<p>${version}</p>`): Buffer {
  const files: ZipFile[] = [
    {
      name: "tavora.module.json",
      data: Buffer.from(JSON.stringify({ id: ID, name: "Tracker", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network } })),
    },
    { name: "dist/index.html", data: Buffer.from(page) },
  ];
  return writeZip([...files, signFiles(files, key)]);
}

function listing(version: string, zip: Buffer, owner: string, fields: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: ID,
    name: "Tracker",
    description: null,
    version,
    minTavora: null,
    games: [],
    workspaces: true,
    permissions: { network: [], connectors: [] },
    owner,
    publisher: null,
    size: zip.length,
    installs: 0,
    publishedAt: "",
    zip: { sha256: createHash("sha256").update(zip).digest("hex"), size: zip.length },
    notes: [],
    homepage: null,
    shots: [],
    rating: null,
    icon: null,
    ...fields,
  };
}

/** A player with Tracker 1.0.0 installed from the catalog, and an updater over a fake catalog. */
async function setup(key: KeyObject, network: string[] = [], safety?: SafetyCheck) {
  const userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-updates-")));
  const userModules = path.join(userData, "modules");
  await mkdir(userModules);
  const modules = new Map<string, InstalledModule>();
  const options = () => ({ userData, userModules, modules, tavoraVersion: TAVORA, ...(safety ? { safety } : {}) });
  const load = (installed: { manifest: InstalledModule["manifest"]; owner: string }) =>
    modules.set(ID, { manifest: installed.manifest, root: path.join(userModules, ID), provenance: "local", owner: installed.owner });
  load(await installZipData(zipOf("1.0.0", key, network), { ...options(), catalog: true }));

  const catalog: { index: CatalogEntry[]; zips: Map<string, Buffer>; versions: CatalogVersion[]; downloads: string[] } = { index: [], zips: new Map(), versions: [], downloads: [] };
  const publish = (entry: CatalogEntry, zip: Buffer) => {
    catalog.index = [entry];
    catalog.zips.set(entry.zip.sha256, zip);
  };
  const updater = new CatalogUpdater({
    client: {
      index: async () => catalog.index,
      details: async () => ({ entry: catalog.index[0]!, versions: catalog.versions, readme: null }),
      download: async (zip) => {
        catalog.downloads.push(zip.sha256);
        return catalog.zips.get(zip.sha256)!;
      },
    },
    installed: (): CatalogInstalled[] =>
      [...modules.values()].map((module) => ({ id: module.manifest.id, owner: module.owner, version: module.manifest.version, asks: { network: module.manifest.permissions.network, connectors: [] } })),
    tavoraVersion: TAVORA,
    ...(safety ? { firstKey: (fingerprint: string) => safety.firstKey(fingerprint) } : {}),
    check: (zip, expect) => checkZipData(zip, { ...options(), expect }),
    install: async (zip, expect) => {
      const installed = await installZipData(zip, { ...options(), expect, catalog: true });
      load(installed);
      return installed;
    },
  });
  const page = () => readFile(path.join(userModules, ID, "dist", "index.html"), "utf8");
  return { userData, userModules, modules, updater, publish, catalog, page };
}

describe("findUpdates", () => {
  const owner = "0123456789abcdef0123456789abcdef";
  const installed: CatalogInstalled[] = [{ id: ID, owner, version: "1.0.0", asks: { network: [], connectors: [] } }];
  const at = (version: string, fields: Partial<CatalogEntry> = {}) => listing(version, Buffer.from("zip"), owner, fields);

  it("takes only a newer version from the same owner", () => {
    expect(findUpdates([at("1.1.0")], installed, TAVORA).map((entry) => entry.version)).toEqual(["1.1.0"]);
    expect(findUpdates([at("1.0.0")], installed, TAVORA)).toEqual([]);
    expect(findUpdates([at("0.9.0")], installed, TAVORA)).toEqual([]);
    expect(findUpdates([at("1.0.0-beta.1")], installed, TAVORA)).toEqual([]);
    expect(findUpdates([at("2.0.0", { owner: "f".repeat(32) })], installed, TAVORA)).toEqual([]);
  });

  it("leaves out a version this Tavora cannot run, and modules that are not installed from the catalog", () => {
    expect(findUpdates([at("1.1.0", { minTavora: "0.19.0" })], installed, TAVORA)).toEqual([]);
    expect(findUpdates([at("1.1.0", { id: "wellbrained.other" })], installed, TAVORA)).toEqual([]);
  });
});

describe("newAsks", () => {
  it("is what the update asks for that the installed version did not", () => {
    expect(newAsks({ network: ["a.example.com"], connectors: [] }, { network: ["a.example.com", "b.example.com"], connectors: ["discord"] })).toEqual({
      network: ["b.example.com"],
      connectors: ["discord"],
    });
    expect(newAsks({ network: ["a.example.com"], connectors: ["discord"] }, { network: [] })).toEqual({ network: [], connectors: [] });
    // A connector asked for on request waits until the module needs it.
    expect(newAsks({ network: [], connectors: [] }, { network: [], connectors: ["stream-overlay"], onRequest: ["stream-overlay"] })).toEqual({ network: [], connectors: [] });
  });
});

describe("notesSince", () => {
  const versions: CatalogVersion[] = [
    { version: "1.3.0", publishedAt: "2026-10-18T10:00:00.000Z", notes: ["Three."] },
    { version: "1.2.0", publishedAt: "", notes: ["Two."] },
    { version: "1.1.0", publishedAt: "", notes: [] },
    { version: "1.0.0", publishedAt: "", notes: ["One."] },
  ];

  it("lists the versions after the installed one up to the update, newest first", () => {
    expect(notesSince(versions, "1.0.0", "1.2.0", [])).toEqual([{ version: "1.2.0", notes: ["Two."] }]);
    expect(notesSince(versions, "1.0.0", "1.3.0", []).map((note) => note.version)).toEqual(["1.3.0", "1.2.0"]);
    expect(notesSince(versions, "1.0.0", "1.3.0", [])[0]?.date).toBe("2026-10-18");
  });

  it("falls back to the listing's notes without a version list", () => {
    expect(notesSince([], "1.0.0", "1.3.0", ["Three."])).toEqual([{ version: "1.3.0", notes: ["Three."] }]);
    expect(notesSince([], "1.0.0", "1.3.0", [])).toEqual([]);
  });
});

describe("CatalogUpdater", () => {
  it("installs an update that asks for nothing new at once, and keeps it a catalog module (C3)", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const { userData, updater, publish, page } = await setup(key, ["api.example.com"]);
    const zip = zipOf("1.1.0", key, ["api.example.com"]);
    publish(listing("1.1.0", zip, fingerprint(key)), zip);
    const outcome = await updater.check();
    expect(outcome.updated.map((item) => item.manifest.version)).toEqual(["1.1.0"]);
    expect(outcome.waiting).toEqual([]);
    expect(await page()).toBe("<p>1.1.0</p>");
    expect((await readOwnerRecords(userData))[ID]).toEqual({ id: ID, owner: fingerprint(key), sha256: createHash("sha256").update(zip).digest("hex"), catalog: true });
  });

  it("refuses an older, the same and another key's version, and leaves the installed one as it is (C3)", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const stranger = generateKeyPairSync("ed25519").privateKey;
    const { updater, publish, catalog, page, userModules } = await setup(key);
    const owner = fingerprint(key);

    // Listed as older or the same: not even downloaded.
    for (const version of ["0.9.0", "1.0.0"]) {
      const zip = zipOf(version, key, [], "<p>replaced</p>");
      publish(listing(version, zip, owner), zip);
      expect(await updater.check()).toEqual({ updated: [], waiting: [] });
    }
    expect(catalog.downloads).toEqual([]);

    // Listed as newer, but the zip itself is older or the same: the installer refuses it.
    for (const version of ["0.9.0", "1.0.0"]) {
      const zip = zipOf(version, key, [], "<p>replaced</p>");
      publish(listing("2.0.0", zip, owner), zip);
      expect(await updater.check()).toEqual({ updated: [], waiting: [] });
    }

    // Listed under the module's owner, but signed by another key.
    const foreign = zipOf("2.0.0", stranger, [], "<p>replaced</p>");
    publish(listing("2.0.0", foreign, owner), foreign);
    expect(await updater.check()).toEqual({ updated: [], waiting: [] });
    // Listed under another key altogether: not an update of this module.
    publish(listing("2.0.0", foreign, fingerprint(stranger)), foreign);
    expect(await updater.check()).toEqual({ updated: [], waiting: [] });

    expect(catalog.downloads).toHaveLength(3);
    expect(await page()).toBe("<p>1.0.0</p>");
    expect(await readdir(userModules)).toEqual([ID]);
  });

  it("keeps an update that asks for a new network host waiting, with nothing written, until the player says yes (C4)", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const { updater, publish, catalog, page, modules } = await setup(key);
    const zip = zipOf("1.1.0", key, ["api.example.com"]);
    publish(listing("1.1.0", zip, fingerprint(key), { notes: ["Reads your runs from api.example.com."] }), zip);
    catalog.versions = [{ version: "1.1.0", publishedAt: "", notes: ["Reads your runs from api.example.com."] }];

    const outcome = await updater.check();
    expect(outcome.updated).toEqual([]);
    expect(outcome.waiting.map(({ version, from, asks, notes }) => ({ version, from, asks, notes }))).toEqual([
      { version: "1.1.0", from: "1.0.0", asks: { network: ["api.example.com"], connectors: [] }, notes: [{ version: "1.1.0", notes: ["Reads your runs from api.example.com."] }] },
    ]);
    expect(await page()).toBe("<p>1.0.0</p>");
    expect(modules.get(ID)?.manifest.version).toBe("1.0.0");

    // Asked again, it is not downloaded again.
    await updater.check();
    expect(catalog.downloads).toHaveLength(1);

    // Only the version the player was shown is installed.
    await expect(updater.apply(ID, "1.2.0")).rejects.toThrow();
    const { installed, asks } = await updater.apply(ID, "1.1.0");
    expect(installed.manifest.version).toBe("1.1.0");
    expect(asks).toEqual({ network: ["api.example.com"], connectors: [] });
    expect(await page()).toBe("<p>1.1.0</p>");
    expect(updater.pending(ID)).toBeUndefined();
  });

  it("goes through the safety lists: a blocked zip and a revoked key are refused, a successor key's update is taken (C6, C7, C14)", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const successor = generateKeyPairSync("ed25519").privateKey;
    const lists = { blockedHash: "", revokedKey: "" };
    const safety: SafetyCheck = {
      blocked: (sha256) => (sha256 === lists.blockedHash ? { sha256, reason: "harmful" } : null) as ReturnType<SafetyCheck["blocked"]>,
      revoked: (fingerprintOf) => fingerprintOf === lists.revokedKey,
      firstKey: (fingerprintOf) => (fingerprintOf === fingerprint(successor) ? fingerprint(key) : fingerprintOf),
    };
    const { updater, publish, page } = await setup(key, [], safety);

    const blocked = zipOf("1.1.0", key);
    lists.blockedHash = createHash("sha256").update(blocked).digest("hex");
    publish(listing("1.1.0", blocked, fingerprint(key)), blocked);
    expect(await updater.check()).toEqual({ updated: [], waiting: [] });

    const revoked = zipOf("1.2.0", key);
    lists.revokedKey = fingerprint(key);
    publish(listing("1.2.0", revoked, fingerprint(key)), revoked);
    expect(await updater.check()).toEqual({ updated: [], waiting: [] });
    expect(await page()).toBe("<p>1.0.0</p>");

    // The account moved to a new key by a signed succession: its update keeps the module's data owner.
    const moved = zipOf("1.3.0", successor);
    publish(listing("1.3.0", moved, fingerprint(successor)), moved);
    const outcome = await updater.check();
    expect(outcome.updated.map((item) => ({ version: item.manifest.version, owner: item.owner }))).toEqual([{ version: "1.3.0", owner: fingerprint(key) }]);
    expect(await page()).toBe("<p>1.3.0</p>");
  });

  it("drops a waiting update once the module is gone", async () => {
    const key = generateKeyPairSync("ed25519").privateKey;
    const { updater, publish, modules } = await setup(key);
    const zip = zipOf("1.1.0", key, ["api.example.com"]);
    publish(listing("1.1.0", zip, fingerprint(key)), zip);
    await updater.check();
    expect(updater.pending(ID)?.version).toBe("1.1.0");
    modules.clear();
    await updater.check();
    expect(updater.pending(ID)).toBeUndefined();
  });
});

describe("CatalogClient.index", () => {
  it("asks for the whole catalog without sending any module id (C11)", async () => {
    const urls: string[] = [];
    const client = new CatalogClient({
      baseUrl: "https://api.example.com",
      fetchImpl: (async (input: string | URL | Request) => {
        urls.push(String(input));
        return new Response(JSON.stringify({ modules: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch,
    });
    expect(await client.index()).toEqual([]);
    expect(urls).toEqual(["https://api.example.com/v1/catalog"]);
  });

  it("gives nothing when the service has no usable answer", async () => {
    const client = new CatalogClient({ fetchImpl: (async () => new Response("busy", { status: 429 })) as typeof fetch });
    expect(await client.index()).toBeNull();
  });
});
