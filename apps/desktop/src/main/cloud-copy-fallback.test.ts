// What a start goes by when what it normally reads is gone or was written by someone else: an older Tavora that took the
// copy up again during a swap or while lost data was asked about, and a swap whose status and plan are both damaged.
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudCopy, copyRoots, EMPTY_STATE, hasLocalChanges, lookCopyState, saveCopyState, scanCopy, type CopyState, type CopyStorage } from "./cloud-copy";
import { CopySync } from "./cloud-copy-sync";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { FolderStorage } from "./copy-folder";
import { readSavedFile } from "./json";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(real.rename) };
});
const realRename = vi.mocked(rename).getMockImplementation()!;
let held: (from: string) => boolean = () => false;
/** A rename that fails with this code (a full disk), or none. */
let failing: (from: string) => string | null = () => null;
/** Runs before a rename onto `to` goes on: what happens meanwhile (the user turning the copy off). */
let meanwhile: (to: string) => Promise<void> = async () => undefined;

beforeEach(() => {
  held = () => false;
  failing = () => null;
  meanwhile = async () => undefined;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (held(String(from))) throw Object.assign(new Error("held"), { code: "EPERM" });
    const code = failing(String(from));
    // As Node's write errors mostly are: with no path that says where.
    if (code) throw Object.assign(new Error(code), { code });
    await meanwhile(String(to));
    return realRename(from, to);
  });
});
afterEach(async () => {
  held = () => false;
  failing = () => null;
  meanwhile = async () => undefined;
  await cleanUp();
});

type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;
const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };
const lib = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const fileOf = (at: Pc, name: string) => (name.startsWith("module-blobs/") ? path.join(at.moduleFiles, ...name.split("/").slice(1)) : path.join(at.userData, ...name.split("/")));
const read = (at: Pc, name: string) => readFile(fileOf(at, name), "utf8").catch(() => "<gone>");
const there = (file: string) => stat(file).then(() => true, () => false);
const stagedOf = (at: Pc, ...names: string[]) => path.join(at.userData, "cloud-copy-staging", "data", ...names);
const stateFile = (at: Pc) => path.join(at.userData, "cloud-copy.json");
const parkedFile = (at: Pc) => path.join(at.userData, "cloud-copy-swapping.json");
const placeFile = (at: Pc) => path.join(at.userData, "cloud-copy-place.json");

function tavora(cloud: Service, at: Pc, root: () => string = () => at.moduleFiles, who = "me") {
  const events = { restarts: 0 };
  const sync = new CopySync({
    userData: at.userData,
    enabled: true,
    files: { root, defaultRoot: () => at.moduleFiles },
    account: { token: () => cloud.token, id: () => who },
    serviceUrl: "http://tavora.test/v1/account",
    fetch: cloud.fetch,
    encryptor,
    restart: () => void events.restarts++,
  });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return { sync, events };
}

/** As host.ts: settle, read the library (setting a damaged one aside), check, save fresh files where missing. */
async function appStart(cloud: Service, at: Pc) {
  const t = tavora(cloud, at);
  await t.sync.beforeLoad();
  await readSavedFile(path.join(at.userData, "library.json"), { version: 2 }).catch(() => undefined);
  await t.sync.checkDataFiles();
  for (const name of ["library.json", "workspace.json", "profile.json"]) {
    const file = path.join(at.userData, name);
    if (!(await there(file))) await writeFile(file, name === "library.json" ? lib() : '{"fresh":true}');
  }
  return t;
}

// B has no module-data of its own: the copy fills a place that was empty.
const A = { "library.json": lib("elden-ring"), "workspace.json": '{"from":"copy"}', "profile.json": '{"name":"copy"}', "modules/dice/m.json": "dice copy", "module-data/x/y.json": "data copy", "module-blobs/official/pic.txt": "pic copy" };
const B = { "library.json": lib("hollow-knight"), "workspace.json": '{"from":"pc"}', "profile.json": '{"name":"pc"}', "modules/dice/m.json": "dice pc", "module-blobs/official/pic.txt": "pic pc", "module-blobs/local/own.txt": "own pc" };
const bHasAll = async (b: Pc) => Object.fromEntries(await Promise.all(Object.keys(B).map(async (name) => [name, await read(b, name)])));

