// The cloud copy when a file is held (a virus scan, an indexer) in the middle of putting a copy in place.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swapInCopy, undoSwap } from "./cloud-copy";
import { CopySync } from "./cloud-copy-sync";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { readSavedFile } from "./json";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(real.rename), stat: vi.fn(real.stat) };
});

const realRename = vi.mocked(rename).getMockImplementation()!;
const realStat = vi.mocked(stat).getMockImplementation()!;
/** A rename this says yes to fails as if something held the file. */
let held: (from: string, to: string) => boolean = () => false;
/** A look at a file this says yes to fails for a moment. */
let busyStat: (file: string) => boolean = () => false;

beforeEach(() => {
  held = () => false;
  busyStat = () => false;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (held(String(from), String(to))) throw Object.assign(new Error("held"), { code: "EPERM" });
    return realRename(from, to);
  });
  vi.mocked(stat).mockImplementation(((file: string, options: never) => {
    if (busyStat(String(file))) return Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" }));
    return realStat(file, options);
  }) as never);
});
afterEach(async () => {
  held = () => false;
  busyStat = () => false;
  await cleanUp();
});

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };
type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

function tavora(cloud: Service, at: Pc) {
  const events = { restarts: 0 };
  const sync = new CopySync({
    userData: at.userData,
    enabled: true,
    files: { root: () => at.moduleFiles },
    account: { token: () => cloud.token, id: () => "me" },
    serviceUrl: "http://tavora.test/v1/account",
    fetch: cloud.fetch,
    encryptor,
    restart: () => void events.restarts++,
  });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return { sync, events };
}

const read = (dir: string, name: string) => readFile(path.join(dir, name), "utf8");
const there = (file: string) => realStat(file).then(() => true, () => false);
const library = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const remoteVersion = async (cloud: Service) => (await cloud.client().remote())?.version;
const ends = (file: string, ...names: string[]) => file.endsWith(path.join(...names));
const backups = (at: Pc) => readdir(path.join(at.userData, "backups")).catch(() => [] as string[]);

async function startCopy(cloud: Service, a: Pc) {
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  return { ...first, key: first.sync.view().recoveryKey! };
}

/** B has data of its own and chose the cloud copy, which waits for the next start. */
async function choseCloud(cloud: Service, key: string, files: Record<string, string>) {
  const b = await pc(files);
  const at = tavora(cloud, b);
  await at.sync.beforeLoad();
  await at.sync.turnOn();
  await at.sync.enterKey(key);
  await at.sync.keep("cloud");
  return b;
}

/** A lost library, and the user chose the cloud copy. */
async function lostAndChoseCloud(cloud: Service, a: Pc) {
  await writeFile(path.join(a.userData, "library.json"), "{ broken");
  const damaged = tavora(cloud, a);
  await readSavedFile(path.join(a.userData, "library.json"), { version: 2 });
  await damaged.sync.beforeLoad();
  await damaged.sync.checkDataFiles();
  expect(damaged.sync.view()).toMatchObject({ conflict: true, lostData: true });
  await damaged.sync.keep("cloud");
}

describe("a file held while the copy goes in", () => {
  it("uploads nothing, by any way, and asks again", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "workspace.json": "{}" });
    await startCopy(cloud, a);
    const version = await remoteVersion(cloud);
    await lostAndChoseCloud(cloud, a);

    held = (from) => ends(from, "data", "library.json") && from.includes("cloud-copy-staging");
    const stuck = tavora(cloud, a);
    await stuck.sync.beforeLoad();
    await stuck.sync.checkDataFiles();
    expect(stuck.sync.view()).toMatchObject({ conflict: true, swapUnfinished: true });
    expect(stuck.sync.dataHeld).toBe(true);

    // The app goes on and saves an empty library.
    await writeFile(path.join(a.userData, "library.json"), library());
    await stuck.sync.sync();
    await expect(stuck.sync.sync(true)).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });
    await expect(stuck.sync.move(path.join(a.root, "elsewhere"))).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });
    await expect(stuck.sync.startOver()).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });
    expect(stuck.sync.holdClose(() => undefined)).toBe(false);
    expect(await remoteVersion(cloud)).toBe(version);

    // Once the file is free, the next start finishes it and the library is back.
    held = () => false;
    const next = tavora(cloud, a);
    await next.sync.beforeLoad();
    expect(JSON.parse(await read(a.userData, "library.json")).workspaces).toEqual({ "elden-ring": {} });
    expect(next.sync.view()).toMatchObject({ conflict: false, lostData: false, swapUnfinished: false });
    expect(next.sync.dataHeld).toBe(false);
  });

  it("tries a held file again before it gives up", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring") });
    await startCopy(cloud, a);
    await lostAndChoseCloud(cloud, a);
    let tries = 0;
    held = (from) => ends(from, "data", "library.json") && from.includes("cloud-copy-staging") && ++tries < 3;
    const next = tavora(cloud, a);
    await next.sync.beforeLoad();
    expect(next.sync.view().swapUnfinished).toBe(false);
    expect(JSON.parse(await read(a.userData, "library.json")).workspaces).toEqual({ "elden-ring": {} });
  });
});

