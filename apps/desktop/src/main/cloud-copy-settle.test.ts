// What must hold whatever a start finds: work done during a stuck swap, a chosen copy that can't go in yet, a busy
// file read as "nothing there", and a downgrade halfway through.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopySync } from "./cloud-copy-sync";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, readFile: vi.fn(real.readFile), rename: vi.fn(real.rename), rm: vi.fn(real.rm), stat: vi.fn(real.stat) };
});

const realReadFile = vi.mocked(readFile).getMockImplementation()!;
const realRename = vi.mocked(rename).getMockImplementation()!;
const realRm = vi.mocked(rm).getMockImplementation()!;
const realStat = vi.mocked(stat).getMockImplementation()!;
let held: (from: string, to: string) => boolean = () => false;
let busyRead: (file: string) => boolean = () => false;
let busyStat: (file: string) => boolean = () => false;
let onRm: (target: string) => Promise<void> = async () => undefined;

const busy = (code = "EBUSY") => Object.assign(new Error("busy"), { code });

beforeEach(() => {
  held = () => false;
  busyRead = () => false;
  busyStat = () => false;
  onRm = async () => undefined;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (held(String(from), String(to))) throw busy("EPERM");
    return realRename(from, to);
  });
  vi.mocked(readFile).mockImplementation(((file: string, options: never) => (busyRead(String(file)) ? Promise.reject(busy()) : realReadFile(file, options))) as never);
  vi.mocked(stat).mockImplementation(((file: string, options: never) => (busyStat(String(file)) ? Promise.reject(busy()) : realStat(file, options))) as never);
  vi.mocked(rm).mockImplementation(async (target, options) => {
    await onRm(String(target));
    return realRm(target, options);
  });
});
afterEach(async () => {
  held = () => false;
  busyRead = () => false;
  busyStat = () => false;
  onRm = async () => undefined;
  await cleanUp();
});

const encryptor = { ready: async () => true, isAvailable: () => true, encrypt: async (text: string) => Buffer.from(`sealed:${text}`), decrypt: async (data: Buffer) => data.toString().replace(/^sealed:/, "") };
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
const backupsOf = (at: Pc) => readdir(path.join(at.userData, "backups")).catch(() => [] as string[]);

/** A and B in step on one copy. */
async function inStep(files: Record<string, string> = {}) {
  const cloud = await service();
  const a = await pc({ "library.json": library("elden-ring"), "workspace.json": '"a1"', ...files });
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  const key = first.sync.view().recoveryKey!;
  const b = await pc({ "library.json": library("hades") });
  const atB = tavora(cloud, b);
  await atB.sync.beforeLoad();
  await atB.sync.turnOn();
  await atB.sync.enterKey(key);
  await atB.sync.keep("cloud");
  await tavora(cloud, b).sync.beforeLoad();
  return { cloud, a, b, atA: first.sync };
}

/** A saved a newer copy, which B takes at its next start. */
async function newer(at: Awaited<ReturnType<typeof inStep>>, changes: Record<string, string>) {
  for (const [name, content] of Object.entries(changes)) {
    await mkdir(path.dirname(path.join(at.a.userData, name)), { recursive: true });
    await writeFile(path.join(at.a.userData, name), content);
  }
  await at.atA.sync(true);
}

describe("D1: work done while a swap was stuck", () => {
  it("in a folder the swap hadn't reached: kept as written since, told, and never pruned", async () => {
    const setup = await inStep({ "module-data/notes.json": "one", "module-data/same.json": "same" });
    const { cloud, b } = setup;
    await newer(setup, { "module-data/notes.json": "two", "workspace.json": '"a2"' });

    // The swap can't move B's module-data away.
    const place = path.join(b.userData, "module-data");
    held = (from) => from === place;
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    held = () => false;
    expect(stuck.sync.view()).toMatchObject({ conflict: true, conflictKind: "unfinished" });
    // Later: the user keeps working there.
    await writeFile(path.join(place, "notes.json"), "my work");

    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(await read(b.userData, "module-data/notes.json")).toBe("two");
    const keptIn = next.sync.changesKeptIn;
    expect(keptIn).not.toBeNull();
    expect(await read(keptIn!, "written-since/module-data/notes.json")).toBe("my work");
    // What nobody touched is an ordinary backup, not "their changes".
    expect(await there(path.join(keptIn!, "written-since", "module-data", "same.json"))).toBe(false);

    for (let round = 0; round < 4; round++) {
      await newer(setup, { "workspace.json": `"round ${round}"` });
      await tavora(cloud, b).sync.beforeLoad();
    }
    expect(await read(b.userData, "workspace.json")).toBe('"round 3"');
    expect(await read(keptIn!, "written-since/module-data/notes.json")).toBe("my work");
  });
});