/** A has the copy in a folder (`a0`: A's files, which may name B's folders), B its own data. */
async function setup(a0: (b: Pc) => Record<string, string> = () => A) {
  const cloud = await service();
  const b = await pc(B);
  const a = await pc(a0(b));
  const folder = path.join(a.root, "OneDrive");
  await mkdir(folder);
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn(folder);
  const key = first.sync.accountKey.copyKey()!;
  const storage = new FolderStorage(folder);
  const remote = async () => (await storage.remote())?.version;
  return { cloud, a, b, folder, key, recovery: first.sync.view().recoveryKey!, remote };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** B turns the copy on and chooses it; the next start stops before the module files go in. */
async function stoppedSwap(s: Setup, root?: () => string) {
  const at = tavora(s.cloud, s.b, root);
  await at.sync.beforeLoad();
  await at.sync.turnOn(s.folder);
  await at.sync.enterKey(s.recovery);
  await at.sync.keep("cloud");
  held = (from) => from === stagedOf(s.b, "module-blobs", "official");
  await tavora(s.cloud, s.b, root).sync.beforeLoad();
  held = () => false;
  expect(await read(s.b, "workspace.json")).toBe(A["workspace.json"]);
}

/** The copy as it is in the folder, file by file. */
async function remoteFiles(s: Setup): Promise<Record<string, string>> {
  const dir = path.join(s.b.root, "remote-look");
  await rm(dir, { recursive: true, force: true });
  const copy = await new CloudCopy(new FolderStorage(s.folder)).download(s.key, copyRoots(path.join(dir, "data"), path.join(dir, "files")), path.join(dir, "staged"));
  const files: Record<string, string> = {};
  for (const name of Object.keys(copy?.files ?? {}).sort()) files[name] = await readFile(path.join(dir, "staged", ...name.split("/")), "utf8");
  await rm(dir, { recursive: true, force: true });
  return files;
}

/** 0.24.108 and 0.24.122 at start (as in cloud-copy-crash.test.ts): on only with cloud-copy.json. */
async function olderStart(s: Setup, at: Pc): Promise<"off" | "uploaded" | "asks" | "nothing"> {
  const text = await readFile(stateFile(at), "utf8").catch(() => null);
  if (text === null) return "off";
  const saved = JSON.parse(text) as Record<string, unknown>;
  const state: CopyState = saved.v === 1 && typeof saved.version === "number" && typeof saved.files === "object" && saved.files !== null ? { version: saved.version, pictures: saved.pictures !== false, files: saved.files as CopyState["files"] } : EMPTY_STATE;
  const engine = new CloudCopy(new FolderStorage(s.folder));
  const r = await engine.remote(state.version);
  if (r?.version === state.version) return (await engine.upload(s.key, at.roots, state)).status === "uploaded" ? "uploaded" : "nothing";
  return (await hasLocalChanges(at.roots, state)) ? "asks" : "nothing";
}

/** Turning the copy on in 0.24.122, before the user answers: the staging folder goes, the copy comes down as staged.json. */
async function olderTurnsOn(s: Setup, at: Pc, take = false) {
  const staging = path.join(at.userData, "cloud-copy-staging");
  await rm(staging, { recursive: true, force: true });
  const copy = (await new CloudCopy(new FolderStorage(s.folder)).download(s.key, at.roots, path.join(staging, "data")))!;
  await writeFile(path.join(staging, "staged.json"), JSON.stringify({ v: 1, ...copy, take }));
  await writeFile(stateFile(at), JSON.stringify({ v: 1, ...EMPTY_STATE }));
  await writeFile(path.join(at.userData, "cloud-copy-place.json"), JSON.stringify({ v: 1, folder: s.folder }));
}

/** Keep this PC's in 0.24.122: the copy comes down as a backup, and everything here goes up on top of it. */
async function olderKeepsThisPc(s: Setup, at: Pc) {
  const engine = new CloudCopy(new FolderStorage(s.folder));
  const staging = path.join(at.userData, "cloud-copy-staging");
  await rm(staging, { recursive: true, force: true });
  const copy = (await engine.download(s.key, at.roots, path.join(staging, "data")))!;
  await mkdir(path.join(at.userData, "backups"), { recursive: true });
  await realRename(path.join(staging, "data"), path.join(at.userData, "backups", "cloud-copy-older-cloud"));
  await rm(staging, { recursive: true, force: true });
  const kept = { ...EMPTY_STATE, version: copy.version, kept: true };
  await writeFile(stateFile(at), JSON.stringify({ v: 1, ...kept }));
  const result = await engine.upload(s.key, at.roots, kept);
  if (result.status === "uploaded") await writeFile(stateFile(at), JSON.stringify({ v: 1, ...result.state }));
}

/** Every file's content under a folder. */
async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await filesUnder(full)));
    else out.push(await readFile(full, "utf8"));
  }
  return out;
}

