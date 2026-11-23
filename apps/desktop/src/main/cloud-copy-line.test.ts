// The line sealed in each folder manifest: whether a copy grew out of the version a PC last synced is told by it, never by
// file names (which anyone who can write the folder may change, and which clean-up and sync apps take away).
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudCopyView } from "../shared/host-api";

import { CloudCopy, CopyError, EMPTY_STATE, LINE_LENGTH, openManifest, type CopyState, type CopyStorage, type UploadResult } from "./cloud-copy";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { CopySync } from "./cloud-copy-sync";
import { copyKeys, lineMark, newCopyKey, open, seal } from "./copy-crypto";
import { FolderStorage, type FolderStorageOptions } from "./copy-folder";

const folders: string[] = [];
afterEach(async () => {
  await cleanUp();
  for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60_000;
const BLOCK = 2 ** 20;
const HEADER = 16;
const pad = (value: number) => String(value).padStart(16, "0");

async function folder(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-line-"));
  folders.push(dir);
  return dir;
}

/** A folder whose saves get the lowest or the highest version of their block, so which of two saves at once wins is known. */
class Numbered extends FolderStorage {
  constructor(
    folder: string,
    private readonly end: "low" | "high",
    options: FolderStorageOptions = {},
  ) {
    super(folder, options);
  }
  override nextVersion(base: number): number {
    return (Math.floor(base / BLOCK) + 1) * BLOCK + (this.end === "low" ? 0 : BLOCK - 1);
  }
}

/** What a sync app does: copies what one PC's folder has over to the other's, adding only. */
const syncApp = (from: string, to: string) => cp(path.join(from, "Tavora"), path.join(to, "Tavora"), { recursive: true, force: false, errorOnExist: false });

/** A sync app that caught up: `to` holds exactly what `from` holds, deletions too. */
async function mirror(from: string, to: string): Promise<void> {
  await rm(path.join(to, "Tavora"), { recursive: true, force: true });
  await cp(path.join(from, "Tavora"), path.join(to, "Tavora"), { recursive: true });
}

/** Sets the copy's files back by `ms`, parts two days more (a PC writes them first). */
async function age(dir: string, ms: number, now: number) {
  for (const file of await readdir(path.join(dir, "Tavora"), { recursive: true })) {
    const then = new Date(now - ms - (file.startsWith("parts") ? 2 * DAY : 0));
    await utimes(path.join(dir, "Tavora", file), then, then);
  }
}

const manifestsDir = (dir: string) => path.join(dir, "Tavora", "manifests");
const nameOf = async (dir: string, version: number) => (await readdir(manifestsDir(dir))).find((name) => name.startsWith(`${pad(version)}-`));

function uploaded(result: UploadResult): CopyState {
  if (result.status !== "uploaded") throw new Error(result.status);
  return result.state;
}

/** One save of `text` from a PC, on top of `state`. */
async function save(storage: CopyStorage, key: Uint8Array, at: Awaited<ReturnType<typeof pc>>, state: CopyState, text: string, lineLength?: number): Promise<CopyState> {
  await mkdir(at.userData, { recursive: true });
  await writeFile(path.join(at.userData, "library.json"), text);
  return uploaded(await new CloudCopy(storage, lineLength !== undefined ? { lineLength } : {}).upload(key, at.roots, state));
}

/** The opened list of `version` in the folder. */
async function listOf(dir: string, key: Uint8Array, version: number) {
  const body = await readFile(path.join(manifestsDir(dir), (await nameOf(dir, version))!));
  return openManifest(copyKeys(key), body.subarray(HEADER + body.readUInt32BE(12) * 32));
}

/** Makes the list of `version` what a Tavora from before lines wrote: the same list, marked, with no line. */
async function asOlderTavora(dir: string, key: Uint8Array, version: number): Promise<void> {
  const file = path.join(manifestsDir(dir), (await nameOf(dir, version))!);
  const body = await readFile(file);
  const start = HEADER + body.readUInt32BE(12) * 32;
  const keys = copyKeys(key);
  const manifest = JSON.parse(open(keys, body.subarray(start)).toString("utf8")) as Record<string, unknown>;
  delete manifest.line;
  delete manifest.lineMark;
  await writeFile(file, Buffer.concat([body.subarray(0, start), seal(keys, Buffer.from(JSON.stringify(manifest)))]));
}

/** A state an older Tavora's PC would have: it never saw a line. */
const neverListed = ({ listed: _listed, ...state }: CopyState): CopyState => state;

/**
 * Whether a PC that last synced `state` takes the folder's newest copy on its own, as the check at start would
 * (CopySync.fetchNewer): false when it asks ("older").
 */
async function takes(dir: string, key: Uint8Array, state: CopyState, chosen = false): Promise<boolean> {
  const at = await pc();
  try {
    await new CloudCopy(new FolderStorage(dir)).download(key, at.roots, path.join(at.root, "staging"), state.version, { ...state, chosen });
    return true;
  } catch (error) {
    if (error instanceof CopyError && error.reason === "older") return false;
    throw error;
  }
}

describe("the line sealed in each folder list", () => {
  it("names the versions a save grew out of, nearest first, under its own mark", async () => {
    const key = newCopyKey();
    const dir = await folder();
    const a = await pc();
    const k = await save(new FolderStorage(dir), key, a, EMPTY_STATE, "k");
    const a1 = await save(new FolderStorage(dir), key, a, k, "a1");
    const a2 = await save(new FolderStorage(dir), key, a, a1, "a2");
    expect(a2.listed).toBe(true);
    expect((await listOf(dir, key, k.version)).manifest.line).toEqual([]);
    expect((await listOf(dir, key, a2.version)).manifest.line).toEqual([a1.version, k.version]);

    // A line changed inside a list sealed with the key, its marks left as they were: not one Tavora wrote. Nor is one
    // with its line's mark taken away.
    const keys = copyKeys(key);
    const { manifest } = await listOf(dir, key, a2.version);
    expect(() => openManifest(keys, seal(keys, Buffer.from(JSON.stringify({ ...manifest, line: [a1.version, 5] }))))).toThrow(CopyError);
    expect(() => openManifest(keys, seal(keys, Buffer.from(JSON.stringify({ ...manifest, lineMark: undefined }))))).toThrow(CopyError);
    // A line under a right mark of its own, that still isn't one a save has: it doesn't start at the parent, doesn't go
    // down, or a first save names any.
    const marked = (fields: Record<string, unknown>) => {
      const list = { ...manifest, ...fields };
      return seal(keys, Buffer.from(JSON.stringify({ ...list, lineMark: lineMark(keys, JSON.stringify([list.mark, list.line])) })));
    };
    expect(() => openManifest(keys, marked({}))).not.toThrow();
    expect(() => openManifest(keys, marked({ line: [k.version] }))).toThrow(CopyError);
    expect(() => openManifest(keys, marked({ line: [a1.version, a1.version] }))).toThrow(CopyError);
    expect(() => openManifest(keys, marked({ line: [a1.version, a1.version + 1] }))).toThrow(CopyError);
    expect(() => openManifest(keys, marked({ line: [a1.version, 0] }))).toThrow(CopyError);
    const first = (await listOf(dir, key, k.version)).manifest;
    expect(() => openManifest(keys, seal(keys, Buffer.from(JSON.stringify({ ...first, line: [5], lineMark: lineMark(keys, JSON.stringify([first.mark, [5]])) }))))).toThrow(CopyError);
    // Without a mark, whatever line it says is left aside: it is judged as any list without a mark.
    expect(openManifest(keys, seal(keys, Buffer.from(JSON.stringify({ ...manifest, mark: undefined }))))).toMatchObject({ marked: false, listed: false });
  });

  // R1 of #909's review: P saved P1 and lost against A1 on the same K. P1 reached the folder, then P was away. A saved on, and
  // a month later clean-up took K, P1, A1 and A2. The names then break off where a save on top of P1 could be, with P1's
  // own list gone: they said P1 was followed, and P, changed nothing, took A's copy without asking.
  it("asks a PC whose losing save was cleaned up from the folder", { timeout: 30_000 }, async () => {
    const key = newCopyKey();
    const shared = await folder();
    const clock = { now: Date.now() };
    const forA = () => new Numbered(shared, "high", { now: () => clock.now });
    const a = await pc();
    const k = await save(forA(), key, a, EMPTY_STATE, "k");
    const pFolder = await folder();
    await mirror(shared, pFolder);
    const p = await pc();
    const p1 = await save(new Numbered(pFolder, "low"), key, p, k, "p-work");
    let state = await save(forA(), key, a, k, "a1");
    expect(state.version).toBeGreaterThan(p1.version);
    // P1 reaches the folder; P is away.
    await syncApp(pFolder, shared);
    for (let round = 2; round <= 7; round++) {
      if (round === 7) {
        clock.now += 40 * DAY;
        await age(shared, 35 * DAY, clock.now);
      }
      state = await save(forA(), key, a, state, `a${round}`);
    }
    expect(await nameOf(shared, p1.version)).toBeUndefined();
    expect(await nameOf(shared, k.version)).toBeUndefined();
    // P is back, its sync app caught up.
    await mirror(shared, pFolder);
    expect(await new FolderStorage(pFolder).remote()).toMatchObject({ version: state.version });
    expect(await takes(pFolder, key, p1)).toBe(false);
    // The user's own Use the cloud copy takes it.
    expect(await takes(pFolder, key, p1, true)).toBe(true);
  });

  // R5 of #909's review: renaming A1's list from "saved on K" to "saved on P1" put P1 in A's line by name, and P took A2.
  it("asks when a list's name was changed to put this PC's save in another PC's line", async () => {
    const key = newCopyKey();
    const shared = await folder();
    const a = await pc();
    const k = await save(new FolderStorage(shared), key, a, EMPTY_STATE, "k");
    const pFolder = await folder();
    await mirror(shared, pFolder);
    const p = await pc();
    const p1 = await save(new Numbered(pFolder, "low"), key, p, k, "p-work");
    const a1 = await save(new Numbered(shared, "high"), key, a, k, "a1");
    const a2 = await save(new FolderStorage(shared), key, a, a1, "a2");
    await syncApp(pFolder, shared);
    await rename(path.join(manifestsDir(shared), `${pad(a1.version)}-${pad(k.version)}.bin`), path.join(manifestsDir(shared), `${pad(a1.version)}-${pad(p1.version)}.bin`));
    expect(await new FolderStorage(shared).remote()).toMatchObject({ version: a2.version });
    expect(await takes(shared, key, p1)).toBe(false);
    // Nothing else changes for the PCs in A's line.
    expect(await takes(shared, key, a1)).toBe(true);
    expect(await takes(shared, key, k)).toBe(true);
  });

  it("asks the PC whose save lost when two saved at once, and only that one", async () => {
    const key = newCopyKey();
    const [atA, atB] = [await folder(), await folder()];
    const a = await pc();
    const k = await save(new FolderStorage(atA), key, a, EMPTY_STATE, "k");
    await mirror(atA, atB);
    const b = await pc();
    const fromA = await save(new Numbered(atA, "high"), key, a, k, "a1");
    const fromB = await save(new Numbered(atB, "low"), key, b, k, "b1");
    await syncApp(atA, atB);
    await syncApp(atB, atA);
    expect(await new FolderStorage(atB).remote()).toMatchObject({ version: fromA.version });
    expect(await takes(atB, key, fromB)).toBe(false);
    // A PC still at K follows A's save.
    expect(await takes(atB, key, k)).toBe(true);
    // A saves on; B, still at its lost save, is still asked, however its own list is named.
    await save(new FolderStorage(atA), key, a, fromA, "a2");
    await mirror(atA, atB);
    expect(await takes(atB, key, fromB)).toBe(false);
  });

  it("follows a PC as many saves behind as the line holds, and asks one further back", async () => {
    expect(LINE_LENGTH).toBe(256);
    // Eight here, as LINE_LENGTH saves take long: the same rule, at any length.
    const length = 8;
    const key = newCopyKey();
    const dir = await folder();
    const storage = new FolderStorage(dir);
    const a = await pc();
    const k = await save(storage, key, a, EMPTY_STATE, "k", length);
    let state = k;
    for (let round = 1; round <= length; round++) state = await save(storage, key, a, state, `a${round}`, length);
    expect((await listOf(dir, key, state.version)).manifest.line).toHaveLength(length);
    // The PC that synced K was away for as many saves as the line holds: K is the line's last.
    expect(await takes(dir, key, k)).toBe(true);
    // One save more: K is past the line, though its list is still in the folder. Asked, never assumed.
    state = await save(storage, key, a, state, "one more", length);
    expect((await listOf(dir, key, state.version)).manifest.line).toHaveLength(length);
    expect(await nameOf(dir, k.version)).toBeDefined();
    expect(await takes(dir, key, k)).toBe(false);
  });

  it("lets a PC at keptFrom follow the save made over the list it couldn't open", async () => {
    const key = newCopyKey();
    const dir = await folder();
    const a = await pc();
    const k = await save(new FolderStorage(dir), key, a, EMPTY_STATE, "k");
    const f = await save(new FolderStorage(dir), key, a, k, "f");
    // Another PC started over with a key of its own, on top of F.
    const other = await pc();
    const u = await save(new FolderStorage(dir), newCopyKey(), other, { ...f, files: {} }, "junk");
    // P kept its side over that list: its save goes on top of it, and its line on from F.
    const p = await pc();
    const fromP = await save(new FolderStorage(dir), key, p, { ...f, version: u.version, kept: true, keptFrom: f.version }, "p");
    expect((await listOf(dir, key, fromP.version)).manifest.line).toEqual([u.version, f.version, k.version]);
    expect(await takes(dir, key, f)).toBe(true);
    expect(await takes(dir, key, k)).toBe(true);
  });

  it("asks a PC whose last save went with a folder put back, once another PC saved since", async () => {
    const key = newCopyKey();
    const dir = await folder();
    const a = await pc();
    const k = await save(new FolderStorage(dir), key, a, EMPTY_STATE, "k");
    const a1 = await save(new FolderStorage(dir), key, a, k, "a1");
    const a2 = await save(new FolderStorage(dir), key, a, a1, "a2");
    // The folder goes back a day: A2 is gone. C, at A1, saves on, also above A2's number, and its list is renamed to
    // say it was saved on A2.
    await rm(path.join(manifestsDir(dir), (await nameOf(dir, a2.version))!));
    const c = await pc();
    let state = a1;
    for (let round = 1; round <= 2; round++) state = await save(new FolderStorage(dir), key, c, state, `c${round}`);
    expect(state.version).toBeGreaterThan(a2.version);
    const newest = (await nameOf(dir, state.version))!;
    expect(await takes(dir, key, a2)).toBe(false);
    expect(await takes(dir, key, a1)).toBe(true);
    // Its name changed to say it was saved on A2: still asked (the name and the list disagree).
    await rename(path.join(manifestsDir(dir), newest), path.join(manifestsDir(dir), `${pad(state.version)}-${pad(a2.version)}.bin`));
    expect(await takes(dir, key, a2)).toBe(false);
  });

  it("follows a save that went into the folder though the PC stopped before it noted it", async () => {
    const key = newCopyKey();
    const dir = await folder();
    const a = await pc();
    const k = await save(new FolderStorage(dir), key, a, EMPTY_STATE, "k");
    // A's save is in the folder, but A stopped before it wrote its state: it still says K.
    await save(new FolderStorage(dir), key, a, k, "a1");
    expect(await takes(dir, key, k)).toBe(true);
    // A crash halfway through a save leaves parts and no list: nothing changes for anyone.
    await writeFile(path.join(a.userData, "library.json"), "a2");
    const crashing = new FolderStorage(dir);
    crashing.swap = async () => {
      throw new Error("power cut");
    };
    await expect(new CloudCopy(crashing).upload(key, a.roots, k)).rejects.toThrow("power cut");
    expect(await takes(dir, key, k)).toBe(true);
  });

  describe("with PCs on a Tavora from before lines", () => {
    it("follows an older Tavora's save made right on top of the version this PC synced", async () => {
      const key = newCopyKey();
      const dir = await folder();
      const a = await pc();
      const b = await pc();
      const k = await save(new FolderStorage(dir), key, a, EMPTY_STATE, "k");
      const a1 = await save(new FolderStorage(dir), key, a, k, "a1");
      const b2 = await save(new FolderStorage(dir), key, b, a1, "b2");
      await asOlderTavora(dir, key, b2.version);
      expect(await takes(dir, key, a1)).toBe(true);
      // Two of its saves on top: the parents sealed in them lead to A1, so this PC follows, also one that never saw a line.
      const b3 = await save(new FolderStorage(dir), key, b, neverListed(b2), "b3");
      await asOlderTavora(dir, key, b3.version);
      expect(await takes(dir, key, a1)).toBe(true);
      expect(await takes(dir, key, neverListed(a1))).toBe(true);
      expect(await takes(dir, key, k)).toBe(true);
      // A save beside them is not on the way down: asked.
      expect(await takes(dir, key, { ...a1, version: b2.version + 1 })).toBe(false);
      // B2's list gone, they no longer tell: a PC that knows lines, or in a folder that holds one, asks.
      await rm(path.join(manifestsDir(dir), (await nameOf(dir, b2.version))!));
      expect(await takes(dir, key, a1)).toBe(false);
      expect(await takes(dir, key, neverListed(a1))).toBe(false);
    });

    it("asks a PC that knows lines when only older Tavoras' lists are left, one renamed", async () => {
      const key = newCopyKey();
      const shared = await folder();
      const a = await pc();
      const k = await save(new FolderStorage(shared), key, a, EMPTY_STATE, "k");
      const pFolder = await folder();
      await mirror(shared, pFolder);
      const p = await pc();
      const p1 = await save(new Numbered(pFolder, "low"), key, p, k, "p-work");
      expect(p1.listed).toBe(true);
      const o = await pc();
      const o1 = neverListed(await save(new Numbered(shared, "high"), key, o, neverListed(k), "o1"));
      await asOlderTavora(shared, key, o1.version);
      const o2 = neverListed(await save(new FolderStorage(shared), key, o, o1, "o2"));
      await asOlderTavora(shared, key, o2.version);
      await syncApp(pFolder, shared);
      // A writer without the key removes every list with a line, and renames O1 as if saved on P1.
      await rm(path.join(manifestsDir(shared), (await nameOf(shared, k.version))!));
      await rm(path.join(manifestsDir(shared), (await nameOf(shared, p1.version))!));
      await rename(path.join(manifestsDir(shared), (await nameOf(shared, o1.version))!), path.join(manifestsDir(shared), `${pad(o1.version)}-${pad(p1.version)}.bin`));
      expect(await takes(shared, key, p1)).toBe(false);
    });

    it("goes by the names, as before, only where no line was ever seen", async () => {
      const key = newCopyKey();
      const [atA, atB] = [await folder(), await folder()];
      const a = await pc();
      const b = await pc();
      const k = neverListed(await save(new FolderStorage(atA), key, a, EMPTY_STATE, "k"));
      await asOlderTavora(atA, key, k.version);
      await mirror(atA, atB);
      // Two saves at once, by older Tavoras: A's wins.
      const a1 = neverListed(await save(new Numbered(atA, "high"), key, a, k, "a1"));
      const b1 = neverListed(await save(new Numbered(atB, "low"), key, b, k, "b1"));
      await asOlderTavora(atA, key, a1.version);
      await asOlderTavora(atB, key, b1.version);
      const a2 = neverListed(await save(new FolderStorage(atA), key, a, a1, "a2"));
      await asOlderTavora(atA, key, a2.version);
      await syncApp(atA, atB);
      await syncApp(atB, atA);
      // The names lead from A2 back to K, not to B1.
      expect(await takes(atB, key, k)).toBe(true);
      expect(await takes(atB, key, b1)).toBe(false);
    });

    it("carries the line on through an older Tavora's saves, by the parents sealed in them", async () => {
      const key = newCopyKey();
      const dir = await folder();
      const a = await pc();
      const b = await pc();
      const k = await save(new FolderStorage(dir), key, a, EMPTY_STATE, "k");
      const a1 = await save(new FolderStorage(dir), key, a, k, "a1");
      const b2 = await save(new FolderStorage(dir), key, b, a1, "b2");
      await asOlderTavora(dir, key, b2.version);
      const b3 = await save(new FolderStorage(dir), key, b, neverListed(b2), "b3");
      await asOlderTavora(dir, key, b3.version);
      // A, updated, takes B3 (asked, as it can't tell) and saves on top.
      const a4 = await save(new FolderStorage(dir), key, a, { ...b3, files: {} }, "a4");
      expect((await listOf(dir, key, a4.version)).manifest.line).toEqual([b3.version, b2.version, a1.version, k.version]);
      expect(await takes(dir, key, a1)).toBe(true);
      expect(await takes(dir, key, k)).toBe(true);
    });
  });
});

describe("the line, as Tavora runs it", () => {
  const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

  function tavora(at: Awaited<ReturnType<typeof pc>>, folderStorage: (picked: string) => CopyStorage) {
    const views: CloudCopyView[] = [];
    const events = { restarts: 0 };
    const sync = new CopySync({
      userData: at.userData,
      enabled: true,
      files: { root: () => at.moduleFiles },
      account: { token: () => null, id: () => null },
      serviceUrl: "http://tavora.test/v1/account",
      fetch: (() => Promise.reject(new Error("no service"))) as typeof fetch,
      encryptor,
      restart: () => void events.restarts++,
      folderStorage,
    });
    sync.attach({ flush: async () => undefined, onChange: (view) => views.push(view) });
    return { sync, views, events };
  }

  const library = (at: Awaited<ReturnType<typeof pc>>) => readFile(path.join(at.userData, "library.json"), "utf8");
  // The same workspace on every side: a copy that would take every workspace away is asked about anyway (CopySync).
  const workspaces = (name: string) => JSON.stringify({ version: 2, workspaces: { main: {} }, saved: name });

  it("asks a PC whose losing save was cleaned up, at the next start, and Use the cloud copy takes the copy", { timeout: 30_000 }, async () => {
    const clock = { now: Date.now() };
    const [atA, atP] = [await folder(), await folder()];
    const a = await pc({ "library.json": workspaces("k") });
    const fromA = tavora(a, (picked) => new Numbered(picked, "high", { now: () => clock.now }));
    await fromA.sync.beforeLoad();
    await fromA.sync.turnOn(atA);
    const key = fromA.sync.view().recoveryKey!;
    fromA.sync.keySaved();
    await mirror(atA, atP);

    // P takes the copy, then saves its own work while its sync app is stuck.
    const p = await pc({ "library.json": workspaces("k") });
    const forP = (picked: string) => new Numbered(picked, "low", { now: () => clock.now });
    const first = tavora(p, forP);
    await first.sync.beforeLoad();
    await first.sync.turnOn(atP);
    await first.sync.enterKey(key);
    await first.sync.keep("cloud");
    const working = tavora(p, forP);
    await working.sync.beforeLoad();
    await writeFile(path.join(p.userData, "library.json"), workspaces("p-work"));
    await working.sync.sync(true);
    // A saved on K too, with the higher number: P's save lost. It reaches A's folder; P is away.
    await writeFile(path.join(a.userData, "library.json"), workspaces("a1"));
    await fromA.sync.sync(true);
    await syncApp(atP, atA);
    for (let round = 2; round <= 7; round++) {
      if (round === 7) {
        clock.now += 40 * DAY;
        await age(atA, 35 * DAY, clock.now);
      }
      await writeFile(path.join(a.userData, "library.json"), workspaces(`a${round}`));
      await fromA.sync.sync(true);
    }

    // P is back, its folder caught up, nothing changed on it: asked, and its work stays.
    await mirror(atA, atP);
    const back = tavora(p, forP);
    await back.sync.beforeLoad();
    expect(back.sync.view()).toMatchObject({ on: true, conflict: true });
    expect(await library(p)).toBe(workspaces("p-work"));
    // Use the cloud copy: A's copy goes in at the next start.
    await back.sync.keep("cloud");
    expect(back.events.restarts).toBe(1);
    await tavora(p, forP).sync.beforeLoad();
    expect(await library(p)).toBe(workspaces("a7"));
  });
});
