import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { applyOwners, compareModuleVersions, forgetOwner, installZip, readOwnerRecords } from "./installer";
import type { InstalledModule } from "./registry";

/** The Tavora version the installer runs as in these tests. */
const TAVORA = "0.17.0";

const manifest = (id: string, version = "1.0.0") =>
  JSON.stringify({ id, name: "Tracker", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } });

function packageFiles(id: string, version = "1.0.0", page = "<p>hi</p>"): ZipFile[] {
  return [
    { name: "tavora.module.json", data: Buffer.from(manifest(id, version)) },
    { name: "dist/index.html", data: Buffer.from(page) },
  ];
}

async function setup() {
  const userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-install-")));
  const userModules = path.join(userData, "modules");
  await mkdir(userModules);
  return { userData, userModules };
}

async function zipFile(dir: string, files: ZipFile[]): Promise<string> {
  const file = path.join(dir, `pkg-${Math.random().toString(36).slice(2)}.zip`);
  await writeFile(file, writeZip(files));
  return file;
}

function loaded(id: string, root: string, owner: string, version = "1.0.0"): InstalledModule {
  return { manifest: JSON.parse(manifest(id, version)), root, provenance: "local", owner };
}

describe("installZip", () => {
  it("refuses a zip that needs a newer Tavora before unpacking anything, and says which", async () => {
    const { userData, userModules } = await setup();
    const files = packageFiles("example.tracker");
    files[0] = { name: "tavora.module.json", data: Buffer.from(JSON.stringify({ ...JSON.parse(manifest("example.tracker")), minTavora: "0.18.0" })) };
    const zip = await zipFile(userData, files);
    await expect(installZip(zip, { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({
      key: "error.installNeedsNewer",
      params: { name: "Tracker", needed: "0.18.0", current: "0.17.0" },
    });
    expect(await readdir(userModules)).toEqual([]);
    // The same zip installs on a Tavora that is new enough.
    const installed = await installZip(zip, { userData, userModules, tavoraVersion: "0.18.0", modules: new Map() });
    expect(installed.manifest.minTavora).toBe("0.18.0");
  });

  it("installs a signed zip into a folder named after its id and records its owner", async () => {
    const { userData, userModules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const files = packageFiles("wellbrained.tracker");
    const installed = await installZip(await zipFile(userData, [...files, signFiles(files, key)]), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    expect(installed).toMatchObject({ owner: fingerprint(key), updated: false });
    expect(await readFile(path.join(userModules, "wellbrained.tracker", "dist", "index.html"), "utf8")).toBe("<p>hi</p>");
    expect(await readOwnerRecords(userData)).toEqual({ "wellbrained.tracker": { id: "wellbrained.tracker", owner: fingerprint(key) } });
    // Nothing is left half-way.
    expect(await readdir(path.join(userData, "module-staging"))).toEqual([]);
  });

  it("installs an unsigned zip as local", async () => {
    const { userData, userModules } = await setup();
    const installed = await installZip(await zipFile(userData, packageFiles("wellbrained.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    expect(installed.owner).toBe("local");
    expect(await readOwnerRecords(userData)).toEqual({});
  });

  it("updates only from the same publisher (S5)", async () => {
    const { userData, userModules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const first = packageFiles("wellbrained.tracker");
    await installZip(await zipFile(userData, [...first, signFiles(first, key)]), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    const root = path.join(userModules, "wellbrained.tracker");
    const modules = new Map([["wellbrained.tracker", loaded("wellbrained.tracker", root, fingerprint(key))]]);

    const next = packageFiles("wellbrained.tracker", "1.1.0", "<p>new</p>");
    const updated = await installZip(await zipFile(userData, [...next, signFiles(next, key)]), { userData, userModules, tavoraVersion: TAVORA, modules });
    expect(updated.updated).toBe(true);
    expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toBe("<p>new</p>");

    const other = generateKeyPairSync("ed25519").privateKey;
    const copycat = packageFiles("wellbrained.tracker", "9.0.0", "<p>evil</p>");
    await expect(installZip(await zipFile(userData, [...copycat, signFiles(copycat, other)]), { userData, userModules, tavoraVersion: TAVORA, modules })).rejects.toMatchObject({ key: "error.installOtherPublisher" });
    await expect(installZip(await zipFile(userData, copycat), { userData, userModules, tavoraVersion: TAVORA, modules })).rejects.toMatchObject({ key: "error.installOtherPublisher" });
    expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toBe("<p>new</p>");
  });

  it("updates only to a higher version, and says which versions", async () => {
    const { userData, userModules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const first = packageFiles("wellbrained.tracker", "1.2.0");
    await installZip(await zipFile(userData, [...first, signFiles(first, key)]), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    const root = path.join(userModules, "wellbrained.tracker");
    const modules = new Map([["wellbrained.tracker", loaded("wellbrained.tracker", root, fingerprint(key), "1.2.0")]]);

    for (const version of ["1.2.0", "1.1.9", "1.2.0-beta.1"]) {
      const files = packageFiles("wellbrained.tracker", version, "<p>old</p>");
      await expect(installZip(await zipFile(userData, [...files, signFiles(files, key)]), { userData, userModules, tavoraVersion: TAVORA, modules })).rejects.toMatchObject({
        key: "error.installNotNewer",
        params: { name: "Tracker", installed: "1.2.0", version },
      });
    }
    expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toBe("<p>hi</p>");

    const next = packageFiles("wellbrained.tracker", "1.2.1", "<p>new</p>");
    expect((await installZip(await zipFile(userData, [...next, signFiles(next, key)]), { userData, userModules, tavoraVersion: TAVORA, modules })).updated).toBe(true);
  });

  it("refuses an id loaded from somewhere else, a reserved id, a tampered zip and a missing entry", async () => {
    const { userData, userModules } = await setup();
    const elsewhere = new Map([["wellbrained.tracker", loaded("wellbrained.tracker", "/dev/modules/tracker", "local")]]);
    await expect(installZip(await zipFile(userData, packageFiles("wellbrained.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: elsewhere })).rejects.toMatchObject({
      key: "error.installTaken",
      params: { name: "Tracker", folder: "/dev/modules/tracker" },
    });
    // It says where the other copy comes from: a development folder, or a module that ships with Tavora.
    const developing = new Map([["wellbrained.tracker", { ...loaded("wellbrained.tracker", "/projects/tracker", "local"), developmentFolder: "/projects" }]]);
    await expect(installZip(await zipFile(userData, packageFiles("wellbrained.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: developing })).rejects.toMatchObject({
      key: "error.installTakenDevelopment",
      params: { folder: "/projects" },
    });
    const shipped = new Map([["wellbrained.tracker", { ...loaded("wellbrained.tracker", "/app/modules/tracker", "official"), provenance: "official" as const }]]);
    await expect(installZip(await zipFile(userData, packageFiles("wellbrained.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: shipped })).rejects.toMatchObject({
      key: "error.installTakenOfficial",
    });
    await expect(installZip(await zipFile(userData, packageFiles("tavora.notes")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({ key: "error.installRefused" });

    const key = generateKeyPairSync("ed25519").privateKey;
    const files = packageFiles("wellbrained.tracker");
    const signature = signFiles(files, key);
    const tampered = [files[0]!, { name: "dist/index.html", data: Buffer.from("<p>changed</p>") }, signature];
    await expect(installZip(await zipFile(userData, tampered), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({ key: "error.installRefused" });
    await expect(installZip(await zipFile(userData, [files[0]!]), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({ key: "error.installRefused" });
    await writeFile(path.join(userData, "junk.zip"), "not a zip");
    await expect(installZip(path.join(userData, "junk.zip"), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({ key: "error.installRefused" });
    expect(await readdir(userModules)).toEqual([]);
  });

  it("never replaces a folder that is in the way", async () => {
    const { userData, userModules } = await setup();
    await mkdir(path.join(userModules, "wellbrained.tracker"));
    await writeFile(path.join(userModules, "wellbrained.tracker", "mine.txt"), "keep");
    await expect(installZip(await zipFile(userData, packageFiles("wellbrained.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({ key: "error.installFolderTaken" });
    expect(await readdir(path.join(userModules, "wellbrained.tracker"))).toEqual(["mine.txt"]);
  });
});

describe("compareModuleVersions", () => {
  it("orders versions as semver does", () => {
    const ordered = ["0.9.0", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0", "1.0.1", "1.2.0", "1.10.0", "2.0.0"];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareModuleVersions(ordered[i]!, ordered[i + 1]!)).toBeLessThan(0);
      expect(compareModuleVersions(ordered[i + 1]!, ordered[i]!)).toBeGreaterThan(0);
    }
    expect(compareModuleVersions("1.0.0-beta.1", "1.0.0-beta.1")).toBe(0);
  });
});

describe("applyOwners", () => {
  it("gives a module in the player's folder its recorded owner, and nothing else", async () => {
    const { userData, userModules } = await setup();
    const owner = "0123456789abcdef0123456789abcdef";
    const modules = new Map([
      ["wellbrained.tracker", loaded("wellbrained.tracker", path.join(userModules, "wellbrained.tracker"), "local")],
      ["wellbrained.other", loaded("wellbrained.other", path.join(userModules, "wellbrained.other"), "local")],
      ["wellbrained.dev", loaded("wellbrained.dev", "/dev/wellbrained.dev", "local")],
    ]);
    applyOwners(modules, userModules, { "wellbrained.tracker": { id: "wellbrained.tracker", owner }, "wellbrained.other": { id: "wellbrained.renamed", owner }, "wellbrained.dev": { id: "wellbrained.dev", owner } });
    expect([...modules.values()].map((module) => module.owner)).toEqual([owner, "local", "local"]);

    await installZip(await zipFile(userData, packageFiles("wellbrained.x")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    await forgetOwner(userData, "wellbrained.x");
    expect(await readOwnerRecords(userData)).toEqual({});
  });
});