const thisPcBackup = async (b: Pc) => {
  const names = (await readdir(path.join(b.userData, "backups"))).filter((name) => name.endsWith("-this-pc")).sort();
  return path.join(b.userData, "backups", names[0]!);
};

describe("an older Tavora only turned the copy on during a stopped swap", () => {
  it("puts this PC's data back and asks, and Keep this PC's uploads all of it", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    await olderTurnsOn(s, b);
    const back = await appStart(s.cloud, b);
    expect(await bHasAll(b)).toEqual(B);
    expect(await read(b, "module-data/x/y.json")).toBe("<gone>");
    expect(back.sync.view()).toMatchObject({ conflict: true, conflictKind: null });
    await back.sync.keep("pc");
    const up = await remoteFiles(s);
    expect(Object.fromEntries(Object.keys(B).map((name) => [name, up[name]]))).toEqual(B);
    expect(up["module-data/x/y.json"]).toBeUndefined();
  }, 60_000);

  it.each([
    ["where the swap's came from", true],
    ["somewhere else", false],
  ] as const)("keeps what this PC saw of a sealed copy when going back, with the copy %s", async (_, same) => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    // This PC had seen a sealed copy before the swap.
    const parked = JSON.parse(await readFile(parkedFile(b), "utf8")) as Record<string, unknown>;
    await writeFile(parkedFile(b), JSON.stringify({ ...parked, sealed: true }));
    await olderTurnsOn(s, b);
    if (!same) {
      const other = path.join(b.root, "Elsewhere");
      await mkdir(other);
      await writeFile(placeFile(b), JSON.stringify({ v: 1, folder: other }));
    }
    await appStart(s.cloud, b);
    expect(await bHasAll(b)).toEqual(B);
    expect(await there(parkedFile(b))).toBe(false);
    const state = JSON.parse(await readFile(stateFile(b), "utf8")) as { sealed?: boolean };
    expect(state.sealed === true).toBe(same);
  }, 60_000);

  it("keeps nothing of a sealed copy seen under another account", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    const parked = JSON.parse(await readFile(parkedFile(b), "utf8")) as Record<string, unknown>;
    await writeFile(parkedFile(b), JSON.stringify({ ...parked, sealed: true }));
    await olderTurnsOn(s, b);
    // The same place, but another account signed in now: what this PC saw was the other account's copy.
    await tavora(s.cloud, b, undefined, "someone-else").sync.beforeLoad();
    expect(await bHasAll(b)).toEqual(B);
    const state = JSON.parse(await readFile(stateFile(b), "utf8")) as { sealed?: boolean };
    expect(state.sealed).toBeUndefined();
  }, 60_000);

  it("takes the copy when the user chose it there", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    await olderTurnsOn(s, b, true);
    await appStart(s.cloud, b);
    expect(await read(b, "workspace.json")).toBe(A["workspace.json"]);
    expect(await read(b, "module-blobs/official/pic.txt")).toBe(A["module-blobs/official/pic.txt"]);
  }, 60_000);
});

