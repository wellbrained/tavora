// A module update cut off, or a previous copy that couldn't be deleted: what the next start may bring back.
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fingerprint, signFiles, writeZip, type ZipFile } from "@tavora/pack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dropOldCopies, forgetOwner, installZip, readOwnerRecords, recoverInstalls, strandedModules } from "./installer";
import { loadInstalledModules } from "./installed-modules";
import { panelsWait, type InstalledModule } from "./registry";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(real.rename), rm: vi.fn(real.rm) };
});

const realRename = vi.mocked(rename).getMockImplementation()!;
const realRm = vi.mocked(rm).getMockImplementation()!;
/** A rename this says yes to fails as if something held the file. */
let heldRename: (from: string, to: string) => boolean = () => false;
/** A delete this says yes to fails on a locked file. */
let heldRm: (target: string) => boolean = () => false;

const ID = "wellbrained.tracker";
const OFFICIAL = "tavora.notes";
const manifest = (id: string, version: string) =>
  JSON.stringify({ id, name: "Tracker", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } });
const unsigned = (id: string, version: string): ZipFile[] => [
  { name: "tavora.module.json", data: Buffer.from(manifest(id, version)) },
  { name: "dist/index.html", data: Buffer.from(`<p>${version}</p>`) },
];
const key = generateKeyPairSync("ed25519").privateKey;
const signed = (id: string, version: string): ZipFile[] => {
  const files = unsigned(id, version);
  return [...files, signFiles(files, key)];
};

let userData: string;
let userModules: string;
let officialDir: string;
let staging: string;

beforeEach(async () => {
  heldRename = () => false;
  heldRm = () => false;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (heldRename(String(from), String(to))) throw Object.assign(new Error("held"), { code: "EPERM" });
    return realRename(from, to);
  });
  vi.mocked(rm).mockImplementation(async (target, options) => {
    if (heldRm(String(target))) throw Object.assign(new Error("locked"), { code: "EPERM" });
    return realRm(target, options);
  });
  userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-recover-")));
  userModules = path.join(userData, "modules");
  officialDir = path.join(userData, "official-updates");
  staging = path.join(userData, "module-staging");
  await mkdir(userModules);
  await mkdir(staging);
});
afterEach(async () => {
  heldRename = () => false;
  heldRm = () => false;
  await realRm(userData, { recursive: true, force: true });
});

const there = (target: string) => stat(target).then(() => true, () => false);
const recover = () => recoverInstalls({ userData, userModules, officialDir, log: () => undefined });
const page = (dir: string) => readFile(path.join(dir, "dist", "index.html"), "utf8");
const target = (id = ID) => path.join(userModules, id);

async function put(dir: string, files: ZipFile[]): Promise<string> {
  for (const file of files) {
    await mkdir(path.dirname(path.join(dir, file.name)), { recursive: true });
    await writeFile(path.join(dir, file.name), file.data);
  }
  return dir;
}

async function zip(files: ZipFile[]): Promise<string> {
  const file = path.join(userData, `pkg-${Math.random().toString(36).slice(2)}.zip`);
  await writeFile(file, writeZip(files));
  return file;
}

const loaded = (id: string, root: string, owner: string): InstalledModule => ({ manifest: JSON.parse(manifest(id, "1.0.0")), root, provenance: "local", owner });
const install = async (files: ZipFile[], modules = new Map<string, InstalledModule>()) => installZip(await zip(files), { userData, userModules, tavoraVersion: "0.17.0", modules });

/** Installed at 1.0.0, with its previous copy waiting in the staging folder as an update left it. */
async function installedWithOld(): Promise<string> {
  await install(signed(ID, "1.0.0"));
  return put(path.join(staging, "old-1"), signed(ID, "1.0.0"));
}

describe("a previous copy whose module is gone", () => {
  it("isn't brought back once the module was removed: it would load unsigned, past its block", async () => {
    const old = await installedWithOld();
    await rm(target(), { recursive: true });
    await forgetOwner(userData, ID);
    await recover();
    expect(await there(target())).toBe(false);
    expect(await there(old)).toBe(false);
  });

  it("isn't brought back when deleting it failed after a finished update, and the module was then removed", async () => {
    await install(signed(ID, "1.0.0"));
    heldRm = (dir) => path.basename(dir).startsWith("old-");
    await install(signed(ID, "2.0.0"), new Map([[ID, loaded(ID, target(), fingerprint(key))]]));
    heldRm = () => false;
    expect((await readdir(staging)).filter((name) => name.startsWith("old-") && !name.endsWith(".done"))).toHaveLength(1);
    // The record still names the module (a cloud copy can bring one), and the old folder would not match it anyway.
    await rm(target(), { recursive: true });
    await recover();
    expect(await there(target())).toBe(false);
    expect(await readdir(staging)).toEqual([]);
  });

  it("isn't brought back when a finished update's record still names the old files", async () => {
    const old = await installedWithOld();
    await writeFile(`${old}.done`, "");
    await rm(target(), { recursive: true });
    await recover();
    expect(await there(target())).toBe(false);
    expect(await readdir(staging)).toEqual([]);
  });

  it("isn't brought back when its files aren't what the record names", async () => {
    await install(signed(ID, "1.0.0"));
    await put(path.join(staging, "old-1"), signed(ID, "0.9.0"));
    await rm(target(), { recursive: true });
    await recover();
    expect(await there(target())).toBe(false);
  });

  it("isn't brought back when its signature is broken and no record names it", async () => {
    const files = signed(ID, "1.0.0");
    await put(path.join(staging, "old-1"), files.map((file) => (file.name === "dist/index.html" ? { ...file, data: Buffer.from("<p>changed</p>") } : file)));
    await recover();
    expect(await there(target())).toBe(false);
  });

  it("removing a module takes its previous copy with it, and a locked one can't come back", async () => {
    const old = await installedWithOld();
    await put(path.join(staging, "old-2"), signed("wellbrained.other", "1.0.0"));
    heldRm = (dir) => dir === old;
    await dropOldCopies(userData, ID);
    heldRm = () => false;
    expect(await there(`${old}.done`)).toBe(true);
    expect(await there(path.join(staging, "old-2"))).toBe(true);
    await rm(target(), { recursive: true });
    await recover();
    expect(await there(target())).toBe(false);
  });
});

