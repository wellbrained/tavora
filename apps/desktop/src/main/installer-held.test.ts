// A previous module copy that is busy during recovery, an unsigned copy an older Tavora left, and flushing an install.
import { mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeZip, type ZipFile } from "@tavora/pack";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installZip, recoverInstalls, strandedModules } from "./installer";
import { loadInstalledModules } from "./installed-modules";
import { panelsWait, type InstalledModule } from "./registry";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, open: vi.fn(real.open), readFile: vi.fn(real.readFile), rename: vi.fn(real.rename) };
});

const realOpen = vi.mocked(open).getMockImplementation()!;
const realReadFile = vi.mocked(readFile).getMockImplementation()!;
const realRename = vi.mocked(rename).getMockImplementation()!;
let busyRead: (file: string) => boolean = () => false;
let heldRename: (from: string, to: string) => boolean = () => false;
/** Each file flushed to the disk, in order. */
let flushes: string[] = [];

const ID = "local.tracker";
const manifest = (version: string) =>
  JSON.stringify({ id: ID, name: "Tracker", version, apiVersion: "1", entry: "dist/index.html", games: [], viewport: { minWidth: 100, minHeight: 100 }, permissions: { network: [] } });
const files = (version: string): ZipFile[] => [
  { name: "tavora.module.json", data: Buffer.from(manifest(version)) },
  { name: "dist/index.html", data: Buffer.from(`<p>${version}</p>`) },
];

let userData: string;
let userModules: string;
let staging: string;

beforeEach(async () => {
  busyRead = () => false;
  heldRename = () => false;
  flushes = [];
  vi.mocked(readFile).mockImplementation(((file: string, options: never) => (busyRead(String(file)) ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })) : realReadFile(file, options))) as never);
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (heldRename(String(from), String(to))) throw Object.assign(new Error("held"), { code: "EPERM" });
    return realRename(from, to);
  });
  vi.mocked(open).mockImplementation((async (file: string, ...rest: never[]) => {
    const handle = await (realOpen as (...args: unknown[]) => Promise<Awaited<ReturnType<typeof open>>>)(file, ...rest);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      flushes.push(String(file));
      await sync();
    };
    return handle;
  }) as never);
  userData = await realpath(await mkdtemp(path.join(tmpdir(), "tavora-held-")));
  userModules = path.join(userData, "modules");
  staging = path.join(userData, "module-staging");
  await mkdir(userModules);
  await mkdir(staging);
});
afterEach(async () => {
  busyRead = () => false;
  heldRename = () => false;
  await rm(userData, { recursive: true, force: true });
});

const there = (target: string) => stat(target).then(() => true, () => false);
const recover = () => recoverInstalls({ userData, userModules, officialDir: path.join(userData, "official-updates"), log: () => undefined });
const target = path.join.bind(path);
const page = (dir: string) => realReadFile(path.join(dir, "dist", "index.html"), "utf8");
const waitingNow = async () => panelsWait((await loadInstalledModules({ userData, userModules, sources: { local: [userModules] }, tavoraVersion: "0.17.0", safety: { blocked: () => null } })).problems);

async function put(dir: string, content: ZipFile[]): Promise<string> {
  for (const file of content) {
    await mkdir(path.dirname(path.join(dir, file.name)), { recursive: true });
    await writeFile(path.join(dir, file.name), file.data);
  }
  return dir;
}

async function oldCopy(): Promise<string> {
  const old = await put(path.join(staging, "old-1"), files("1.0.0"));
  await writeFile(`${old}.updating`, "");
  return old;
}

async function zip(content: ZipFile[]): Promise<string> {
  const file = path.join(userData, `pkg-${Math.random().toString(36).slice(2)}.zip`);
  await writeFile(file, writeZip(content));
  return file;
}

