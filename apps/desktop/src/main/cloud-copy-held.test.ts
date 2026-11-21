// A swap's own files busy for a moment, going back to this PC's data, and what is kept of work done in between.
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudCopy, EMPTY_STATE, scanCopy, swapInCopy } from "./cloud-copy";
import { CopySync } from "./cloud-copy-sync";
import { FolderStorage } from "./copy-folder";
import { newCopyKey } from "./copy-crypto";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, open: vi.fn(real.open), readFile: vi.fn(real.readFile), rename: vi.fn(real.rename), stat: vi.fn(real.stat) };
});

const realOpen = vi.mocked(open).getMockImplementation()!;
const realReadFile = vi.mocked(readFile).getMockImplementation()!;
const realRename = vi.mocked(rename).getMockImplementation()!;
const realStat = vi.mocked(stat).getMockImplementation()!;
let held: (from: string, to: string) => boolean = () => false;
let busyRead: (file: string) => boolean = () => false;
let busyStat: (file: string) => boolean = () => false;
/** Called with each rename that goes through, before it does. */
let onRename: (from: string, to: string) => Promise<void> = async () => undefined;
const flushed = new Set<string>();

const busy = (code = "EBUSY") => Object.assign(new Error("busy"), { code });

beforeEach(() => {
  held = () => false;
  busyRead = () => false;
  busyStat = () => false;
  onRename = async () => undefined;
  flushed.clear();
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (held(String(from), String(to))) throw busy("EPERM");
    await onRename(String(from), String(to));
    return realRename(from, to);
  });
  vi.mocked(readFile).mockImplementation(((file: string, options: never) => (busyRead(String(file)) ? Promise.reject(busy()) : realReadFile(file, options))) as never);
  vi.mocked(stat).mockImplementation(((file: string, options: never) => (busyStat(String(file)) ? Promise.reject(busy()) : realStat(file, options))) as never);
  vi.mocked(open).mockImplementation((async (file: string, ...rest: never[]) => {
    const handle = await (realOpen as (...args: unknown[]) => Promise<Awaited<ReturnType<typeof open>>>)(file, ...rest);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      flushed.add(String(file));
      await sync();
    };
    return handle;
  }) as never);
});
afterEach(async () => {
  held = () => false;
  busyRead = () => false;
  busyStat = () => false;
  onRename = async () => undefined;
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

const read = (dir: string, name: string) => realReadFile(path.join(dir, name), "utf8") as Promise<string>;
const there = (file: string) => realStat(file).then(() => true, () => false);
const library = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const remoteVersion = async (cloud: Service) => (await cloud.client().remote())?.version;
const workspaces = async (at: Pc) => Object.keys(JSON.parse(await read(at.userData, "library.json")).workspaces as object);
const staging = (at: Pc, ...rest: string[]) => path.join(at.userData, "cloud-copy-staging", ...rest);

async function startCopy(cloud: Service, a: Pc) {
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  return { ...first, key: first.sync.view().recoveryKey! };
}

/** B took A's copy and is in step with it; A then saved a newer one. */
async function newerCopyWaits() {
  const cloud = await service();
  const a = await pc({ "library.json": library("elden-ring"), "workspace.json": '"a1"', "modules/dice/m.json": "dice" });
  const { key, sync: atA } = await startCopy(cloud, a);
  const b = await pc({ "library.json": library("hades") });
  const first = tavora(cloud, b);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  await first.sync.enterKey(key);
  await first.sync.keep("cloud");
  await tavora(cloud, b).sync.beforeLoad();
  await writeFile(path.join(a.userData, "library.json"), library("elden-ring", "hollow-knight"));
  await writeFile(path.join(a.userData, "workspace.json"), '"a2"');
  await writeFile(path.join(a.userData, "modules", "dice", "m.json"), "dice 2");
  await atA.sync();
  return { cloud, a, b };
}

/** The newer copy started going in at B's start and stopped at the modules folder. */
async function stuckOnModules() {
  const { cloud, a, b } = await newerCopyWaits();
  held = (from) => from.includes("cloud-copy-staging") && from.endsWith(path.join("data", "modules"));
  const stuck = tavora(cloud, b);
  await stuck.sync.beforeLoad();
  held = () => false;
  expect(stuck.sync.view()).toMatchObject({ conflict: true, swapUnfinished: true });
  return { cloud, a, b, stuck };
}

describe("a swap's own files busy for a moment", () => {
  it.each(["swap.json", "staged.json"])("%s busy at start: the swap stays held, nothing is deleted or uploaded", async (name) => {
    const { cloud, b, stuck } = await stuckOnModules();
    const version = await remoteVersion(cloud);
    void stuck;
    busyRead = (file) => file === staging(b, name);
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    await next.sync.checkDataFiles();
    expect(next.sync.view()).toMatchObject({ conflict: true, swapUnfinished: true });
    expect(next.sync.dataHeld).toBe(true);
    await next.sync.sync();
    await expect(next.sync.sync(true)).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });
    busyRead = () => false;
    expect(await remoteVersion(cloud)).toBe(version);
    expect(await there(staging(b, "swap.json"))).toBe(true);
    expect(await there(staging(b, "data", "modules"))).toBe(true);

    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b.userData, "modules/dice/m.json")).toBe("dice 2");
    expect(await there(staging(b))).toBe(false);
  });

  it("a journal that can't be understood doesn't drop the swap: it finishes with a new backup", async () => {
    const { cloud, b } = await stuckOnModules();
    await writeFile(staging(b, "swap.json"), "");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.view().swapUnfinished).toBe(false);
    expect(await read(b.userData, "modules/dice/m.json")).toBe("dice 2");
    expect(await workspaces(b)).toEqual(["elden-ring", "hollow-knight"]);
  });

  it("a place that is busy doesn't count as missing while a copy goes in", async () => {
    const at = await pc({ "library.json": "here" });
    const swap = path.join(at.root, "staging");
    await mkdir(swap, { recursive: true });
    await writeFile(path.join(swap, "library.json"), "copy");
    const file = { size: 4, sha256: "0".repeat(64), parts: ["0".repeat(64)] };
    busyStat = (target) => target === path.join(at.userData, "library.json");
    await expect(swapInCopy(swap, at.roots, path.join(at.root, "kept"), { version: 2, pictures: true, files: { "library.json": file } })).rejects.toMatchObject({ code: "EBUSY" });
    busyStat = () => false;
    expect(await read(at.userData, "library.json")).toBe("here");
    expect(await read(swap, "library.json")).toBe("copy");
  });

  it("a file busy while the copy is scanned stops the upload instead of leaving it out", async () => {
    const at = await pc({ "library.json": "{}", "module-data/a.json": "a" });
    busyStat = (target) => target === path.join(at.userData, "module-data", "a.json");
    await expect(scanCopy(at.roots)).rejects.toMatchObject({ code: "EBUSY" });
  });

  it("a file busy while it is read for the upload stops it instead of leaving it out", async () => {
    const at = await pc({ "library.json": "{}", "module-data/a.json": "a" });
    const folder = path.join(at.root, "OneDrive");
    await mkdir(folder);
    busyRead = (target) => target === path.join(at.userData, "module-data", "a.json");
    await expect(new CloudCopy(new FolderStorage(folder)).upload(newCopyKey(), at.roots, EMPTY_STATE)).rejects.toMatchObject({ code: "EBUSY" });
  });
});

