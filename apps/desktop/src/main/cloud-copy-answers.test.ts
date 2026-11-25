// What a held, damaged or interrupted state must not do: each case came from a review that found it doing so.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopySync, startNotice } from "./cloud-copy-sync";
import { translate } from "../shared/i18n";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { readSavedFile } from "./json";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(real.rename), stat: vi.fn(real.stat), readFile: vi.fn(real.readFile) };
});
const realRename = vi.mocked(rename).getMockImplementation()!;
const realStat = vi.mocked(stat).getMockImplementation()!;
const realRead = vi.mocked(readFile).getMockImplementation()!;
let held: (from: string, to: string) => boolean = () => false;
let busyStat: (file: string) => boolean = () => false;
let busyRead: (file: string) => boolean = () => false;
let offline = false;
let who = "me";

beforeEach(() => {
  held = () => false;
  busyStat = () => false;
  busyRead = () => false;
  offline = false;
  who = "me";
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (held(String(from), String(to))) throw Object.assign(new Error("held"), { code: "EPERM" });
    return realRename(from, to);
  });
  vi.mocked(stat).mockImplementation(((file: string, options: never) => (busyStat(String(file)) ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })) : realStat(file, options))) as never);
  vi.mocked(readFile).mockImplementation(((file: string, options: never) => (busyRead(String(file)) ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })) : realRead(file, options))) as never);
});
afterEach(async () => {
  held = () => false;
  busyStat = () => false;
  busyRead = () => false;
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
    account: { token: () => cloud.token, id: () => who },
    serviceUrl: "http://tavora.test/v1/account",
    fetch: ((input: never, init: never) => (offline ? Promise.reject(new Error("offline")) : cloud.fetch(input, init))) as typeof fetch,
    encryptor,
    restart: () => void events.restarts++,
  });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return { sync, events };
}
const lib = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const read = (at: Pc, name: string) => realRead(path.join(at.userData, name), "utf8") as Promise<string>;
const there = (file: string) => realStat(file).then(() => true, () => false);
const ends = (file: string, ...names: string[]) => file.endsWith(path.join(...names));
const remoteVersion = async (cloud: Service) => (await cloud.client().remote())?.version;
const status = (at: Pc) => path.join(at.userData, "cloud-copy-status.json");
const state = (at: Pc) => path.join(at.userData, "cloud-copy.json");

const A = { "library.json": lib("elden-ring"), "workspace.json": '{"from":"copy"}', "modules/dice/m.json": "dice copy" };
const B = { "library.json": lib("hollow-knight"), "workspace.json": '{"from":"pc"}', "modules/dice/m.json": "dice pc" };

async function chosen() {
  const cloud = await service();
  const a = await pc(A);
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  const key = first.sync.view().recoveryKey!;
  const b = await pc(B);
  const at = tavora(cloud, b);
  await at.sync.beforeLoad();
  await at.sync.turnOn();
  await at.sync.enterKey(key);
  await at.sync.keep("cloud");
  return { cloud, a, b };
}
const isPlace = (file: string, at: Pc, name: string) => file === path.join(at.userData, name);