describe("an older Tavora that went on after a stopped swap", () => {
  it("tells where this PC's data from before is, and that backup is never pruned", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    const keepIn = await thisPcBackup(b);
    await olderKeepsThisPc(s, b);
    const back = tavora(s.cloud, b);
    await back.sync.beforeLoad();
    expect(back.sync.dataKeptIn).toBe(keepIn);
    // Newer backups pile up, and Use the cloud copy makes one more.
    for (const n of [1, 2, 3]) {
      await mkdir(path.join(b.userData, "backups", `cloud-copy-2099-01-0${n}T00-00-00-000Z-cloud`), { recursive: true });
      await writeFile(path.join(b.userData, "backups", `cloud-copy-2099-01-0${n}T00-00-00-000Z-cloud`, "library.json"), "old");
    }
    await back.sync.restore();
    await tavora(s.cloud, b).sync.beforeLoad();
    expect(await readFile(path.join(keepIn, "workspace.json"), "utf8")).toBe(B["workspace.json"]);
  }, 60_000);
});

describe("going back to an older Tavora while lost data is asked about", () => {
  async function lost() {
    const s = await setup();
    const { a } = s;
    await appStart(s.cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "{ broken");
    const one = await appStart(s.cloud, a);
    expect(one.sync.view().conflictKind === "lost").toBe(true);
    return { s, one };
  }

  it("finds the copy off, so the fresh library doesn't go up", async () => {
    const { s } = await lost();
    const version = await s.remote();
    expect(await olderStart(s, s.a)).toBe("off");
    expect(await s.remote()).toBe(version);
    // The next start still asks.
    expect((await appStart(s.cloud, s.a)).sync.view().conflictKind === "lost").toBe(true);
  }, 60_000);

  it("parks a state the last version left in place", async () => {
    const { s } = await lost();
    await realRename(parkedFile(s.a), stateFile(s.a));
    expect((await appStart(s.cloud, s.a)).sync.view().conflictKind === "lost").toBe(true);
    expect(await there(stateFile(s.a))).toBe(false);
    expect(await olderStart(s, s.a)).toBe("off");
  }, 60_000);

  it("still finds the copy off once the user chose the cloud copy, until the restart takes it", async () => {
    const { s, one } = await lost();
    const version = await s.remote();
    await one.sync.keep("cloud");
    expect(one.events.restarts).toBe(1);
    // An older Tavora started before the restart: it would upload the fresh library over the copy.
    expect(await olderStart(s, s.a)).toBe("off");
    expect(await s.remote()).toBe(version);
    await appStart(s.cloud, s.a);
    expect(JSON.parse(await read(s.a, "library.json"))).toMatchObject({ workspaces: { "elden-ring": {} } });
  }, 60_000);

  it.each(["pc", "cloud"] as const)("gets the state back in place once answered (%s)", async (side) => {
    const { s, one } = await lost();
    await one.sync.keep(side);
    // A chosen copy keeps it parked until the restart has put it in.
    if (side === "cloud") await appStart(s.cloud, s.a);
    expect(await there(stateFile(s.a))).toBe(true);
    expect(await there(parkedFile(s.a))).toBe(false);
  }, 60_000);
});