describe("D2: a copy the user chose that can't go in yet", () => {
  it("holds uploads, so the bad data they were escaping doesn't go up", async () => {
    const setup = await inStep();
    const { cloud, b } = setup;
    const version = await remoteVersion(cloud);
    await writeFile(path.join(b.userData, "workspace.json"), '"bad data"');
    const chose = tavora(cloud, b);
    await chose.sync.beforeLoad();
    await chose.sync.restore();
    expect(chose.events.restarts).toBe(1);

    busyStat = (file) => file.startsWith(staging(b, "data")) && file.endsWith("workspace.json");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    await next.sync.checkDataFiles();
    busyStat = () => false;
    expect(next.sync.dataHeld).toBe(true);
    await next.sync.sync();
    await expect(next.sync.sync(true)).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });
    expect(next.sync.holdClose(() => undefined)).toBe(false);
    expect(await remoteVersion(cloud)).toBe(version);

    const after = tavora(cloud, b);
    await after.sync.beforeLoad();
    expect(await read(b.userData, "workspace.json")).toBe('"a1"');
    expect(after.sync.dataHeld).toBe(false);
  });
});

describe("D3: a library that is busy for a moment", () => {
  it("isn't read as no library: the copy stays staged and this PC's settings stay", async () => {
    const setup = await inStep();
    const { cloud, b } = setup;
    await writeFile(path.join(b.userData, "library.json"), JSON.stringify({ version: 2, workspaces: { "elden-ring": {} }, developmentFolders: ["D:\\mine"], moduleFilesFolder: "D:\\pictures" }));
    // Counts as in step, so the copy would be taken by itself.
    const state = JSON.parse(await read(b.userData, "cloud-copy.json"));
    const info = await realStat(path.join(b.userData, "library.json"));
    state.files["library.json"] = { ...state.files["library.json"], size: info.size, mtimeMs: info.mtimeMs };
    await writeFile(path.join(b.userData, "cloud-copy.json"), JSON.stringify(state));
    // A's new copy has none of B's workspaces.
    await newer(setup, { "library.json": library("hollow-knight") });

    busyRead = (file) => file === path.join(b.userData, "library.json");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    busyRead = () => false;
    const saved = JSON.parse(await read(b.userData, "library.json"));
    expect(Object.keys(saved.workspaces)).toEqual(["elden-ring"]);
    expect(saved.developmentFolders).toEqual(["D:\\mine"]);
    expect(saved.moduleFilesFolder).toBe("D:\\pictures");
    expect(next.sync.dataHeld).toBe(true);
    expect(await backupsOf(b)).toHaveLength(1);
  });
});

async function stuckOnModules() {
  const setup = await inStep({ "modules/dice/m.json": "dice" });
  const { cloud, b } = setup;
  await newer(setup, { "library.json": library("elden-ring", "hollow-knight"), "workspace.json": '"a2"', "modules/dice/m.json": "dice 2" });
  held = (from) => from.includes("cloud-copy-staging") && from.endsWith(path.join("data", "modules"));
  const stuck = tavora(cloud, b);
  await stuck.sync.beforeLoad();
  held = () => false;
  expect(stuck.sync.view()).toMatchObject({ conflict: true, conflictKind: "unfinished" });
  return { ...setup, stuck };
}

describe("D4: turning off during a stuck swap", () => {
  it("stops and says so when the mark can't be written, and forgets nothing", async () => {
    const { b, stuck } = await stuckOnModules();
    held = (_from, to) => to === path.join(b.userData, "cloud-copy-status.json");
    await expect(stuck.sync.turnOff()).rejects.toMatchObject({ key: "cloudCopy.error.failed" });
    held = () => false;
    expect(await there(path.join(b.userData, "cloud-copy-swapping.json"))).toBe(true);
    expect(stuck.sync.view().on).toBe(true);
  });
});