describe("answering, settling and holding", () => {
  it("damaged state: Use the cloud copy actually takes it", async () => {
    const cloud = await service();
    const a = await pc(A);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    await writeFile(path.join(a.userData, "workspace.json"), '{"from":"local edit"}');
    await writeFile(state(a), "{ broken");
    const one = tavora(cloud, a);
    await one.sync.beforeLoad();
    expect(one.sync.view()).toMatchObject({ conflict: true, conflictKind: "unfinished" });
    await one.sync.keep("cloud");
    expect(one.events.restarts).toBe(1);
    const two = tavora(cloud, a);
    await two.sync.beforeLoad();
    expect(two.sync.view().conflictKind === "unfinished").toBe(false);
    expect(await read(a, "workspace.json")).toBe('{"from":"copy"}');
  }, 60_000);

  it("damaged state during a stuck swap: going back gets out", async () => {
    const { cloud, b } = await chosen();
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    expect(stuck.sync.view().conflictKind === "unfinished").toBe(true);
    held = () => false;
    await writeFile(state(b), "{ broken");
    const one = tavora(cloud, b);
    await one.sync.beforeLoad();
    await one.sync.keep("pc");
    const two = tavora(cloud, b);
    await two.sync.beforeLoad();
    expect(two.sync.view().conflictKind === "unfinished").toBe(false);
    expect(await read(b, "workspace.json")).toBe(B["workspace.json"]);
  }, 60_000);

  it("damaged status mid-swap: Keep this PC must not send half-swapped data up", async () => {
    const { cloud, b } = await chosen();
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    held = () => false;
    const version = await remoteVersion(cloud);
    await writeFile(status(b), "");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    await next.sync.keep("pc").catch(() => undefined);
    // The answer restarts Tavora, and that start settles it.
    expect(next.events.restarts).toBe(1);
    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b, "workspace.json")).toBe(B["workspace.json"]);
    const mixed = (await read(b, "library.json")).includes("elden-ring") && !(await there(path.join(b.userData, "modules", "dice", "m.json")));
    expect({ uploaded: (await remoteVersion(cloud)) !== version, mixedHere: mixed }).toEqual({ uploaded: false, mixedHere: false });
  }, 60_000);

  it("two interruptions, then going back restores every file", async () => {
    const { cloud, b } = await chosen();
    // First run stops at workspace.json, before it moved.
    held = (from) => isPlace(from, b, "workspace.json");
    const one = tavora(cloud, b);
    await one.sync.beforeLoad();
    expect(one.sync.view().conflictKind === "unfinished").toBe(true);
    // Second run gets past it and stops later, at modules.
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    const two = tavora(cloud, b);
    await two.sync.beforeLoad();
    expect(two.sync.view().conflictKind === "unfinished").toBe(true);
    held = () => false;
    await two.sync.keep("pc");
    const three = tavora(cloud, b);
    await three.sync.beforeLoad();
    expect(await read(b, "library.json")).toBe(B["library.json"]);
    expect(await read(b, "workspace.json")).toBe(B["workspace.json"]);
    expect(await read(b, "modules/dice/m.json")).toBe(B["modules/dice/m.json"]);
  }, 60_000);

  it("a busy synced folder at start is not reported as an unfinished swap", async () => {
    const cloud = await service();
    const a = await pc(A);
    const folder = path.join(a.root, "OneDrive");
    await mkdir(folder);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn(folder);
    expect(first.sync.view().on).toBe(true);
    busyStat = (file) => file === folder;
    const next = tavora(cloud, a);
    await next.sync.beforeLoad();
    await next.sync.checkDataFiles();
    expect({ unfinished: next.sync.view().conflictKind === "unfinished", held: next.sync.dataHeld }).toEqual({ unfinished: false, held: false });
  }, 60_000);

  it("a failed answer keeps the hold", async () => {
    const { cloud, b } = await chosen();
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    await tavora(cloud, b).sync.beforeLoad();
    held = () => false;
    await writeFile(status(b), "");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.dataHeld).toBe(true);
    offline = true;
    await next.sync.keep("pc").catch(() => undefined);
    expect(next.sync.dataHeld).toBe(true);
  }, 60_000);

  it("an older Tavora's chosen copy that is broken still holds uploads", async () => {
    const cloud = await service();
    const a = await pc(A);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    const saved = JSON.parse((await realRead(state(a), "utf8")) as string) as { version: number };
    await mkdir(path.join(a.userData, "cloud-copy-staging", "data"), { recursive: true });
    await writeFile(path.join(a.userData, "cloud-copy-staging", "staged.json"), JSON.stringify({ v: 1, version: saved.version, pictures: true, take: true, files: { "library.json": { size: 5, sha256: "0".repeat(64), parts: [] } } }));
    await writeFile(path.join(a.userData, "workspace.json"), '{"from":"bad local"}');
    const next = tavora(cloud, a);
    await next.sync.beforeLoad();
    expect(next.sync.view().conflict || next.sync.dataHeld).toBe(true);
  }, 60_000);

  it("signing out during a held swap still removes the account's key", async () => {
    const { cloud, b } = await chosen();
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    await tavora(cloud, b).sync.beforeLoad();
    held = () => false;
    busyRead = (file) => file === status(b);
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.dataHeld).toBe(true);
    expect(await there(path.join(b.userData, "account-key.json"))).toBe(true);
    await next.sync.signedOut("me").catch(() => undefined);
    expect(await there(path.join(b.userData, "account-key.json"))).toBe(false);
  }, 60_000);

  it("a lost-data question can be answered while another account is signed in", async () => {
    const cloud = await service();
    const a = await pc(A);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    await writeFile(path.join(a.userData, "library.json"), "{ broken");
    const one = tavora(cloud, a);
    await readSavedFile(path.join(a.userData, "library.json"), { version: 2 });
    await one.sync.beforeLoad();
    await one.sync.checkDataFiles();
    expect(one.sync.view().conflictKind === "lost").toBe(true);
    who = "someone-else";
    const two = tavora(cloud, a);
    await two.sync.beforeLoad();
    const asked = two.sync.view().conflict;
    await two.sync.keep("pc").catch(() => undefined);
    expect(asked).toBe(true);
    expect(two.sync.dataHeld).toBe(false);
    expect(two.sync.view().conflict).toBe(false);
  }, 60_000);

  it("a chosen copy waiting while another account is signed in asks, and Keep this PC's lets go of it", async () => {
    const { cloud, b } = await chosen();
    who = "someone-else";
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    // The backups and the Trash purge wait: the user hears why, and how to get out.
    expect(next.sync.dataHeld).toBe(true);
    expect(next.sync.view()).toMatchObject({ conflict: true, conflictKind: "waiting" });
    // Not "signed out": another account is signed in.
    await expect(next.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.otherAccount" });
    await next.sync.keep("pc");
    expect(next.sync.dataHeld).toBe(false);
    expect(next.sync.view()).toMatchObject({ conflict: false, conflictKind: null });
    expect(await read(b, "workspace.json")).toBe(B["workspace.json"]);
    const after = tavora(cloud, b);
    await after.sync.beforeLoad();
    expect(after.sync.dataHeld).toBe(false);
    expect(after.sync.view().conflict).toBe(false);
  }, 60_000);

  it("turning the copy on while a chosen copy waits is refused, and the chosen copy still goes in with its account", async () => {
    const { cloud, b } = await chosen();
    who = "someone-else";
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.view()).toMatchObject({ on: false, conflict: true, conflictKind: "waiting" });
    const staging = path.join(b.userData, "cloud-copy-staging");
    const before = { status: await read(b, "cloud-copy-status.json"), staged: (await readdir(staging, { recursive: true })).sort() };
    // Settings > Turn on, as the other account: the user answers the waiting question first.
    await expect(next.sync.turnOn()).rejects.toMatchObject({ key: "cloudCopy.error.chosenWaiting" });
    expect(next.sync.view()).toMatchObject({ on: false, conflict: true, conflictKind: "waiting" });
    expect(next.sync.dataHeld).toBe(true);
    expect(await read(b, "cloud-copy-status.json")).toBe(before.status);
    expect((await readdir(staging, { recursive: true })).sort()).toEqual(before.staged);
    expect(await there(state(b))).toBe(false);
    // Back with the copy's account, the copy the user chose goes in.
    who = "me";
    const after = tavora(cloud, b);
    await after.sync.beforeLoad();
    expect(await read(b, "workspace.json")).toBe(A["workspace.json"]);
    expect(after.sync.dataHeld).toBe(false);
  }, 60_000);

  it("Keep this PC's over a copy chosen under another account sticks once that account is back", async () => {
    const { cloud, a, b } = await chosen();
    // The chosen copy goes in: B is in step with A's version.
    await tavora(cloud, b).sync.beforeLoad();
    const running = tavora(cloud, b);
    await running.sync.beforeLoad();
    // A saves a newer version, and B chooses it in Settings.
    const atA = tavora(cloud, a);
    await atA.sync.beforeLoad();
    await writeFile(path.join(a.userData, "workspace.json"), '{"from":"copy, later"}');
    await atA.sync.sync(true);
    await running.sync.restore();
    expect(running.events.restarts).toBe(1);
    // Another account is signed in at the restart: the user keeps this PC's data.
    who = "someone-else";
    const other = tavora(cloud, b);
    await other.sync.beforeLoad();
    expect(other.sync.view().conflictKind).toBe("waiting");
    await other.sync.keep("pc");
    // Back with the copy's account and nothing changed here: the copy isn't taken without asking.
    who = "me";
    const back = tavora(cloud, b);
    await back.sync.beforeLoad();
    expect(await read(b, "workspace.json")).toBe(A["workspace.json"]);
    expect(back.sync.view().conflict).toBe(true);
  }, 60_000);

  it("a chosen copy waiting with its key gone doesn't say it is another account's", async () => {
    const { cloud, b } = await chosen();
    await rm(path.join(b.userData, "account-key.json"));
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.dataHeld).toBe(true);
    expect(next.sync.view()).toMatchObject({ conflict: true, conflictKind: null });
  }, 60_000);

  it("a start that kept both kinds of backup names both in one message", () => {
    expect(startNotice(null, null)).toBeNull();
    expect(startNotice("C:/b/1", null)).toEqual({ key: "cloudCopy.notice.keptAside", params: { folder: "C:/b/1" } });
    expect(startNotice(null, "C:/b/2")).toEqual({ key: "cloudCopy.notice.dataKeptAside", params: { folder: "C:/b/2" } });
    const both = startNotice("C:/b/1", "C:/b/2")!;
    for (const language of ["en", "de"] as const) {
      const text = translate(language, both.key, both.params);
      expect(text).toContain("C:/b/1");
      expect(text).toContain("C:/b/2");
    }
  });

  it("a copy whose library isn't JSON can still be taken (as on main)", async () => {
    const cloud = await service();
    const a = await pc({ ...A, "library.json": "not json" });
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    const key = first.sync.view().recoveryKey!;
    const b = await pc(B);
    const at = tavora(cloud, b);
    await at.sync.beforeLoad();
    await at.sync.turnOn();
    await at.sync.enterKey(key);
    await at.sync.keep("cloud");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect({ unfinished: next.sync.view().conflictKind === "unfinished", ws: await read(b, "workspace.json") }).toEqual({ unfinished: false, ws: A["workspace.json"] });
  }, 60_000);

  it("a library lost during a held start must not go up as empty at the next start", async () => {
    const cloud = await service();
    const a = await pc(A);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    const version = await remoteVersion(cloud);
    const libFile = path.join(a.userData, "library.json");
    await writeFile(libFile, "{ broken");
    busyRead = (file) => file === state(a);
    const one = tavora(cloud, a);
    await one.sync.beforeLoad();
    expect(one.sync.dataHeld).toBe(true);
    busyRead = () => false;
    // What Host.create does next: the damaged library is set aside, checked, and a fresh one saved (seenVersion).
    await readSavedFile(libFile, { version: 2 });
    await one.sync.checkDataFiles();
    await writeFile(libFile, lib());
    const two = tavora(cloud, a);
    await two.sync.beforeLoad();
    await two.sync.checkDataFiles();
    await two.sync.sync().catch(() => undefined);
    expect({ uploaded: (await remoteVersion(cloud)) !== version, asks: two.sync.view().conflict }).toEqual({ uploaded: false, asks: true });
  }, 60_000);

  it("the way out of R2 is turning the copy off", async () => {
    const { cloud, b } = await chosen();
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    await tavora(cloud, b).sync.beforeLoad();
    held = () => false;
    await writeFile(state(b), "{ broken");
    const one = tavora(cloud, b);
    await one.sync.beforeLoad();
    await one.sync.turnOff();
    const two = tavora(cloud, b);
    await two.sync.beforeLoad();
    expect(await read(b, "workspace.json")).toBe(B["workspace.json"]);
    expect(two.sync.view().conflictKind === "unfinished").toBe(false);
  }, 60_000);

  it("the real start after a damaged library in the copy: what goes up", async () => {
    const cloud = await service();
    const a = await pc({ ...A, "library.json": "not json" });
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    const key = first.sync.view().recoveryKey!;
    const b = await pc(B);
    const at = tavora(cloud, b);
    await at.sync.beforeLoad();
    await at.sync.turnOn();
    await at.sync.enterKey(key);
    await at.sync.keep("cloud");
    const one = tavora(cloud, b);
    await one.sync.beforeLoad();
    const libFile = path.join(b.userData, "library.json");
    await readSavedFile(libFile, { version: 2 });
    await one.sync.checkDataFiles();
    await writeFile(libFile, lib());
    const version = await remoteVersion(cloud);
    const two = tavora(cloud, b);
    await two.sync.beforeLoad();
    await two.sync.checkDataFiles();
    await two.sync.sync().catch(() => undefined);
    expect(two.sync.view().conflictKind === "lost").toBe(true);
    expect((await remoteVersion(cloud)) === version).toBe(true);
  }, 60_000);
});