describe("a stopped swap whose status and plan are both damaged", () => {
  async function damage(b: Pc) {
    await writeFile(path.join(b.userData, "cloud-copy-status.json"), "{ broken");
    await writeFile(path.join(b.userData, "cloud-copy-staging", "swap-plan.json"), "{ broken");
  }

  it("empties a place the copy filled when going back", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    expect(await read(b, "module-data/x/y.json")).toBe(A["module-data/x/y.json"]);
    await damage(b);
    const one = tavora(s.cloud, b);
    await one.sync.beforeLoad();
    await one.sync.keep("pc");
    const two = tavora(s.cloud, b);
    await two.sync.beforeLoad();
    expect(await read(b, "module-data/x/y.json")).toBe("<gone>");
    await two.sync.keep("pc");
    expect((await remoteFiles(s))["module-data/x/y.json"]).toBeUndefined();
  }, 60_000);

  it("puts this PC's pictures back in its own folder, not the one the copy's library names", async () => {
    const s = await setup((b) => ({ ...A, "library.json": JSON.stringify({ version: 2, workspaces: { "elden-ring": {} }, moduleFilesFolder: path.join(b.root, "other-pc") }) }));
    const { b } = s;
    await writeFile(path.join(b.userData, "library.json"), JSON.stringify({ version: 2, workspaces: { "hollow-knight": {} }, moduleFilesFolder: b.moduleFiles }));
    // As host.ts: the folder the library on disk names when the copy starts.
    const named = () => {
      const saved = JSON.parse(readFileSync(path.join(b.userData, "library.json"), "utf8")) as { moduleFilesFolder?: string };
      const folder = saved.moduleFilesFolder ?? b.moduleFiles;
      return () => folder;
    };
    await stoppedSwap(s, named());
    expect(named()()).toBe(path.join(b.root, "other-pc"));
    await damage(b);
    const one = tavora(s.cloud, b, named());
    await one.sync.beforeLoad();
    await one.sync.keep("pc");
    await tavora(s.cloud, b, named()).sync.beforeLoad();
    expect(await read(b, "module-blobs/official/pic.txt")).toBe(B["module-blobs/official/pic.txt"]);
    expect(await read(b, "module-blobs/local/own.txt")).toBe(B["module-blobs/local/own.txt"]);
  }, 60_000);

  it("puts this PC's pictures back in the default folder when it had no library of its own", async () => {
    const s = await setup((b) => ({ ...A, "library.json": JSON.stringify({ version: 2, workspaces: { "elden-ring": {} }, moduleFilesFolder: path.join(b.root, "other-pc") }) }));
    const { b } = s;
    await rm(path.join(b.userData, "library.json"));
    // As host.ts: the folder the library on disk names, else the default one.
    const named = () => {
      let folder = b.moduleFiles;
      try {
        folder = (JSON.parse(readFileSync(path.join(b.userData, "library.json"), "utf8")) as { moduleFilesFolder?: string }).moduleFilesFolder ?? folder;
      } catch {
        // No library: the default folder.
      }
      return () => folder;
    };
    await stoppedSwap(s, named());
    expect(named()()).toBe(path.join(b.root, "other-pc"));
    await damage(b);
    const one = tavora(s.cloud, b, named());
    await one.sync.beforeLoad();
    await one.sync.keep("pc");
    await tavora(s.cloud, b, named()).sync.beforeLoad();
    expect(await read(b, "module-blobs/official/pic.txt")).toBe(B["module-blobs/official/pic.txt"]);
    expect(await read(b, "module-blobs/local/own.txt")).toBe(B["module-blobs/local/own.txt"]);
  }, 60_000);

  it("reads this PC's folder in the backup as the library does: one too long to be kept counts as none", async () => {
    const s = await setup();
    const { b } = s;
    // library.ts keeps no folder longer than 500 characters: this PC's pictures are in the default folder.
    await writeFile(path.join(b.userData, "library.json"), JSON.stringify({ version: 2, workspaces: { "hollow-knight": {} }, moduleFilesFolder: path.join(b.root, "x".repeat(501)) }));
    await stoppedSwap(s);
    await damage(b);
    const one = tavora(s.cloud, b);
    await one.sync.beforeLoad();
    await one.sync.keep("pc");
    await tavora(s.cloud, b).sync.beforeLoad();
    expect(await read(b, "module-blobs/official/pic.txt")).toBe(B["module-blobs/official/pic.txt"]);
    expect(await read(b, "module-blobs/local/own.txt")).toBe(B["module-blobs/local/own.txt"]);
  }, 60_000);
});

