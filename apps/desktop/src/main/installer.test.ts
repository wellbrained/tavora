import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { describe, expect, it } from "vitest";
import { applyOwners, forgetOwner, installZip, readOwnerRecords } from "./installer";
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

function loaded(id: string, root: string, owner: string): InstalledModule {
  return { manifest: JSON.parse(manifest(id)), root, provenance: "local", owner };
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
    const files = packageFiles("nik.tracker");
    const installed = await installZip(await zipFile(userData, [...files, signFiles(files, key)]), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    expect(installed).toMatchObject({ owner: fingerprint(key), updated: false });
    expect(await readFile(path.join(userModules, "nik.tracker", "dist", "index.html"), "utf8")).toBe("<p>hi</p>");
    expect(await readOwnerRecords(userData)).toEqual({ "nik.tracker": { id: "nik.tracker", owner: fingerprint(key) } });
    // Nothing is left half-way.
    expect(await readdir(path.join(userData, "module-staging"))).toEqual([]);
  });

  it("installs an unsigned zip as local", async () => {
    const { userData, userModules } = await setup();
    const installed = await installZip(await zipFile(userData, packageFiles("nik.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    expect(installed.owner).toBe("local");
    expect(await readOwnerRecords(userData)).toEqual({});
  });

  it("updates only from the same publisher (S5)", async () => {
    const { userData, userModules } = await setup();
    const key = generateKeyPairSync("ed25519").privateKey;
    const first = packageFiles("nik.tracker");
    await installZip(await zipFile(userData, [...first, signFiles(first, key)]), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    const root = path.join(userModules, "nik.tracker");
    const modules = new Map([["nik.tracker", loaded("nik.tracker", root, fingerprint(key))]]);

    const next = packageFiles("nik.tracker", "1.1.0", "<p>new</p>");
    const updated = await installZip(await zipFile(userData, [...next, signFiles(next, key)]), { userData, userModules, tavoraVersion: TAVORA, modules });
    expect(updated.updated).toBe(true);
    expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toBe("<p>new</p>");

    const other = generateKeyPairSync("ed25519").privateKey;
    const copycat = packageFiles("nik.tracker", "9.0.0", "<p>evil</p>");
    await expect(installZip(await zipFile(userData, [...copycat, signFiles(copycat, other)]), { userData, userModules, tavoraVersion: TAVORA, modules })).rejects.toMatchObject({ key: "error.installOtherPublisher" });
    await expect(installZip(await zipFile(userData, copycat), { userData, userModules, tavoraVersion: TAVORA, modules })).rejects.toMatchObject({ key: "error.installOtherPublisher" });
    expect(await readFile(path.join(root, "dist", "index.html"), "utf8")).toBe("<p>new</p>");
  });

  it("refuses an id loaded from somewhere else, a reserved id, a tampered zip and a missing entry", async () => {
    const { userData, userModules } = await setup();
    const elsewhere = new Map([["nik.tracker", loaded("nik.tracker", "/dev/modules/tracker", "local")]]);
    await expect(installZip(await zipFile(userData, packageFiles("nik.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: elsewhere })).rejects.toMatchObject({ key: "error.installTaken" });
    await expect(installZip(await zipFile(userData, packageFiles("tavora.notes")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({ key: "error.installRefused" });

    const key = generateKeyPairSync("ed25519").privateKey;
    const files = packageFiles("nik.tracker");
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
    await mkdir(path.join(userModules, "nik.tracker"));
    await writeFile(path.join(userModules, "nik.tracker", "mine.txt"), "keep");
    await expect(installZip(await zipFile(userData, packageFiles("nik.tracker")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() })).rejects.toMatchObject({ key: "error.installFolderTaken" });
    expect(await readdir(path.join(userModules, "nik.tracker"))).toEqual(["mine.txt"]);
  });
});

describe("applyOwners", () => {
  it("gives a module in the player's folder its recorded owner, and nothing else", async () => {
    const { userData, userModules } = await setup();
    const owner = "0123456789abcdef0123456789abcdef";
    const modules = new Map([
      ["nik.tracker", loaded("nik.tracker", path.join(userModules, "nik.tracker"), "local")],
      ["nik.other", loaded("nik.other", path.join(userModules, "nik.other"), "local")],
      ["nik.dev", loaded("nik.dev", "/dev/nik.dev", "local")],
    ]);
    applyOwners(modules, userModules, { "nik.tracker": { id: "nik.tracker", owner }, "nik.other": { id: "nik.renamed", owner }, "nik.dev": { id: "nik.dev", owner } });
    expect([...modules.values()].map((module) => module.owner)).toEqual([owner, "local", "local"]);

    await installZip(await zipFile(userData, packageFiles("nik.x")), { userData, userModules, tavoraVersion: TAVORA, modules: new Map() });
    await forgetOwner(userData, "nik.x");
    expect(await readOwnerRecords(userData)).toEqual({});
  });
});