describe("the fifth review", () => {
  const plan = (at: Pc) => path.join(at.userData, "cloud-copy-staging", "swap-plan.json");
  const staged = (at: Pc, name: string) => path.join(at.userData, "cloud-copy-staging", "data", name);
  const backupOf = async (at: Pc) => path.join(at.userData, "backups", (await readdir(path.join(at.userData, "backups"))).find((name) => name.endsWith("-this-pc"))!);

  it("going back twice never takes what the app saved for this PC's library", async () => {
    const { cloud, b } = await chosen();
    // The first start stops with the library moved away and the copy's not yet in: the app saves a fresh one there.
    held = (from) => from === staged(b, "library.json");
    await tavora(cloud, b).sync.beforeLoad();
    held = () => false;
    await writeFile(path.join(b.userData, "library.json"), lib());
    // The next one moves that aside as written since, and stops later.
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    const two = tavora(cloud, b);
    await two.sync.beforeLoad();
    held = () => false;
    await two.sync.keep("pc");
    // Going back stops once the library is back.
    held = (from) => from.includes("backups") && ends(from, "workspace.json");
    await tavora(cloud, b).sync.beforeLoad();
    held = () => false;
    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b, "library.json")).toBe(B["library.json"]);
    expect(await read(b, "workspace.json")).toBe(B["workspace.json"]);
  }, 60_000);

  it("a plan left behind by a busy staging folder can't turn Keep this PC's into going back weeks later", async () => {
    const { cloud, b } = await chosen();
    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b, "workspace.json")).toBe(A["workspace.json"]);
    // The swap ended with the staging folder busy: its plan stayed.
    await mkdir(path.dirname(plan(b)), { recursive: true });
    await writeFile(plan(b), JSON.stringify({ keepIn: await backupOf(b), moduleFiles: b.moduleFiles, own: null, empty: [] }));
    await tavora(cloud, b).sync.beforeLoad();
    await writeFile(path.join(b.userData, "workspace.json"), '{"from":"weeks of work"}');
    busyRead = (file) => file === status(b);
    const busyStart = tavora(cloud, b);
    await busyStart.sync.beforeLoad();
    await busyStart.sync.keep("pc").catch(() => undefined);
    busyRead = () => false;
    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b, "workspace.json")).toBe('{"from":"weeks of work"}');
  }, 60_000);

  it.each(["off", "another account"] as const)("a damaged status with the copy %s: Keep this PC's settles it for good", async (how) => {
    const cloud = await service();
    const a = await pc(A);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    if (how === "off") await first.sync.turnOff();
    else {
      who = "someone-else";
      await writeFile(state(a), "{ broken");
    }
    await writeFile(status(a), "{ broken");
    const one = tavora(cloud, a);
    await one.sync.beforeLoad();
    expect(one.sync.dataHeld).toBe(true);
    await one.sync.keep("pc");
    expect(one.sync.dataHeld).toBe(false);
    const two = tavora(cloud, a);
    await two.sync.beforeLoad();
    expect({ held: two.sync.dataHeld, asks: two.sync.view().conflict }).toEqual({ held: false, asks: false });
  }, 60_000);

  it.each(["pc", "cloud", "off"] as const)("a damaged status and plan in a stuck swap have a way out (%s)", async (answer) => {
    const { cloud, b } = await chosen();
    held = (from) => ends(from, "data", "modules") && from.includes("cloud-copy-staging");
    await tavora(cloud, b).sync.beforeLoad();
    held = () => false;
    await writeFile(status(b), "{ broken");
    await writeFile(plan(b), "{ broken");
    const one = tavora(cloud, b);
    await one.sync.beforeLoad();
    expect(one.sync.view().conflictKind === "unfinished").toBe(true);
    if (answer === "off") await one.sync.turnOff();
    else await one.sync.keep(answer);
    const two = tavora(cloud, b);
    await two.sync.beforeLoad();
    const side = answer === "cloud" ? A : B;
    expect({ unfinished: two.sync.view().conflictKind === "unfinished", held: two.sync.dataHeld }).toEqual({ unfinished: false, held: false });
    for (const name of Object.keys(side) as (keyof typeof side)[]) expect(await read(b, name)).toBe(side[name]);
  }, 60_000);
});