describe("D5: going back to an older Tavora during a swap", () => {
  it("leaves it nothing it would act on: no staged list by the old name, and the copy looks off", async () => {
    const { b } = await stuckOnModules();
    expect(await there(staging(b, "staged.json"))).toBe(false);
    // 0.24.122 takes the copy for on when cloud-copy.json is there.
    expect(await there(path.join(b.userData, "cloud-copy.json"))).toBe(false);
    expect(JSON.parse(await read(b.userData, "cloud-copy-swapping.json")).version).toBeTypeOf("number");
  });

  it("gets the state back in the ordinary form once the swap is done", async () => {
    const { cloud, b } = await stuckOnModules();
    await tavora(cloud, b).sync.beforeLoad();
    const saved = JSON.parse(await read(b.userData, "cloud-copy.json"));
    expect(saved.v).toBe(1);
    expect(typeof saved.version).toBe("number");
  });
});

describe("D6: going back after changing nothing", () => {
  it("doesn't call the cloud's files the user's changes, and the backup can be pruned", async () => {
    const setup = await stuckOnModules();
    const { cloud, b, stuck } = setup;
    await stuck.sync.keep("pc");
    const back = tavora(cloud, b);
    await back.sync.beforeLoad();
    expect(back.sync.changesKeptIn).toBeNull();
    const [folder] = await backupsOf(b);
    expect(await there(path.join(b.userData, "backups", folder!, "written-since"))).toBe(false);
  });

  it("keeps only the real work of an old backup when pruning", async () => {
    const setup = await inStep();
    const { cloud, b } = setup;
    const root = path.join(b.userData, "backups");
    const old = path.join(root, "cloud-copy-2020-01-01T00-00-00-000Z-this-pc");
    await mkdir(path.join(old, "written-since"), { recursive: true });
    await writeFile(path.join(old, "written-since", "work.json"), "my work");
    await writeFile(path.join(old, "library.json"), "a whole old library");
    for (let round = 0; round < 4; round++) {
      await newer(setup, { "workspace.json": `"round ${round}"` });
      await tavora(cloud, b).sync.beforeLoad();
    }
    expect(await read(old, "written-since/work.json")).toBe("my work");
    expect(await there(path.join(old, "library.json"))).toBe(false);
  });
});

describe("D7: a state file busy at start", () => {
  it("is held: the sweep, the Trash purge and the backup wait, and nothing goes up", async () => {
    const { cloud, b } = await inStep();
    const version = await remoteVersion(cloud);
    busyRead = (file) => file === path.join(b.userData, "cloud-copy.json");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    busyRead = () => false;
    expect(next.sync.dataHeld).toBe(true);
    await writeFile(path.join(b.userData, "workspace.json"), '"edited"');
    await next.sync.sync();
    expect(await remoteVersion(cloud)).toBe(version);
  });
});

describe("D8: a crash while cleaning up after going back", () => {
  it("can't leave a whole staged copy that the next start takes", async () => {
    const setup = await inStep({ "modules/dice/m.json": "dice" });
    const { cloud, b } = setup;
    await newer(setup, { "library.json": library("elden-ring", "hollow-knight"), "modules/dice/m.json": "dice 2" });
    // B changed something too, and the user chose the cloud copy: it is staged as their choice.
    await writeFile(path.join(b.userData, "workspace.json"), '"edited on b"');
    const asked = tavora(cloud, b);
    await asked.sync.beforeLoad();
    await asked.sync.keep("cloud");
    // It stops at the very first file, so the staged copy is still whole.
    held = (from) => from === staging(b, "data", "library.json");
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    held = () => false;
    expect(stuck.sync.view().conflictKind === "unfinished").toBe(true);
    await stuck.sync.keep("pc");
    // The cleanup is cut off before the staging folder goes.
    onRm = async (target) => {
      if (target !== staging(b)) return;
      throw new Error("power cut");
    };
    const back = tavora(cloud, b);
    await back.sync.beforeLoad();
    onRm = async () => undefined;
    expect(await workspaces(b)).toEqual(["elden-ring"]);

    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(await workspaces(b)).toEqual(["elden-ring"]);
    expect(next.sync.view().conflict).toBe(true);
  });
});