describe("going back to this PC's data", () => {
  it("sticks: the newer copy isn't taken again, and the question stays until it is answered", async () => {
    const { cloud, b, stuck } = await stuckOnModules();
    const version = await remoteVersion(cloud);
    await stuck.sync.keep("pc");

    const back = tavora(cloud, b);
    await back.sync.beforeLoad();
    expect(await workspaces(b)).toEqual(["elden-ring"]);
    expect(await read(b.userData, "workspace.json")).toBe('"a1"');
    expect(back.sync.view()).toMatchObject({ conflict: true, swapUnfinished: false, restartToTake: false });
    await back.sync.sync();
    expect(await remoteVersion(cloud)).toBe(version);

    // Later, and another start: still this PC's data, still asking.
    const later = tavora(cloud, b);
    await later.sync.beforeLoad();
    expect(await workspaces(b)).toEqual(["elden-ring"]);
    expect(later.sync.view().conflict).toBe(true);

    await later.sync.keep("pc");
    expect(later.sync.view().conflict).toBe(false);
    expect(await remoteVersion(cloud)).toBeGreaterThan(version!);
    const after = tavora(cloud, b);
    await after.sync.beforeLoad();
    expect(after.sync.view().conflict).toBe(false);
  });

  it("the answer can still be the cloud copy", async () => {
    const { cloud, b, stuck } = await stuckOnModules();
    await stuck.sync.keep("pc");
    const back = tavora(cloud, b);
    await back.sync.beforeLoad();
    await back.sync.keep("cloud");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(await workspaces(b)).toEqual(["elden-ring", "hollow-knight"]);
    expect(next.sync.view().conflict).toBe(false);
  });
});