describe("an update that really was cut off", () => {
  it("puts back the copy the record names", async () => {
    await installedWithOld();
    await rm(target(), { recursive: true });
    await recover();
    expect(await page(target())).toBe("<p>1.0.0</p>");
    expect(await readdir(staging)).toEqual([]);
    expect((await readOwnerRecords(userData))[ID]?.owner).toBe(fingerprint(key));
  });

  it("puts back an unsigned local module, which never had a record", async () => {
    await put(path.join(staging, "old-1"), unsigned(ID, "1.0.0"));
    await recover();
    expect(await page(target())).toBe("<p>1.0.0</p>");
  });

  it("puts back one of Tavora's own only when its record names it", async () => {
    await put(path.join(staging, "old-1"), signed(OFFICIAL, "1.1.0"));
    await recover();
    expect(await there(path.join(officialDir, OFFICIAL))).toBe(false);

    await put(path.join(staging, "old-2"), signed(OFFICIAL, "1.1.0"));
    const signer = fingerprint(key);
    await writeFile(path.join(userData, "official-updates.json"), JSON.stringify({ version: 1, modules: { [OFFICIAL]: { id: OFFICIAL, version: "1.1.0", sha256: "a".repeat(64), signer, highWater: "1.1.0" } } }));
    await recover();
    expect(await page(path.join(officialDir, OFFICIAL))).toBe("<p>1.1.0</p>");
  });

  it("tries a held file again", async () => {
    await installedWithOld();
    await rm(target(), { recursive: true });
    let tries = 0;
    heldRename = (from) => path.basename(from) === "old-1" && ++tries < 3;
    await recover();
    expect(await page(target())).toBe("<p>1.0.0</p>");
    expect(strandedModules(userData)).toEqual([]);
  });

  it("keeps the module's panels waiting while a held file stops it coming back", async () => {
    const old = await installedWithOld();
    await rm(target(), { recursive: true });
    heldRename = (from) => from === old;
    await recover();
    heldRename = () => false;
    expect(await there(old)).toBe(true);
    const { problems, modules } = await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: "0.17.0", safety: { blocked: () => null } });
    expect(modules.has(ID)).toBe(false);
    const waits = panelsWait(problems);
    expect(waits(ID)).toBe(true);
    expect(waits("some.other-module")).toBe(false);

    // The next start finishes it, and nothing waits any more.
    await recover();
    expect(await page(target())).toBe("<p>1.0.0</p>");
    expect(strandedModules(userData)).toEqual([]);
  });

  it("restores nothing while the records can't be read, and keeps the panels waiting", async () => {
    await put(path.join(staging, "old-1"), signed(ID, "1.0.0"));
    await mkdir(path.join(userData, "module-owners.json"));
    await recover();
    expect(await there(target())).toBe(false);
    expect(await there(path.join(staging, "old-1"))).toBe(true);
    expect(panelsWait([...strandedModules(userData)])(ID)).toBe(true);
  });

  it("puts the new copy back when the old one can't go in, and tries again next time", async () => {
    await install(signed(ID, "1.0.0"));
    const old = await put(path.join(staging, "old-1"), signed(ID, "1.0.0"));
    await rm(target(), { recursive: true });
    await put(target(), signed(ID, "2.0.0"));
    heldRename = (from) => from === old;
    await recover();
    heldRename = () => false;
    expect(await page(target())).toBe("<p>2.0.0</p>");
    expect(await there(old)).toBe(true);
    await recover();
    expect(await page(target())).toBe("<p>1.0.0</p>");
  });

  it("clears unfinished copies an earlier recovery left", async () => {
    await put(path.join(staging, "unfinished-1"), signed(ID, "2.0.0"));
    await recover();
    expect(await readdir(staging)).toEqual([]);
  });
});
