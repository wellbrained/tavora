import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, fingerprint, signCatalogList, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { installZip } from "./installer";
import { Installed, loadInstalledModules, MODULE_CHECKS_FILE, type InstalledModules } from "./installed-modules";
import type { InstalledModule } from "./registry";
import { BROWSER_MODULE_ID } from "./registry";
import { SafetyLists } from "./safety-lists";

const TAVORA = "0.18.0";
const catalogue = generateKeyPairSync("ed25519").privateKey;

const manifest = (id: string) =>
  JSON.stringify({ id, name: id, version: "1.0.0", apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } });

function zip(key: KeyObject, id: string): Buffer {
  const files: ZipFile[] = [
    { name: "tavora.module.json", data: Buffer.from(manifest(id)) },
    { name: "dist/index.html", data: Buffer.from("<p>hi</p>") },
  ];
  return writeZip([...files, signFiles(files, key)]);
}

async function setup() {
  const userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-installed-")));
  const userModules = path.join(userData, "modules");
  await mkdir(userModules);
  const safety = new SafetyLists({ file: path.join(userData, "catalog-lists.json"), baseUrl: "https://api.example.test/", publicKey: catalogPublicKey(catalogue), online: () => false });
  return { userData, userModules, safety };
}

async function install(userData: string, userModules: string, safety: SafetyLists, bytes: Buffer, catalog: boolean) {
  const file = path.join(userData, `pkg-${Math.random().toString(36).slice(2)}.zip`);
  await writeFile(file, bytes);
  await installZip(file, { userData, userModules, tavoraVersion: TAVORA, modules: new Map(), safety, catalog });
}

describe("loadInstalledModules", () => {
  it("knows which installed modules came from the catalog, the first time it runs", async () => {
    const { userData, userModules, safety } = await setup();
    const publisher = generateKeyPairSync("ed25519").privateKey;
    await install(userData, userModules, safety, zip(publisher, "wellbrained.tracker"), true);
    await install(userData, userModules, safety, zip(publisher, "wellbrained.notes"), false);

    const loaded = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });

    expect([...loaded.catalog]).toEqual(["wellbrained.tracker"]);
    expect(loaded.modules.has("wellbrained.tracker")).toBe(true);
    expect(loaded.modules.has("wellbrained.notes")).toBe(true);
    expect(loaded.modules.has(BROWSER_MODULE_ID)).toBe(true);
    expect(loaded.info.get("wellbrained.tracker")?.origin.kind).toBe("own");
  });

  it("stops a module whose files were changed by hand, says so, and takes its publisher's zip (same version too) as the repair", async () => {
    const { userData, userModules, safety } = await setup();
    const publisher = generateKeyPairSync("ed25519").privateKey;
    const bytes = zip(publisher, "wellbrained.tracker");
    await install(userData, userModules, safety, bytes, true);
    const before = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });
    expect(before.modules.get("wellbrained.tracker")?.owner).toBe(fingerprint(publisher));
    // The check is kept for the next start.
    expect(Object.keys(JSON.parse(await readFile(path.join(userData, MODULE_CHECKS_FILE), "utf8")).folders)).toHaveLength(1);

    await writeFile(path.join(userModules, "wellbrained.tracker", "dist", "index.html"), "<p>someone else's</p>");
    const loaded = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });
    // Not loaded at all (not as an unsigned folder either), so nothing writes data apart from the publisher's.
    expect(loaded.modules.has("wellbrained.tracker")).toBe(false);
    expect(loaded.blocked.get("wellbrained.tracker")).toMatchObject({ owner: fingerprint(publisher), changed: true });
    // Still the catalog's, so the catalog can repair it, and Settings > Modules says what happened; its panels wait.
    expect([...loaded.catalog]).toEqual(["wellbrained.tracker"]);
    expect(loaded.problems).toEqual([expect.objectContaining({ kind: "changed", values: { name: "wellbrained.tracker" }, about: { name: "wellbrained.tracker", version: "1.0.0", id: "wellbrained.tracker" } })]);

    // The publisher's zip, the same version, puts it right.
    const file = path.join(userData, "repair.zip");
    await writeFile(file, bytes);
    const repaired = await installZip(file, { userData, userModules, tavoraVersion: TAVORA, modules: new Map([...loaded.blocked, ...loaded.modules]), safety });
    expect(repaired).toMatchObject({ owner: fingerprint(publisher), updated: true });
    const again = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });
    expect(again.modules.get("wellbrained.tracker")?.owner).toBe(fingerprint(publisher));
    expect(again.problems).toEqual([]);
    // Another publisher's zip is no repair.
    await writeFile(path.join(userModules, "wellbrained.tracker", "dist", "index.html"), "<p>changed again</p>");
    const stopped = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });
    await writeFile(file, zip(generateKeyPairSync("ed25519").privateKey, "wellbrained.tracker"));
    await expect(installZip(file, { userData, userModules, tavoraVersion: TAVORA, modules: new Map([...stopped.blocked, ...stopped.modules]), safety })).rejects.toMatchObject({ key: "error.installOtherPublisher" });
  });

  it("still counts a blocked catalog module as one from the catalog", async () => {
    const { userData, userModules, safety } = await setup();
    const publisher = generateKeyPairSync("ed25519").privateKey;
    const bytes = zip(publisher, "wellbrained.tracker");
    await install(userData, userModules, safety, bytes, true);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(safety.accept("blocks", signCatalogList({ kind: "blocks", sequence: 1, issued: "2026-10-18T12:00:00Z", blocked: [{ sha256, reason: "Harmful." }] }, catalogue))).toBe(true);

    const loaded = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: TAVORA, safety });

    expect(loaded.modules.has("wellbrained.tracker")).toBe(false);
    expect([...loaded.blocked.keys()]).toEqual(["wellbrained.tracker"]);
    expect([...loaded.catalog]).toEqual(["wellbrained.tracker"]);
    expect(loaded.problems.map((problem) => problem.kind)).toEqual(["blocked"]);
  });
});

describe("Installed", () => {
  const module = (id: string) => ({ owner: "official", root: "/nowhere", provenance: "official", manifest: { id, name: id } }) as unknown as InstalledModule;
  const found = (...ids: string[]): InstalledModules => ({ modules: new Map(ids.map((id) => [id, module(id)])), blocked: new Map(), catalog: new Set(), info: new Map(), problems: [] });

  it("gives a module with its texts in the language now, and nothing for one that is not installed", () => {
    const installed = new Installed(found("tavora.notes"), (manifest) => ({ ...manifest, name: `de:${manifest.name}` }));
    expect(installed.shown("tavora.notes")?.manifest.name).toBe("de:tavora.notes");
    expect(installed.get("tavora.notes")?.manifest.name).toBe("tavora.notes");
    expect(installed.shown("tavora.todos")).toBeUndefined();
  });

  it("answers from what a reload found, for everyone who holds it", () => {
    const installed = new Installed(found("tavora.notes"), (manifest) => manifest);
    const holder: { shown(moduleId: string): unknown } = installed;
    installed.replace(found("tavora.todos"));
    expect(holder.shown("tavora.notes")).toBeUndefined();
    expect(holder.shown("tavora.todos")).toBeDefined();
    expect([...installed.modules.keys()]).toEqual(["tavora.todos"]);
  });
});