describe("work done while a swap waited", () => {
  it("says where it is kept, and that backup isn't pruned", async () => {
    const { cloud, a, b, stuck } = await stuckOnModules();
    void stuck;
    // After Later: the app makes a file the swap moved away anew, and the user works in it.
    await mkdir(path.join(b.userData, "modules"), { recursive: true });
    await writeFile(path.join(b.userData, "modules", "edited.json"), "my edit");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    const keptIn = next.sync.changesKeptIn;
    expect(keptIn).not.toBeNull();
    expect(await read(keptIn!, "written-since/modules/edited.json")).toBe("my edit");

    // More copies come and go; this backup stays.
    for (let round = 0; round < 5; round++) {
      await writeFile(path.join(a.userData, "workspace.json"), `"round ${round}"`);
      const atA = tavora(cloud, a);
      await atA.sync.beforeLoad();
      await atA.sync.sync(true);
      await new Promise((resolve) => setTimeout(resolve, 2));
      await tavora(cloud, b).sync.beforeLoad();
    }
    expect(await read(b.userData, "workspace.json")).toBe('"round 4"');
    expect(await read(keptIn!, "written-since/modules/edited.json")).toBe("my edit");
    expect((await readdir(path.join(b.userData, "backups"))).length).toBeLessThanOrEqual(4);
  });

  it("says nothing when nothing was written meanwhile", async () => {
    const { cloud, b } = await stuckOnModules();
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.changesKeptIn).toBeNull();
  });
});

describe("staged files", () => {
  it("are flushed to the disk", async () => {
    const at = await pc({ "library.json": "data" });
    const folder = path.join(at.root, "OneDrive");
    await mkdir(folder);
    const key = newCopyKey();
    const engine = new CloudCopy(new FolderStorage(folder));
    await engine.upload(key, at.roots, EMPTY_STATE);
    const b = await pc({});
    const swap = path.join(b.root, "staging");
    await engine.download(key, b.roots, swap);
    expect(flushed).toContain(path.join(swap, "library.json"));
  });

  it("aren't taken when a power cut left them zero-filled at the right size", async () => {
    const { cloud, b } = await newerCopyWaits();
    const at = tavora(cloud, b);
    await at.sync.beforeLoad();
    // It took the newer copy; another is chosen and waits for the next start.
    await at.sync.restore();
    const staged = staging(b, "data", "workspace.json");
    const size = (await realStat(staged)).size;
    await writeFile(staged, Buffer.alloc(Number(size)));
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(await read(b.userData, "workspace.json")).toBe('"a2"');
  });
});

describe("with the copy off", () => {
  it("a swap that can't be taken back still asks, and the answer settles it", async () => {
    const { cloud, b, stuck } = await stuckOnModules();
    await stuck.sync.turnOff();
    expect(stuck.sync.view()).toMatchObject({ on: false, swapUnfinished: true });

    held = (from) => from.includes(path.join("backups", "cloud-copy-"));
    const failed = tavora(cloud, b);
    await failed.sync.beforeLoad();
    held = () => false;
    expect(failed.sync.view()).toMatchObject({ on: false, conflict: true, swapUnfinished: true });

    await failed.sync.keep("pc");
    expect(failed.events.restarts).toBe(1);
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(await workspaces(b)).toEqual(["elden-ring"]);
    expect(next.sync.view()).toMatchObject({ on: false, conflict: false, swapUnfinished: false });
  });

  it("turning off writes the undo mark before it forgets the copy", async () => {
    const { b, stuck } = await stuckOnModules();
    let stateThere: boolean | undefined;
    onRename = async (_from, to) => {
      if (to === staging(b, "swap.json")) stateThere = await there(path.join(b.userData, "cloud-copy.json"));
    };
    await stuck.sync.turnOff();
    expect(stateThere).toBe(true);
    expect(JSON.parse(await read(staging(b), "swap.json")).undo).toBe(true);
  });
});
