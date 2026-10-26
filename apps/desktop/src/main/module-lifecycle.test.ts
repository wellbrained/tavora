import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./catalog-client";
import { GrantStore } from "./grants";
import { applyOwners, readOwnerRecords } from "./installer";
import { ModuleLifecycle } from "./module-lifecycle";
import { discoverModules, type InstalledModule } from "./registry";

const TAVORA = "0.19.0";
const ID = "wellbrained.tracker";

function zipOf(version: string, key: KeyObject | null, network: string[] = []): Buffer {
  const files: ZipFile[] = [
    {
      name: "tavora.module.json",
      data: Buffer.from(JSON.stringify({ id: ID, name: "Tracker", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network } })),
    },
    { name: "dist/index.html", data: Buffer.from(`<p>${version}</p>`) },
  ];
  return writeZip(key ? [...files, signFiles(files, key)] : files);
}

function listing(version: string, zip: Buffer, owner: string): CatalogEntry {
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
    support: null,
    shots: [],
    rating: null,
    icon: null,
    translations: {},
  };
}

/**
 * A lifecycle over a real modules folder, owner records and grants, with the host's side faked: what
 * happened to panels, the bin and the module list is written to `steps`, in order.
 */
async function setup() {
  const userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-lifecycle-")));
  const userModules = path.join(userData, "modules");
  await mkdir(userModules);
  const grants = await GrantStore.load(userData);
  const steps: string[] = [];
  let modules = new Map<string, InstalledModule>();
  let catalogIds = new Set<string>();
  const catalog = { index: [] as CatalogEntry[], zips: new Map<string, Buffer>() };
  const counted: string[] = [];
  const state = { online: true, binFails: false, onClose: (_moduleId: string) => {}, grantChanges: 0 };
  const publish = (entry: CatalogEntry, zip: Buffer) => {
    catalog.index = [entry];
    catalog.zips.set(entry.zip.sha256, zip);
  };
  const lifecycle = new ModuleLifecycle({
    userData,
    tavoraVersion: TAVORA,
    modules: () => modules,
    blocked: () => new Map(),
    catalogIds: () => catalogIds,
    removable: (moduleId) => modules.get(moduleId)?.provenance === "local",
    installRules: async () => ({ userModules }),
    grants: () => grants,
    catalog: {
      index: async () => catalog.index,
      details: async () => ({ entry: catalog.index[0]!, versions: [], readme: null }),
      module: async (id) => {
        const entry = catalog.index.find((item) => item.id === id);
        if (!entry) throw new Error("not listed");
        return entry;
      },
      download: async (zip) => catalog.zips.get(zip.sha256)!,
      installed: async (id) => void counted.push(`install ${id}`),
      updated: async (id) => void counted.push(`update ${id}`),
    },
    online: () => state.online,
    grantsChanged: () => void state.grantChanges++,
    autoUpdateModules: () => true,
    firstKey: (key) => key,
    panels: {
      reload: (moduleId) => steps.push(`reload panels ${moduleId}`),
      close: (moduleId) => {
        steps.push(`close panels ${moduleId}`);
        state.onClose(moduleId);
      },
    },
    trash: async (dir) => {
      if (state.binFails) throw new Error("busy");
      steps.push(`trash ${path.basename(dir)}`);
      await rm(dir, { recursive: true, force: true });
    },
    reload: async () => {
      steps.push("look for modules");
      const records = await readOwnerRecords(userData);
      modules = await discoverModules({ local: [userModules], tavoraVersion: TAVORA });
      applyOwners(modules, userModules, records);
      catalogIds = new Set([...modules.keys()].filter((id) => records[id]?.catalog && records[id]?.id === id));
    },
    introduce: async (owner) => void steps.push(`introduce ${owner}`),
  });
  const zipFile = async (zip: Buffer) => {
    const file = path.join(userData, `pkg-${Math.random().toString(36).slice(2)}.zip`);
    await writeFile(file, zip);
    return file;
  };
  return { counted, userData, userModules, grants, steps, lifecycle, publish, state, zipFile, modules: () => modules };
}