describe("a stopped swap whose list of the incoming copy is gone", () => {
  it.each(["gone", "damaged"] as const)("Use the cloud copy downloads it again (%s), and the next start finishes", async (how) => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    const list = path.join(b.userData, "cloud-copy-staging", "copy-list.json");
    if (how === "gone") await rm(list);
    else await writeFile(list, "{ broken");
    const one = await appStart(s.cloud, b);
    expect(one.sync.view()).toMatchObject({ conflict: true, conflictKind: "unfinished" });
    await one.sync.keep("cloud");
    expect(one.events.restarts).toBe(1);
    const two = await appStart(s.cloud, b);
    expect(two.sync.view()).toMatchObject({ conflict: false, conflictKind: null });
    expect(two.sync.dataHeld).toBe(false);
    for (const name of ["workspace.json", "profile.json", "module-data/x/y.json", "module-blobs/official/pic.txt"] as const) expect(await read(b, name)).toBe(A[name]);
    const keepIn = await thisPcBackup(b);
    expect(await readFile(path.join(keepIn, "workspace.json"), "utf8")).toBe(B["workspace.json"]);
    expect(await readFile(path.join(keepIn, "module-blobs", "official", "pic.txt"), "utf8")).toBe(B["module-blobs/official/pic.txt"]);
  }, 60_000);

  /** A uploads a newer version on top of the copy: `change` its files first; through `storage` (one with a small limit). */
  async function newerFromA(s: Setup, change: Record<string, string>, storage: CopyStorage = new FolderStorage(s.folder)) {
    for (const [name, text] of Object.entries(change)) {
      const file = name.startsWith("module-blobs/") ? path.join(s.a.moduleFiles, ...name.split("/").slice(1)) : path.join(s.a.userData, ...name.split("/"));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, text);
    }
    const state = (await lookCopyState(stateFile(s.a))) as { status: "present"; value: CopyState };
    const result = await new CloudCopy(storage).upload(s.key, s.a.roots, state.value);
    // As A's Tavora keeps it, so A's next version follows this one.
    if (result.status === "uploaded") await saveCopyState(stateFile(s.a), result.state);
    return result;
  }

  it("puts this PC's pictures back when the copy that comes down again has none", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    // This PC's official pictures went into the backup before the stop.
    expect(await read(b, "module-blobs/official/pic.txt")).toBe("<gone>");
    await rm(path.join(b.userData, "cloud-copy-staging", "copy-list.json"));
    // Meanwhile another PC's version is over the limit with pictures, so it goes up without them.
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"copy, later"}');
    const small = (await scanCopy(s.a.roots)).filter((file) => !file.picture).reduce((sum, file) => sum + file.size, 0);
    const limited = Object.create(new FolderStorage(s.folder), { limit: { value: small } }) as CopyStorage;
    expect(await newerFromA(s, {}, limited)).toMatchObject({ status: "uploaded", pictures: false });
    const one = await appStart(s.cloud, b);
    await one.sync.keep("cloud");
    const two = await appStart(s.cloud, b);
    expect(two.sync.view()).toMatchObject({ conflict: false, conflictKind: null });
    expect(await read(b, "workspace.json")).toBe('{"from":"copy, later"}');
    expect(await read(b, "module-blobs/official/pic.txt")).toBe(B["module-blobs/official/pic.txt"]);
    expect(await read(b, "module-blobs/local/own.txt")).toBe(B["module-blobs/local/own.txt"]);
    // The first copy's files that were in place are no one's work: nothing to tell.
    expect(two.sync.changesKeptIn).toBeNull();
  }, 60_000);

  it("going back after the copy came down again empties a place only the newer copy filled", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    await rm(path.join(b.userData, "cloud-copy-staging", "copy-list.json"));
    // Neither this PC nor the first copy has module-owners.json.
    expect(await newerFromA(s, { "module-owners.json": '{"from":"copy, later"}' })).toMatchObject({ status: "uploaded" });
    const one = await appStart(s.cloud, b);
    await one.sync.keep("cloud");
    // The next start stops again, and the user goes back there.
    held = (from) => from === stagedOf(s.b, "module-blobs", "official");
    const stopped = await appStart(s.cloud, b);
    held = () => false;
    expect(await read(b, "module-owners.json")).toBe('{"from":"copy, later"}');
    expect(stopped.sync.view().conflictKind === "unfinished").toBe(true);
    await stopped.sync.keep("pc");
    await appStart(s.cloud, b);
    expect(await bHasAll(b)).toEqual(B);
    expect(await read(b, "module-owners.json")).toBe("<gone>");
  }, 60_000);

  it("says the disk is full when the copy can't come down for that", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    await rm(path.join(b.userData, "cloud-copy-staging", "copy-list.json"));
    const one = await appStart(s.cloud, b);
    failing = (from) => (from.endsWith(path.join("cloud-copy-staging", "incoming")) ? "ENOSPC" : null);
    await expect(one.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.disk-full" });
    expect(one.events.restarts).toBe(0);
  }, 60_000);

  it("turned off while the copy comes down again: no message, no restart, and the forgetting stands", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    await rm(path.join(b.userData, "cloud-copy-staging", "copy-list.json"));
    const one = await appStart(s.cloud, b);
    const answer = one.sync.keep("cloud");
    await one.sync.turnOff();
    await expect(answer).resolves.toBeUndefined();
    expect(one.events.restarts).toBe(0);
    expect(JSON.parse(await readFile(path.join(b.userData, "cloud-copy-status.json"), "utf8"))).toMatchObject({ phase: "undoing" });
    await appStart(s.cloud, b);
    expect(await bHasAll(b)).toEqual(B);
  }, 60_000);

  it("keeps this PC's own file that looks like the first copy's, in a place that copy never reached (T1)", async () => {
    const s = await setup();
    const { b } = s;
    // This PC's picture has the same content as the first copy's.
    await writeFile(path.join(b.moduleFiles, "official", "pic.txt"), A["module-blobs/official/pic.txt"]);
    const at = tavora(s.cloud, b);
    await at.sync.beforeLoad();
    await at.sync.turnOn(s.folder);
    await at.sync.enterKey(s.recovery);
    await at.sync.keep("cloud");
    // The swap stops before this PC's official pictures move: they are still in place.
    held = (from) => from === path.join(b.moduleFiles, "official");
    await tavora(s.cloud, b).sync.beforeLoad();
    held = () => false;
    expect(await read(b, "workspace.json")).toBe(A["workspace.json"]);
    await rm(path.join(b.userData, "cloud-copy-staging", "copy-list.json"));
    expect(await newerFromA(s, { "module-blobs/official/pic.txt": "pic copy, later" })).toMatchObject({ status: "uploaded" });
    const one = await appStart(s.cloud, b);
    await one.sync.keep("cloud");
    const two = await appStart(s.cloud, b);
    expect(two.sync.view()).toMatchObject({ conflict: false, conflictKind: null });
    expect(await read(b, "module-blobs/official/pic.txt")).toBe("pic copy, later");
    // This PC's own picture from before the swap is kept, and the user hears where.
    expect(await filesUnder(path.join(b.userData, "backups"))).toContain(A["module-blobs/official/pic.txt"]);
    expect(two.sync.changesKeptIn).not.toBeNull();
  }, 60_000);

  it.each(["incoming-lists.json", "cloud-copy-status.json"])("turned off just after the copy came down again (at %s): nothing restarts, and the next start goes back (T2)", async (at) => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    await rm(path.join(b.userData, "cloud-copy-staging", "copy-list.json"));
    const one = await appStart(s.cloud, b);
    let off: Promise<void> | null = null;
    meanwhile = async (to) => {
      if (off || !to.endsWith(at)) return;
      off = one.sync.turnOff();
      await off;
    };
    await expect(one.sync.keep("cloud")).resolves.toBeUndefined();
    expect(off).not.toBeNull();
    expect(one.events.restarts).toBe(0);
    expect(JSON.parse(await readFile(path.join(b.userData, "cloud-copy-status.json"), "utf8"))).toMatchObject({ phase: "undoing" });
    const next = await appStart(s.cloud, b);
    expect(await bHasAll(b)).toEqual(B);
    expect(next.sync.view()).toMatchObject({ on: false, conflictKind: null });
  }, 60_000);

  it("keeps this PC's own file once the pictures came back, also after the list is lost a second time (B1-bis)", async () => {
    const s = await setup();
    const { b } = s;
    // This PC's picture looks like the first copy's (A's), and the copy is turned on fresh here.
    await writeFile(path.join(b.moduleFiles, "official", "pic.txt"), A["module-blobs/official/pic.txt"]);
    const at = tavora(s.cloud, b);
    await at.sync.beforeLoad();
    await at.sync.turnOn(s.folder);
    await at.sync.enterKey(s.recovery);
    await at.sync.keep("cloud");
    // A's swap moves everything, then stops at the last state write.
    let parkedWrites = 0;
    meanwhile = async (to) => {
      if (to === parkedFile(b) && ++parkedWrites > 1) throw Object.assign(new Error("held"), { code: "EPERM" });
    };
    await tavora(s.cloud, b).sync.beforeLoad();
    meanwhile = async () => undefined;
    expect(await read(b, "workspace.json")).toBe(A["workspace.json"]);
    const list = path.join(b.userData, "cloud-copy-staging", "copy-list.json");
    await rm(list);
    // Another PC's newer version goes up without pictures (over the limit); this PC takes it.
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"copy B"}');
    const small = (await scanCopy(s.a.roots)).filter((file) => !file.picture).reduce((sum, file) => sum + file.size, 0);
    expect(await newerFromA(s, {}, Object.create(new FolderStorage(s.folder), { limit: { value: small } }) as CopyStorage)).toMatchObject({ status: "uploaded", pictures: false });
    await (await appStart(s.cloud, b)).sync.keep("cloud");
    // That swap takes the pictures back first, then stops at workspace.json.
    held = (from) => from === stagedOf(b, "workspace.json");
    await appStart(s.cloud, b);
    held = () => false;
    expect(await read(b, "module-blobs/official/pic.txt")).toBe(A["module-blobs/official/pic.txt"]);
    // The list is lost again, and a version with pictures comes down.
    await rm(list);
    expect(await newerFromA(s, { "module-blobs/official/pic.txt": "pic copy C" })).toMatchObject({ status: "uploaded" });
    await (await appStart(s.cloud, b)).sync.keep("cloud");
    const done = await appStart(s.cloud, b);
    expect(done.sync.view()).toMatchObject({ conflict: false, conflictKind: null });
    expect(await read(b, "module-blobs/official/pic.txt")).toBe("pic copy C");
    // This PC's own picture is still somewhere, and the user is told where.
    expect(await filesUnder(path.join(b.userData, "backups"))).toContain(A["module-blobs/official/pic.txt"]);
    expect(done.sync.changesKeptIn).not.toBeNull();
  }, 60_000);

  it("turned off while Use the cloud copy writes its answer: nothing is left chosen, and no stale question (should-fix)", async () => {
    const s = await setup();
    const t = await appStart(s.cloud, s.a);
    let off: Promise<void> | null = null;
    meanwhile = async (to) => {
      if (off || !to.endsWith("cloud-copy-status.json")) return;
      off = t.sync.turnOff();
      await off;
    };
    await t.sync.restore();
    expect(off).not.toBeNull();
    expect(t.events.restarts).toBe(0);
    expect(await there(path.join(s.a.userData, "cloud-copy-status.json"))).toBe(false);
    const next = await appStart(s.cloud, s.a);
    expect(next.sync.view()).toMatchObject({ on: false, conflict: false });
    expect(next.sync.dataHeld).toBe(false);
  }, 60_000);

  it("a full drive under the copy's folder is the folder's problem, where another folder can be picked", async () => {
    const s = await setup();
    const t = tavora(s.cloud, s.a);
    await t.sync.beforeLoad();
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"copy, later"}');
    failing = (from) => (from.startsWith(s.folder) ? "ENOSPC" : null);
    await expect(t.sync.sync(true)).rejects.toMatchObject({ key: "cloudCopy.error.folder-locked" });
    expect(t.sync.view().problem).toBe("folder-locked");
  }, 60_000);

  it("can't be downloaded again with the copy off: Keep this PC's is the way out", async () => {
    const s = await setup();
    const { b } = s;
    await stoppedSwap(s);
    await rm(path.join(b.userData, "cloud-copy-staging", "copy-list.json"));
    await rm(path.join(b.userData, "account-key.json"));
    const one = await appStart(s.cloud, b);
    await expect(one.sync.keep("cloud")).rejects.toThrow();
    expect(one.events.restarts).toBe(0);
    await one.sync.keep("pc");
    await appStart(s.cloud, b);
    expect(await bHasAll(b)).toEqual(B);
  }, 60_000);
});