describe("what the app wrote while a swap waited", () => {
  const file = { size: 1, sha256: "0".repeat(64), parts: ["0".repeat(64)] };

  it("never replaces the backup: a file written since is set aside", async () => {
    const at = await pc({ "library.json": "from the copy", "profile.json": "new and empty", "module-data/new.json": "new" });
    const kept = path.join(at.root, "kept");
    await mkdir(path.join(kept, "module-data"), { recursive: true });
    await writeFile(path.join(kept, "profile.json"), "good profile");
    await writeFile(path.join(kept, "module-data", "old.json"), "good data");
    const staging = path.join(at.root, "staging");
    await mkdir(staging, { recursive: true });

    await swapInCopy(staging, at.roots, kept, { version: 2, pictures: true, files: { "library.json": file } });

    expect(await read(kept, "profile.json")).toBe("good profile");
    expect(await read(kept, "module-data/old.json")).toBe("good data");
    expect(await there(path.join(at.userData, "profile.json"))).toBe(false);
    expect(await read(kept, "written-since/profile.json")).toBe("new and empty");
    expect(await read(kept, "written-since/module-data/new.json")).toBe("new");
  });

  it("counts a file changed in place as changed, so it isn't marked as synced", async () => {
    const at = await pc({ "library.json": "12345" });
    const staging = path.join(at.root, "staging");
    await mkdir(staging, { recursive: true });
    const state = await swapInCopy(staging, at.roots, path.join(at.root, "kept"), { version: 2, pictures: true, files: { "library.json": { size: 5, sha256: "0".repeat(64), parts: [] } } }, true);
    expect(state.files["library.json"]!.mtimeMs).toBeLessThan(0);
  });

  async function halfSwapped() {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "modules/dice/manifest.json": "dice" });
    const { key } = await startCopy(cloud, a);
    const b = await choseCloud(cloud, key, { "library.json": library("hades"), "profile.json": "good profile", "module-data/old.json": "good data" });
    // library.json and the rest go in, then the modules folder is held.
    held = (from) => from.includes("cloud-copy-staging") && ends(from, "data", "modules");
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    expect(stuck.sync.view()).toMatchObject({ conflict: true, swapUnfinished: true });
    held = () => false;
    // The app runs on and makes what the swap moved away anew.
    await writeFile(path.join(b.userData, "profile.json"), "new and empty");
    await mkdir(path.join(b.userData, "module-data"), { recursive: true });
    await writeFile(path.join(b.userData, "module-data", "new.json"), "new");
    return { cloud, b, stuck };
  }

  it("finishes at the next start with the backup whole", async () => {
    const { cloud, b } = await halfSwapped();
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.view()).toMatchObject({ swapUnfinished: false, conflict: false });
    expect(await read(b.userData, "modules/dice/manifest.json")).toBe("dice");
    const [backup] = await backups(b);
    const keepIn = path.join(b.userData, "backups", backup!);
    expect(await read(keepIn, "profile.json")).toBe("good profile");
    expect(await read(keepIn, "module-data/old.json")).toBe("good data");
    expect(await read(keepIn, "written-since/profile.json")).toBe("new and empty");
  });

  it("Keep this PC's goes back to what was here", async () => {
    const { cloud, b, stuck } = await halfSwapped();
    const version = await remoteVersion(cloud);
    await stuck.sync.keep("pc");
    expect(stuck.events.restarts).toBe(1);
    expect(await remoteVersion(cloud)).toBe(version);

    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toEqual({ hades: {} });
    expect(await read(b.userData, "profile.json")).toBe("good profile");
    expect(await read(b.userData, "module-data/old.json")).toBe("good data");
    expect(await there(path.join(b.userData, "cloud-copy-staging", "swap.json"))).toBe(false);
    expect(next.sync.view().swapUnfinished).toBe(false);
  });

  it("taking a swap back can run twice, and empties only what was empty before", async () => {
    const at = await pc({ "library.json": "from the copy", "profile.json": "this PC's, already back", "modules/dice/m.json": "came with the copy" });
    const kept = path.join(at.root, "kept");
    await mkdir(kept, { recursive: true });
    await writeFile(path.join(kept, "library.json"), "this PC's");
    const file = { size: 1, sha256: "0".repeat(64), parts: ["0".repeat(64)] };
    const copy = { version: 2, pictures: true, files: { "library.json": file, "profile.json": file, "modules/dice/m.json": file } };
    const staging = path.join(at.root, "staging");
    const empty = [path.join(at.userData, "modules")];
    await undoSwap(staging, at.roots, kept, copy, empty);
    await undoSwap(staging, at.roots, kept, copy, empty);
    expect(await read(at.userData, "library.json")).toBe("this PC's");
    expect(await read(at.userData, "profile.json")).toBe("this PC's, already back");
    expect(await there(path.join(at.userData, "modules"))).toBe(false);
    expect(await read(kept, "written-since/library.json")).toBe("from the copy");
    expect(await read(kept, "written-since/modules/dice/m.json")).toBe("came with the copy");
  });

  it("Use the cloud copy tries again with a restart", async () => {
    const { cloud, b, stuck } = await halfSwapped();
    await stuck.sync.keep("cloud");
    expect(stuck.events.restarts).toBe(1);
    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b.userData, "modules/dice/manifest.json")).toBe("dice");
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toEqual({ "elden-ring": {} });
  });

  it("turning the copy off goes back to this PC's data at the next start, and it can be turned on again", async () => {
    const { cloud, b, stuck } = await halfSwapped();
    await stuck.sync.turnOff();
    await expect(stuck.sync.turnOn()).rejects.toMatchObject({ key: "cloudCopy.error.restartFirst" });

    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toEqual({ hades: {} });
    expect(await read(b.userData, "profile.json")).toBe("good profile");
    await next.sync.turnOn();
    expect(next.sync.view()).toMatchObject({ on: true, conflict: true });
  });
});