describe("ModuleLifecycle", () => {
  it("installs a picked zip, says its developer and loads it; panels reload only on an update", async () => {
    const { lifecycle, steps, zipFile } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    expect(await lifecycle.installFile(await zipFile(zipOf("1.0.0", key)))).toBe(ID);
    expect(steps).toEqual([`introduce ${fingerprint(key)}`, "look for modules"]);
    steps.length = 0;
    await lifecycle.installFile(await zipFile(zipOf("1.1.0", key)));
    expect(steps).toEqual([`introduce ${fingerprint(key)}`, "look for modules", `reload panels ${ID}`]);
  });

  it("does not ask for the developer of an unsigned module", async () => {
    const { lifecycle, steps, zipFile } = await setup();
    await lifecycle.installFile(await zipFile(zipOf("1.0.0", null)));
    expect(steps).toEqual(["look for modules"]);
  });

  it("removes a module: bin, panels, owner record, grants, waiting update, then the module list", async () => {
    const { lifecycle, steps, grants, userData, userModules, publish, zipFile, modules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const owner = fingerprint(key);
    publish(listing("1.0.0", zipOf("1.0.0", key), owner), zipOf("1.0.0", key));
    await lifecycle.installFromCatalog(ID);
    await grants.grant(modules().get(ID)!);
    const update = zipOf("2.0.0", key, ["api.example.com"]);
    publish(listing("2.0.0", update, owner), update);
    expect((await lifecycle.updates.check()).waiting).toHaveLength(1);
    steps.length = 0;

    await lifecycle.remove(ID);
    expect(steps).toEqual(["trash wellbrained.tracker", `close panels ${ID}`, "look for modules"]);
    expect(existsSync(path.join(userModules, ID))).toBe(false);
    expect(await readOwnerRecords(userData)).toEqual({});
    expect(grants.get(owner, ID)).toBeUndefined();
    expect(lifecycle.updates.pending(ID)).toBeUndefined();
    // Installed again, the module is asked again.
    await lifecycle.installFile(await zipFile(zipOf("1.0.0", key)));
    expect(grants.get(owner, ID)).toBeUndefined();
  });

  it("removes only modules the player may remove, and keeps everything when the bin fails", async () => {
    const { lifecycle, steps, state, zipFile } = await setup();
    await expect(lifecycle.remove(ID)).rejects.toMatchObject({ key: "error.removeOnlyOwn" });
    await lifecycle.installFile(await zipFile(zipOf("1.0.0", null)));
    steps.length = 0;
    state.binFails = true;
    await expect(lifecycle.remove(ID)).rejects.toMatchObject({ key: "error.removeFailed" });
    expect(steps).toEqual([]);
  });

  it("grants only what the module asks for and restarts its panels", async () => {
    const { lifecycle, steps, grants, zipFile } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    await lifecycle.installFile(await zipFile(zipOf("1.0.0", key, ["api.example.com"])));
    steps.length = 0;
    await lifecycle.grant(ID, ["api.example.com", "evil.example.com"], []);
    expect(grants.get(fingerprint(key), ID)).toMatchObject({ network: ["api.example.com"], connectors: [] });
    expect(steps).toEqual([`reload panels ${ID}`]);
    await expect(lifecycle.grant("someone.else", [], [])).rejects.toMatchObject({ key: "error.moduleMissing" });
  });

  it("closes a module's panels before taking back its grant", async () => {
    const { lifecycle, steps, grants, state, zipFile } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    await lifecycle.installFile(await zipFile(zipOf("1.0.0", key, ["api.example.com"])));
    await lifecycle.grant(ID, ["api.example.com"], []);
    steps.length = 0;
    let grantWhenClosed: unknown;
    state.onClose = () => (grantWhenClosed = grants.get(fingerprint(key), ID));
    await lifecycle.revoke(ID);
    expect(steps).toEqual([`close panels ${ID}`]);
    expect(grantWhenClosed).toBeDefined();
    expect(grants.get(fingerprint(key), ID)).toBeUndefined();
  });

  it("tells the host when a grant is taken back or given, so what runs on it can stop at once", async () => {
    const { lifecycle, state, zipFile } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    await lifecycle.installFile(await zipFile(zipOf("1.0.0", key, ["api.example.com"])));
    state.grantChanges = 0;
    await lifecycle.grant(ID, ["api.example.com"], []);
    expect(state.grantChanges).toBe(1);
    await lifecycle.revoke(ID);
    expect(state.grantChanges).toBe(2);
  });

  it("installs from the catalog only while online, and only the listed publisher's zip", async () => {
    const { lifecycle, publish, state, userModules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const other = generateKeyPairSync("ed25519").privateKey;
    const zip = zipOf("1.0.0", other);
    publish(listing("1.0.0", zip, fingerprint(key)), zip);
    state.online = false;
    await expect(lifecycle.installFromCatalog(ID)).rejects.toMatchObject({ key: "error.catalogOff" });
    state.online = true;
    await expect(lifecycle.installFromCatalog(ID)).rejects.toThrow();
    expect(existsSync(path.join(userModules, ID))).toBe(false);
  });

  it("a hand install drops the update the catalog was waiting with", async () => {
    const { lifecycle, publish, zipFile } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const owner = fingerprint(key);
    publish(listing("1.0.0", zipOf("1.0.0", key), owner), zipOf("1.0.0", key));
    await lifecycle.installFromCatalog(ID);
    const update = zipOf("2.0.0", key, ["api.example.com"]);
    publish(listing("2.0.0", update, owner), update);
    await lifecycle.updates.check();
    expect(lifecycle.updates.pending(ID)).toBeDefined();
    await lifecycle.installFile(await zipFile(zipOf("1.5.0", key)));
    expect(lifecycle.updates.pending(ID)).toBeUndefined();
  });

  it("applies a waiting update only at the version shown, then grants what it asked and restarts its panels", async () => {
    const { lifecycle, publish, steps, grants, modules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const owner = fingerprint(key);
    publish(listing("1.0.0", zipOf("1.0.0", key), owner), zipOf("1.0.0", key));
    await lifecycle.installFromCatalog(ID);
    const update = zipOf("2.0.0", key, ["api.example.com"]);
    publish(listing("2.0.0", update, owner), update);
    const { updated, waiting } = await lifecycle.updates.check();
    expect([updated.length, waiting.length]).toEqual([0, 1]);
    expect(grants.get(owner, ID)).toBeUndefined();

    await expect(lifecycle.applyUpdate(ID, "3.0.0")).rejects.toMatchObject({ key: "error.updateGone" });
    steps.length = 0;
    expect(await lifecycle.applyUpdate(ID, "2.0.0")).toBe(ID);
    expect(modules().get(ID)?.manifest.version).toBe("2.0.0");
    expect(grants.get(owner, ID)).toMatchObject({ version: "2.0.0", network: ["api.example.com"] });
    expect(steps).toEqual([`introduce ${owner}`, "look for modules", `reload panels ${ID}`, `reload panels ${ID}`]);
    expect(lifecycle.updates.pending(ID)).toBeUndefined();
  });

  it("installs an update that asks for nothing new during the check", async () => {
    const { lifecycle, publish, modules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const owner = fingerprint(key);
    publish(listing("1.0.0", zipOf("1.0.0", key), owner), zipOf("1.0.0", key));
    await lifecycle.installFromCatalog(ID);
    const update = zipOf("1.1.0", key);
    publish(listing("1.1.0", update, owner), update);
    const { updated } = await lifecycle.updates.check();
    expect(updated.map((item) => item.manifest.version)).toEqual(["1.1.0"]);
    expect(modules().get(ID)?.manifest.version).toBe("1.1.0");
  });

  it("tells the catalog an install and an update apart, and a zip picked by hand counts as neither", async () => {
    const { lifecycle, publish, counted, zipFile } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const owner = fingerprint(key);
    publish(listing("1.0.0", zipOf("1.0.0", key), owner), zipOf("1.0.0", key));
    await lifecycle.installFromCatalog(ID);
    expect(counted).toEqual([`install ${ID}`]);
    const update = zipOf("1.1.0", key);
    publish(listing("1.1.0", update, owner), update);
    await lifecycle.updates.check();
    expect(counted).toEqual([`install ${ID}`, `update ${ID}`]);
    await lifecycle.installFile(await zipFile(zipOf("1.2.0", key)));
    expect(counted).toHaveLength(2);
  });
});