describe("a previous copy that is busy during recovery", () => {
  it("a busy file inside it doesn't delete it: it waits, with its panels", async () => {
    const old = await oldCopy();
    busyRead = (file) => file === path.join(old, "dist", "index.html");
    await recover();
    busyRead = () => false;
    expect(await there(path.join(old, "dist", "index.html"))).toBe(true);
    expect(strandedModules(userData).map((problem) => problem.about?.id)).toEqual([ID]);
    expect((await waitingNow())(ID)).toBe(true);

    await recover();
    expect(await page(target(userModules, ID))).toBe("<p>1.0.0</p>");
    expect(strandedModules(userData)).toEqual([]);
  });

  it("a busy manifest keeps it too, and every panel waits, as Tavora can't tell whose it is", async () => {
    const old = await oldCopy();
    busyRead = (file) => file === path.join(old, "tavora.module.json");
    await recover();
    busyRead = () => false;
    expect(await there(old)).toBe(true);
    expect((await waitingNow())(ID)).toBe(true);

    await recover();
    expect(await page(target(userModules, ID))).toBe("<p>1.0.0</p>");
  });

  it("a manifest that really isn't one still leaves the folder alone and waits for nothing", async () => {
    await put(path.join(staging, "old-1"), [{ name: "note.txt", data: Buffer.from("?") }]);
    await recover();
    expect(await there(path.join(staging, "old-1"))).toBe(true);
    expect(strandedModules(userData)).toEqual([]);
  });
});

describe("an unsigned local module", () => {
  it("isn't brought back from a copy an older Tavora left: the user may have removed it. The files stay", async () => {
    await put(path.join(staging, "old-1"), files("1.0.0"));
    await recover();
    expect(await there(target(userModules, ID))).toBe(false);
    const left = (await readdir(staging)).filter((name) => name.startsWith("left-"));
    expect(left).toHaveLength(1);
    expect(await page(path.join(staging, left[0]!))).toBe("<p>1.0.0</p>");

    // And it isn't looked at again.
    await recover();
    expect(await there(target(userModules, ID))).toBe(false);
  });

  it("comes back when this Tavora's own update of it was cut off", async () => {
    await installZip(await zip(files("1.0.0")), { userData, userModules, tavoraVersion: "0.17.0", modules: new Map() });
    const installed: InstalledModule = { manifest: JSON.parse(manifest("1.0.0")), root: target(userModules, ID), provenance: "local", owner: "local" };
    // The new copy can't go in, and the old one can't go back either.
    heldRename = (from, to) => to === target(userModules, ID);
    await expect(installZip(await zip(files("2.0.0")), { userData, userModules, tavoraVersion: "0.17.0", modules: new Map([[ID, installed]]) })).rejects.toThrow();
    heldRename = () => false;
    expect(await there(target(userModules, ID))).toBe(false);

    await recover();
    expect(await page(target(userModules, ID))).toBe("<p>1.0.0</p>");
    expect((await readdir(staging)).filter((name) => !name.startsWith("pkg-"))).toEqual([]);
  });

  it("a finished update leaves no marker behind", async () => {
    await installZip(await zip(files("1.0.0")), { userData, userModules, tavoraVersion: "0.17.0", modules: new Map() });
    const installed: InstalledModule = { manifest: JSON.parse(manifest("1.0.0")), root: target(userModules, ID), provenance: "local", owner: "local" };
    await installZip(await zip(files("2.0.0")), { userData, userModules, tavoraVersion: "0.17.0", modules: new Map([[ID, installed]]) });
    expect(await readdir(staging)).toEqual([]);
  });
});

describe("an install", () => {
  it("flushes the module's files before its record says it is there", async () => {
    await installZip(await zip(files("1.0.0")), { userData, userModules, tavoraVersion: "0.17.0", modules: new Map() });
    const moduleFiles = flushes.filter((file) => file.includes(`${path.sep}install-`));
    expect(moduleFiles.map((file) => path.basename(file)).sort()).toEqual(["index.html", "tavora.module.json"]);
    const record = flushes.findIndex((file) => path.basename(file).startsWith("module-owners.json"));
    if (record >= 0) expect(Math.max(...moduleFiles.map((file) => flushes.indexOf(file)))).toBeLessThan(record);
  });
});