describe("choosing a side", () => {
  async function bothChanged() {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring") });
    const { key } = await startCopy(cloud, a);
    const b = await pc({ "library.json": library("hades") });
    const at = tavora(cloud, b);
    await at.sync.beforeLoad();
    await at.sync.turnOn();
    await at.sync.enterKey(key);
    expect(at.sync.view().conflict).toBe(true);
    return { cloud, b, at };
  }

  it("Keep this PC's stops before uploading when the other side can't be kept as a backup", async () => {
    const { cloud, b, at } = await bothChanged();
    const version = await remoteVersion(cloud);
    held = (from, to) => ends(from, "cloud-copy-staging", "data") && to.includes("backups");
    await expect(at.sync.keep("pc")).rejects.toMatchObject({ key: "cloudCopy.error.failed" });
    expect(await remoteVersion(cloud)).toBe(version);
    expect(at.sync.view().conflict).toBe(true);
    expect((await backups(b)).filter((name) => name.endsWith("-cloud"))).toEqual([]);
  });

  it("Keep this PC's drops the staged list before it moves the staged files", async () => {
    const { b, at } = await bothChanged();
    const staged = path.join(b.userData, "cloud-copy-staging", "staged.json");
    let listThere: boolean | undefined;
    const look = vi.mocked(rename).getMockImplementation()!;
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (ends(String(from), "cloud-copy-staging", "data")) listThere = await there(staged);
      return look(from, to);
    });
    await at.sync.keep("pc");
    expect(listThere).toBe(false);
  });

  it("a staged list without its files is never used: the copy comes down again", async () => {
    const { cloud, b, at } = await bothChanged();
    // A crash during Keep this PC's left the list and moved the files.
    await rm(path.join(b.userData, "cloud-copy-staging", "data"), { recursive: true, force: true });
    await at.sync.keep("cloud");
    await tavora(cloud, b).sync.beforeLoad();
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toEqual({ "elden-ring": {} });
  });

  it("at start, a staged list without its files takes nothing", async () => {
    const { cloud, b, at } = await bothChanged();
    await at.sync.keep("cloud");
    await rm(path.join(b.userData, "cloud-copy-staging", "data"), { recursive: true, force: true });
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toEqual({ hades: {} });
    expect(await backups(b)).toEqual([]);
  });
});

describe("at start", () => {
  it("finishes a cut-off swap even when where the copy is kept can't be read", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "workspace.json": '"from a"' });
    const { key } = await startCopy(cloud, a);
    const b = await choseCloud(cloud, key, { "library.json": library("hades"), "workspace.json": '"from b"' });
    const stagingDir = path.join(b.userData, "cloud-copy-staging");
    const keepIn = path.join(b.userData, "backups", "cloud-copy-2026-11-21T00-00-00-000Z-this-pc");
    await mkdir(keepIn, { recursive: true });
    await writeFile(path.join(stagingDir, "swap.json"), JSON.stringify({ v: 1, keepIn, moduleFiles: b.moduleFiles, own: null }));
    await realRename(path.join(b.userData, "library.json"), path.join(keepIn, "library.json"));
    await realRename(path.join(stagingDir, "data", "library.json"), path.join(b.userData, "library.json"));
    await writeFile(path.join(b.userData, "cloud-copy-place.json"), "{ broken");

    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(await read(b.userData, "workspace.json")).toBe('"from a"');
    expect(await there(path.join(stagingDir, "swap.json"))).toBe(false);
    expect(next.sync.view().on).toBe(false);
  });

  it("doesn't call a file lost when it is only held for a moment", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "workspace.json": "{}" });
    await startCopy(cloud, a);
    const next = tavora(cloud, a);
    await next.sync.beforeLoad();
    busyStat = (file) => ends(file, "workspace.json");
    await next.sync.checkDataFiles();
    busyStat = () => false;
    expect(next.sync.view()).toMatchObject({ conflict: false, lostData: false });
  });
});
