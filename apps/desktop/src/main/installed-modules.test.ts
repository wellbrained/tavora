import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { catalogPublicKey, signCatalogList, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { installZip } from "./installer";
import { loadInstalledModules } from "./installed-modules";
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
