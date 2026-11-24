import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudCopyView } from "../shared/host-api";

import { CloudCopy, CopyError, EMPTY_STATE, loadCopyState, NewestUnreadable, saveCopyState, swapInCopy, type CopyState } from "./cloud-copy";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { CopySync } from "./cloud-copy-sync";
import { copyKeys, newCopyKey, open, partId, recoveryKey, seal } from "./copy-crypto";
import { FolderStorage, follows, MAX_MANIFEST_FILE, MAX_PART_FILE } from "./copy-folder";

const folders: string[] = [];
afterEach(async () => {
  await cleanUp();
  for (const dir of folders.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A folder the user picked, like their OneDrive. */
async function folder(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-onedrive-"));
  folders.push(dir);
  return dir;
}

/** What a sync app does: copies what one PC's folder has over to the other's. */
async function syncApp(from: string, to: string, only?: "manifests" | "parts"): Promise<void> {
  const root = path.join(from, "Tavora");
  for (const name of only ? [only] : await readdir(root)) await cp(path.join(root, name), path.join(to, "Tavora", name), { recursive: true, force: false, errorOnExist: false });
}

/**
 * Sets the copy's files back by `ms`, as if written that long ago: parts two days before manifests, as a PC writes the
 * parts first and other PCs' clean-up keeps parts written close to a manifest it has seen.
 */
async function age(dir: string, ms: number, now: number) {
  for (const file of await readdir(path.join(dir, "Tavora"), { recursive: true })) {
    const then = new Date(now - ms - (file.startsWith("parts") ? 2 * 24 * 60 * 60_000 : 0));
    await utimes(path.join(dir, "Tavora", file), then, then);
  }
}

const partFiles = async (dir: string) =>
  (await readdir(path.join(dir, "Tavora", "parts"), { recursive: true })).filter((name) => /[0-9a-f]{64}$/.test(name)).map((name) => path.join(dir, "Tavora", "parts", name));
const manifests = async (dir: string) => (await readdir(path.join(dir, "Tavora", "manifests"))).sort();
const read = (dir: string, name: string) => readFile(path.join(dir, name), "utf8");

/**
 * Whether a PC that last synced `state` takes the folder's newest copy on its own, as the check at start would
 * (CopySync.fetchNewer): false when it asks ("older").
 */
async function takes(dir: string, key: Uint8Array, state: CopyState): Promise<boolean> {
  const at = await pc();
  try {
    await new CloudCopy(new FolderStorage(dir)).download(key, at.roots, path.join(at.root, "staging"), state.version, state);
    return true;
  } catch (error) {
    if (error instanceof CopyError && error.reason === "older") return false;
    throw error;
  }
}

describe("the cloud copy in a folder", () => {
  it("takes a PC's data to another PC through the folder, sealed", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const copy = new CloudCopy(new FolderStorage(onedrive));
    const a = await pc({ "library.json": '{"games":["elden-ring"]}', "module-data/m/g/storage.json": "secret notes" });
    const uploaded = await copy.upload(key, a.roots, EMPTY_STATE);
    expect(uploaded).toMatchObject({ status: "uploaded", pictures: true });
    if (uploaded.status !== "uploaded") return;
    expect(await copy.remote()).toMatchObject({ version: uploaded.state.version, size: expect.any(Number) });

    // Nothing in the folder can be read without the key.
    for (const file of await readdir(onedrive, { recursive: true })) {
      const body = await readFile(path.join(onedrive, file)).catch(() => Buffer.alloc(0));
      expect(body.includes("secret notes")).toBe(false);
      expect(body.includes("elden-ring")).toBe(false);
    }

    const b = await pc({ "library.json": "{}" });
    const staging = path.join(b.root, "staging");
    const down = await new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, staging);
    await swapInCopy(staging, b.roots, path.join(b.root, "kept"), down!);
    expect(await read(b.userData, "module-data/m/g/storage.json")).toBe("secret notes");
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(newCopyKey(), b.roots, staging)).rejects.toMatchObject({ reason: "damaged" });
  });

  it("has no size limit, so pictures always come along", async () => {
    const copy = new CloudCopy(new FolderStorage(await folder()));
    expect(copy.storage.limit).toBeNull();
    const a = await pc({ "game-icons/big.png": "x" });
    expect(await copy.upload(newCopyKey(), a.roots, EMPTY_STATE)).toMatchObject({ status: "uploaded", pictures: true });
  });

  it("tells the PC whose save lost when two PCs saved at once", async () => {
    const key = newCopyKey();
    const [atA, atB] = [await folder(), await folder()];
    const a = await pc({ "library.json": "start" });
    const first = await new CloudCopy(new FolderStorage(atA)).upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    await syncApp(atA, atB);

    // Both PCs save on top of the same version before the sync app moves anything.
    await writeFile(path.join(a.userData, "library.json"), "changed on a");
    const fromA = await new CloudCopy(new FolderStorage(atA)).upload(key, a.roots, first.state);
    const b = await pc({ "library.json": "changed on b" });
    const fromB = await new CloudCopy(new FolderStorage(atB)).upload(key, b.roots, first.state);
    if (fromA.status !== "uploaded" || fromB.status !== "uploaded") throw new Error("not uploaded");
    expect(fromA.state.version).not.toBe(fromB.state.version);
    await syncApp(atA, atB);
    await syncApp(atB, atA);

    // Every PC sees the same newest version. The one that lost is told; the winner is not.
    const winner = Math.max(fromA.state.version, fromB.state.version);
    const remoteA = await new FolderStorage(atA).remote();
    const remoteB = await new FolderStorage(atB).remote();
    expect(remoteA?.version).toBe(winner);
    expect(remoteB?.version).toBe(winner);
    expect([await takes(atA, key, fromA.state), await takes(atB, key, fromB.state)].sort()).toEqual([false, true]);
    // And the loser can't save on top either.
    const loser = fromA.state.version === winner ? { at: atB, pc: b, state: fromB.state } : { at: atA, pc: a, state: fromA.state };
    await writeFile(path.join(loser.pc.userData, "library.json"), "again");
    expect(await new CloudCopy(new FolderStorage(loser.at)).upload(key, loser.pc.roots, loser.state)).toEqual({ status: "conflict", version: winner });
  });

  it("waits for parts that are not synced yet instead of calling the copy damaged", async () => {
    const key = newCopyKey();
    const [atA, atB] = [await folder(), await folder()];
    const a = await pc({ "library.json": "from a" });
    await new CloudCopy(new FolderStorage(atA)).upload(key, a.roots, EMPTY_STATE);
    await syncApp(atA, atB, "manifests");
    const b = await pc();
    await expect(new CloudCopy(new FolderStorage(atB)).download(key, b.roots, path.join(b.root, "staging"))).rejects.toMatchObject({ reason: "not-arrived" });
    await syncApp(atA, atB, "parts");
    expect(await new CloudCopy(new FolderStorage(atB)).download(key, b.roots, path.join(b.root, "staging"))).toMatchObject({ pictures: true });
  });

  it("refuses a manifest that poses as another version", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "a" });
    await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    const [name] = await manifests(onedrive);
    const dir = path.join(onedrive, "Tavora", "manifests");
    await rename(path.join(dir, name!), path.join(dir, `0000000099999999-${name!.slice(17)}`));
    const b = await pc();
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, path.join(b.root, "staging"))).rejects.toMatchObject({ reason: "damaged" });
  });

  it("leaves copies a sync app made alone", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "a" });
    const up = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    if (up.status !== "uploaded") throw new Error(up.status);
    const [name] = await manifests(onedrive);
    await cp(path.join(onedrive, "Tavora", "manifests", name!), path.join(onedrive, "Tavora", "manifests", `${name!.replace(".bin", "")} (1).bin`));
    expect(await new FolderStorage(onedrive).remote()).toMatchObject({ version: up.state.version });
  });

  it("cleans up old manifests and parts no one uses, but only once they are old", { timeout: 30_000 }, async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    let now = Date.now();
    const storage = new FolderStorage(onedrive, { now: () => now });
    const a = await pc({ "library.json": "v1" });
    let state = EMPTY_STATE;
    for (let round = 1; round <= 8; round++) {
      await writeFile(path.join(a.userData, "library.json"), `v${round}`);
      const up = await new CloudCopy(storage).upload(key, a.roots, state);
      if (up.status !== "uploaded") throw new Error(up.status);
      state = up.state;
    }
    // All recent: everything stays.
    expect(await manifests(onedrive)).toHaveLength(8);
    const parts = async () => (await readdir(path.join(onedrive, "Tavora", "parts"), { recursive: true })).filter((name) => /[0-9a-f]{64}$/.test(name));
    expect(await parts()).toHaveLength(8);

    // A month and more later: the newest five manifests stay, and the parts only they use.
    now += 40 * 24 * 60 * 60_000;
    await age(onedrive, 35 * 24 * 60 * 60_000, now);
    await writeFile(path.join(a.userData, "library.json"), "v9");
    const up = await new CloudCopy(storage).upload(key, a.roots, state);
    if (up.status !== "uploaded") throw new Error(up.status);
    expect(await manifests(onedrive)).toHaveLength(5);
    // The parts only the dropped manifests used go once this PC has seen them unused for a week.
    expect(await parts()).toHaveLength(9);
    const partOf = (text: string) => partId(copyKeys(key), Buffer.from(text)).toString("hex");
    let last = up.state;
    for (let day = 1; day <= 8; day++) {
      now += 24 * 60 * 60_000;
      await writeFile(path.join(a.userData, "library.json"), `day ${day}`);
      const later = await new CloudCopy(storage).upload(key, a.roots, last);
      if (later.status !== "uploaded") throw new Error(later.status);
      last = later.state;
    }
    expect(await manifests(onedrive)).toHaveLength(5);
    for (const gone of ["v1", "v2", "v3", "v4"]) expect(await parts()).not.toContain(path.join(partOf(gone).slice(0, 2), partOf(gone)));
    const b = await pc();
    await new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"));
    expect(await read(path.join(b.root, "staging"), "library.json")).toBe("day 8");
  });

  it("deletes only its own files, and says so when the folder is gone", async () => {
    const onedrive = await folder();
    await writeFile(path.join(onedrive, "holiday.jpg"), "mine");
    const storage = new FolderStorage(onedrive);
    await new CloudCopy(storage).upload(newCopyKey(), (await pc({ "library.json": "a" })).roots, EMPTY_STATE);
    await storage.remove();
    expect(await readdir(onedrive)).toEqual(["holiday.jpg"]);
    expect(await storage.remote()).toBeNull();

    await expect(new FolderStorage(path.join(onedrive, "unplugged")).remote()).rejects.toMatchObject({ reason: "no-folder" });
  });
});

describe("following a copy's line", () => {
  // Versions as FolderStorage numbers them: each save is in the block above the one it was saved on.
  const B = 2 ** 20;
  const line = [
    { version: 3 * B + 7, base: 2 * B + 3 },
    { version: 2 * B + 9, base: B + 1 },
    { version: 2 * B + 3, base: B + 1 },
    { version: B + 1, base: 0 },
  ];
  it("knows which saves are in the newest version's line", () => {
    expect(follows(line, 3 * B + 7)).toBe(true);
    expect(follows(line, 2 * B + 3)).toBe(true);
    expect(follows(line, B + 1)).toBe(true);
    expect(follows(line, 0)).toBe(true);
    // Saved at the same time as 2B+3, and lost.
    expect(follows(line, 2 * B + 9)).toBe(false);
  });
  it("can't tell about a save that is cleaned up already, and doesn't ask then", () => {
    // B+1 and older are cleaned up: the line breaks off where a save on top of 5 could be, and 5's own manifest is gone.
    expect(follows(line.slice(0, 3), 5)).toBe(true);
  });
  it("tells a save the line went below without reaching it, also when that save's own manifest is gone", () => {
    expect(follows(line, 5)).toBe(false);
    expect(follows([...line, { version: 5, base: 0 }].sort((a, b) => b.version - a.version), 5)).toBe(false);
    // Saved on top of B+1, then gone (the folder was put back); another PC saved on top of B+1 since.
    expect(follows([{ version: 2 * B + 40, base: B + 1 }, { version: B + 1, base: 0 }], 2 * B + 25)).toBe(false);
  });
  it("tells a save another PC's line passed by, though that line's first save is cleaned up", () => {
    // P saved P1 on K while its sync app was stuck; A saved A1 on K too and went on, and A1 is cleaned up since.
    const [K, P1, A1] = [B + 5, 2 * B + 100, 2 * B + 900];
    const theirs = [4 * B + 1, 3 * B + 1].map((version) => ({ version, base: version === 3 * B + 1 ? A1 : version - B }));
    // A1 is in P1's own block: a save beside P1, never on top of it.
    expect(follows([...theirs, { version: P1, base: K }], P1)).toBe(false);
    expect(follows(theirs, P1)).toBe(false);
    // Broken off higher up, where a save on top of P1 could be: P1's own manifest, still there, isn't in the line.
    expect(follows([{ version: 5 * B + 1, base: 4 * B + 1 }, { version: P1, base: K }], P1)).toBe(false);
  });
});

describe("the cloud copy in a folder, as Tavora runs it", () => {
  const encryptor = { ready: async () => true, isAvailable: () => true, encrypt: async (text: string) => Buffer.from(`sealed:${text}`), decrypt: async (data: Buffer) => data.toString().replace(/^sealed:/, "") };

  function tavora(at: Awaited<ReturnType<typeof pc>>, now?: () => number) {
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
      ...(now ? { folderStorage: (picked: string) => new FolderStorage(picked, { now }) } : {}),
    });
    sync.attach({ flush: async () => undefined, onChange: (view) => views.push(view) });
    return { sync, views, events };
  }

  it("works signed out, stays on after signing out, and brings a PC's data to another", async () => {
    const onedrive = await folder();
    const a = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: { "elden-ring": {} } }) });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    const key = atA.sync.view().recoveryKey!;
    expect(atA.sync.view()).toMatchObject({ on: true, folder: onedrive, limit: null, problem: null, copy: { size: expect.any(Number) } });
    await atA.sync.signedOut(null);
    expect(atA.sync.view().on).toBe(true);

    // After a restart it still knows the folder.
    const again = tavora(a);
    await again.sync.beforeLoad();
    expect(again.sync.view()).toMatchObject({ on: true, folder: onedrive });

    const b = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: {} }) });
    const atB = tavora(b);
    await atB.sync.beforeLoad();
    await atB.sync.turnOn(onedrive);
    expect(atB.sync.view().askKey).toBe(true);
    await atB.sync.enterKey(key);
    await atB.sync.keep("cloud");
    expect(atB.events.restarts).toBe(1);
    await tavora(b).sync.beforeLoad();
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toHaveProperty("elden-ring");
  });

  it("moves to another folder with the same key, and the other PCs turn off until turned on there", async () => {
    const [first, second] = [await folder(), await folder()];
    const a = await pc({ "library.json": "from a" });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(first);
    const key = atA.sync.view().recoveryKey!;
    atA.sync.keySaved();

    const b = await pc({ "library.json": "from a" });
    const atB = tavora(b);
    await atB.sync.beforeLoad();
    await atB.sync.turnOn(first);
    await atB.sync.enterKey(key);
    await atB.sync.keep("cloud");
    // The restart takes the copy.
    await tavora(b).sync.beforeLoad();

    await atA.sync.move(second);
    expect(atA.sync.view()).toMatchObject({ on: true, folder: second, problem: null });
    expect(await readdir(first)).toEqual([]);
    // Still the same key: it opens the moved copy.
    const c = await pc();
    const copy = await new CloudCopy(new FolderStorage(second)).download(Buffer.from(atA.sync["key"]!), c.roots, path.join(c.root, "staging"));
    expect(copy).not.toBeNull();
    expect(atA.sync.view().recoveryKey).toBeNull();
    atA.sync.showKey();
    expect(atA.sync.view().recoveryKey).toBe(key);

    // B finds its folder empty at the next start, and turns it on where the copy is now, with the same key.
    const again = tavora(b);
    await again.sync.beforeLoad();
    expect(again.sync.view()).toMatchObject({ on: false, problem: "deleted" });
    await again.sync.turnOn(second);
    await again.sync.enterKey(key);
    expect(again.sync.view()).toMatchObject({ on: true, folder: second });
  });

  it("won't move onto a copy that is there already", async () => {
    const [first, second] = [await folder(), await folder()];
    const other = tavora(await pc({ "library.json": "other" }));
    await other.sync.beforeLoad();
    await other.sync.turnOn(second);
    const atA = tavora(await pc({ "library.json": "a" }));
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(first);
    await expect(atA.sync.move(second)).rejects.toMatchObject({ key: "cloudCopy.error.moveTaken" });
    expect(atA.sync.view()).toMatchObject({ on: true, folder: first });
    expect((await readdir(path.join(first, "Tavora"))).sort()).toEqual(["manifests", "parts"]);
  });

  it("asks before anything comes down at turn-on when the newest list has no mark but the folder holds marked ones", async () => {
    const onedrive = await folder();
    const version = 9_000_000_000_000;
    const forged = JSON.stringify({ v: 1, version, pictures: true, files: [] });
    const a = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: { "elden-ring": {} } }), "module-data/m/g/storage.json": forged });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    const key = atA.sync.view().recoveryKey!;
    const id = partId(copyKeys(Buffer.from(atA.sync["key"]!)), Buffer.from(forged)).toString("hex");
    const header = Buffer.alloc(16);
    header.write("TVC1");
    const [current] = await manifests(onedrive);
    await writeFile(
      path.join(onedrive, "Tavora", "manifests", `${String(version).padStart(16, "0")}-${current!.slice(0, 16)}.bin`),
      Buffer.concat([header, await readFile(path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id))]),
    );

    const b = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: {} }) });
    const atB = tavora(b);
    await atB.sync.beforeLoad();
    await atB.sync.turnOn(onedrive);
    await atB.sync.enterKey(key);
    expect(atB.sync.view()).toMatchObject({ on: true, conflict: true });
    expect(await readdir(path.join(b.userData, "cloud-copy-staging")).catch(() => [])).toEqual([]);
  });

  it("puts this PC's data on top of a newest list its key doesn't open, when the user keeps this PC's, and the list goes later", async () => {
    const onedrive = await folder();
    const clock = { now: Date.now() };
    const a = await pc({ "library.json": "a0" });
    const atA = tavora(a, () => clock.now);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    expect(atA.sync.view()).toMatchObject({ on: true, problem: null });
    // On top of it, a list sealed with another key: another PC that started over, or one planted there.
    const [current] = await manifests(onedrive);
    const top = 9_000_000_000_000;
    const header = Buffer.alloc(16);
    header.write("TVC1");
    const planted = `${String(top).padStart(16, "0")}-${current!.slice(0, 16)}.bin`;
    await writeFile(path.join(onedrive, "Tavora", "manifests", planted), Buffer.concat([header, seal(copyKeys(newCopyKey()), Buffer.from(JSON.stringify({ v: 1, version: top, pictures: true, files: [] })))]));

    // Every save is turned away: the next start asks, and says so once the copy can't be used.
    await writeFile(path.join(a.userData, "library.json"), "a1");
    const again = tavora(a, () => clock.now);
    await again.sync.beforeLoad();
    expect(again.sync.view()).toMatchObject({ conflict: true });
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    expect(again.sync.view()).toMatchObject({ conflict: true, conflictKind: "unreadable" });
    // Keep this PC's replaces another PC's newer copy: without the user's confirmation nothing changes.
    const before = await manifests(onedrive);
    await again.sync.keep("pc");
    expect(again.sync.view()).toMatchObject({ conflict: true, conflictKind: "unreadable" });
    expect(await manifests(onedrive)).toEqual(before);
    // Confirmed: its data goes on top.
    await again.sync.keep("pc", true);
    expect(again.sync.view()).toMatchObject({ conflict: false, conflictKind: null, problem: null });
    const names = await manifests(onedrive);
    expect(Number(names.at(-1)!.slice(0, 16))).toBeGreaterThan(top);
    expect(names.at(-1)!.slice(17, 33)).toBe(String(top).padStart(16, "0"));

    // Five saves and a month later, the list nobody here opens is cleaned up.
    for (let round = 2; round <= 6; round++) {
      await writeFile(path.join(a.userData, "library.json"), `a${round}`);
      await again.sync.sync(true);
    }
    clock.now += 40 * 24 * 60 * 60_000;
    await age(onedrive, 35 * 24 * 60 * 60_000, clock.now);
    await writeFile(path.join(a.userData, "library.json"), "a7");
    await again.sync.sync(true);
    expect(await manifests(onedrive)).not.toContain(planted);
  });

  it("ignores a manifest named near 2^53, saves on, and cleans it up", async () => {
    const onedrive = await folder();
    const a = await pc({ "library.json": "a0" });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    const [current] = await manifests(onedrive);
    const planted = `${String(9_007_199_254_740_000).padStart(16, "0")}-${current!.slice(0, 16)}.bin`;
    const header = Buffer.alloc(16);
    header.write("TVC1");
    await writeFile(path.join(onedrive, "Tavora", "manifests", planted), Buffer.concat([header, Buffer.from("junk")]));
    // No save could get above it: it isn't the copy's newest, and nothing is asked.
    await writeFile(path.join(a.userData, "library.json"), "a1");
    const again = tavora(a);
    await again.sync.beforeLoad();
    expect(again.sync.view()).toMatchObject({ conflict: false, problem: null });
    await again.sync.sync(true);
    const names = await manifests(onedrive);
    expect(names).not.toContain(planted);
    expect(names.every((name) => Number.isSafeInteger(Number(name.slice(0, 16))))).toBe(true);
    expect(await new FolderStorage(onedrive).remote()).toMatchObject({ version: Number(names.at(-1)!.slice(0, 16)) });
  });

  it("gets over a list put there just below the highest version: the save is read, and the next start asks nothing", async () => {
    for (const top of [2 ** 52 - 1, 2 ** 52 - 2 ** 21 - 1]) {
      const onedrive = await folder();
      const a = await pc({ "library.json": "a0" });
      const atA = tavora(a);
      await atA.sync.beforeLoad();
      await atA.sync.turnOn(onedrive);
      const [current] = await manifests(onedrive);
      const planted = `${String(top).padStart(16, "0")}-${current!.slice(0, 16)}.bin`;
      await writeFile(path.join(onedrive, "Tavora", "manifests", planted), "junk");
      await writeFile(path.join(a.userData, "library.json"), "a1");
      const again = tavora(a);
      await again.sync.beforeLoad();
      expect(again.sync.view()).toMatchObject({ conflict: true });
      await again.sync.keep("pc", true);
      // Two saves more: neither hits a wall.
      for (const text of ["a2", "a3"]) {
        await writeFile(path.join(a.userData, "library.json"), text);
        await again.sync.sync(true);
      }
      const names = await manifests(onedrive);
      expect(names).not.toContain(planted);
      const newest = Number(names.at(-1)!.slice(0, 16));
      expect(await new FolderStorage(onedrive).remote()).toMatchObject({ version: newest });
      expect(Number.isSafeInteger(newest)).toBe(true);
      const third = tavora(a);
      await third.sync.beforeLoad();
      expect(third.sync.view()).toMatchObject({ conflict: false, problem: null });
      const b = await pc();
      const staging = path.join(b.root, "staging");
      await new CloudCopy(new FolderStorage(onedrive)).download(Buffer.from(atA.sync["key"]!), b.roots, staging);
      expect(await read(staging, "library.json")).toBe("a3");
    }
  });

  it("never says uploaded for a manifest that isn't there to be read", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "a0" });
    const first = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    const before = new Set(await manifests(onedrive));
    // The sync app takes the new one away as soon as it is written (or it can't be read back).
    const proto = FolderStorage.prototype as unknown as { readManifest: (file: { name: string }) => Promise<unknown> };
    const original = proto.readManifest;
    proto.readManifest = async function (this: unknown, file: { name: string }) {
      if (!before.has(file.name)) throw new CopyError("failed", "a manifest in the folder went away");
      return original.call(this, file);
    };
    try {
      await writeFile(path.join(a.userData, "library.json"), "a1");
      await expect(new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, first.state)).rejects.toMatchObject({ reason: "failed" });
    } finally {
      proto.readManifest = original;
    }
  });

  it("keeps the copy on with its key when the new key is right but that copy can't come down yet", async () => {
    const onedrive = await folder();
    const o = await pc({ "library.json": "o0" });
    const atO = tavora(o);
    await atO.sync.beforeLoad();
    await atO.sync.turnOn(onedrive);
    const oldKey = Buffer.from(atO.sync["key"]!);
    const newKey = newCopyKey();
    const n = await pc({ "library.json": "n0" });
    const [current] = await manifests(onedrive);
    const fromN = await new CloudCopy(new FolderStorage(onedrive)).upload(newKey, n.roots, { ...EMPTY_STATE, version: Number(current!.slice(0, 16)) });
    if (fromN.status !== "uploaded") throw new Error(fromN.status);
    // Its list came, its parts not yet.
    const parked = await folder();
    const newParts = await partFiles(onedrive);
    for (const file of newParts) await rename(file, path.join(parked, path.basename(file)));
    await writeFile(path.join(o.userData, "library.json"), "o1");
    const again = tavora(o);
    await again.sync.beforeLoad();
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    await expect(again.sync.enterOtherKey(recoveryKey(newKey))).rejects.toMatchObject({ key: "cloudCopy.error.not-arrived" });
    expect(again.sync.view()).toMatchObject({ on: true, conflict: true, conflictKind: "unreadable" });
    expect(Buffer.from(again.sync["key"]!).equals(oldKey)).toBe(true);
    // Once they are there, the same key goes through.
    for (const file of newParts) await rename(path.join(parked, path.basename(file)), file);
    await again.sync.enterOtherKey(recoveryKey(newKey));
    expect(Buffer.from(again.sync["key"]!).equals(newKey)).toBe(true);
    expect(again.sync.view()).toMatchObject({ on: true, conflict: true, conflictKind: null });
  });

  it("takes the new key with the copy it brought down, and checks again a newer list that came by the answer", async () => {
    const onedrive = await folder();
    const o = await pc({ "library.json": "o0" });
    const atO = tavora(o);
    await atO.sync.beforeLoad();
    await atO.sync.turnOn(onedrive);
    const newKey = newCopyKey();
    const n = await pc({ "library.json": "n0" });
    const [current] = await manifests(onedrive);
    const fromN = await new CloudCopy(new FolderStorage(onedrive)).upload(newKey, n.roots, { ...EMPTY_STATE, version: Number(current!.slice(0, 16)) });
    if (fromN.status !== "uploaded") throw new Error(fromN.status);
    await writeFile(path.join(o.userData, "library.json"), "o1");
    const again = tavora(o);
    await again.sync.beforeLoad();
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    const reads = { parts: 0 };
    const getParts = FolderStorage.prototype.getParts;
    FolderStorage.prototype.getParts = async function (this: FolderStorage, ids: string[]) {
      reads.parts++;
      return getParts.call(this, ids);
    };
    try {
      await again.sync.enterOtherKey(recoveryKey(newKey));
    } finally {
      FolderStorage.prototype.getParts = getParts;
    }
    // Brought down once, and staged: the question is the ordinary one.
    expect(reads.parts).toBe(1);
    expect(again.sync.view()).toMatchObject({ on: true, conflict: true, conflictKind: null });
    // A list that doesn't open with the new key came meanwhile: Use the cloud copy doesn't take it unchecked.
    const top = 9_000_000_000_000;
    const planted = `${String(top).padStart(16, "0")}-${String(fromN.state.version).padStart(16, "0")}.bin`;
    await writeFile(path.join(onedrive, "Tavora", "manifests", planted), "junk");
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    expect(again.sync.view()).toMatchObject({ conflictKind: "unreadable" });
  });

  it("never leaves the old key's parts noted under the new key when taking it stops halfway", async () => {
    const onedrive = await folder();
    const o = await pc({ "library.json": "o0" });
    const atO = tavora(o);
    await atO.sync.beforeLoad();
    await atO.sync.turnOn(onedrive);
    const oldKey = Buffer.from(atO.sync["key"]!);
    const newKey = newCopyKey();
    const n = await pc({ "library.json": "n0" });
    const [current] = await manifests(onedrive);
    const fromN = await new CloudCopy(new FolderStorage(onedrive)).upload(newKey, n.roots, { ...EMPTY_STATE, version: Number(current!.slice(0, 16)) });
    if (fromN.status !== "uploaded") throw new Error(fromN.status);
    await writeFile(path.join(o.userData, "library.json"), "o1");
    const again = tavora(o);
    await again.sync.beforeLoad();
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    // Writing the state fails: the disk is full.
    const synced = again.sync["state"];
    again.sync["keepState"] = async () => {
      throw Object.assign(new Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
    };
    await expect(again.sync.enterOtherKey(recoveryKey(newKey))).rejects.toMatchObject({ key: "cloudCopy.error.disk-full" });
    // The state is written before the key changes: it didn't get written, so the key stayed, and so did the state, on disk
    // and in memory, with nothing left staged.
    expect(Buffer.from(again.sync["key"]!).equals(oldKey)).toBe(true);
    expect(again.sync["state"]).toBe(synced);
    expect(Object.keys((await loadCopyState(path.join(o.userData, "cloud-copy.json"))).files).length).toBeGreaterThan(0);
    expect(await readdir(path.join(o.userData, "cloud-copy-staging")).catch(() => [])).toEqual([]);
  });

  it("says so when the folder's copy went away before the new key's copy came down", async () => {
    const onedrive = await folder();
    const o = await pc({ "library.json": "o0" });
    const atO = tavora(o);
    await atO.sync.beforeLoad();
    await atO.sync.turnOn(onedrive);
    const oldKey = Buffer.from(atO.sync["key"]!);
    const newKey = newCopyKey();
    const n = await pc({ "library.json": "n0" });
    const [current] = await manifests(onedrive);
    const fromN = await new CloudCopy(new FolderStorage(onedrive)).upload(newKey, n.roots, { ...EMPTY_STATE, version: Number(current!.slice(0, 16)) });
    if (fromN.status !== "uploaded") throw new Error(fromN.status);
    await writeFile(path.join(o.userData, "library.json"), "o1");
    const again = tavora(o);
    await again.sync.beforeLoad();
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    // The key opens the list; by the time its copy is fetched, the folder was emptied.
    const download = CloudCopy.prototype.download;
    CloudCopy.prototype.download = async () => null;
    try {
      await expect(again.sync.enterOtherKey(recoveryKey(newKey))).rejects.toMatchObject({ key: "cloudCopy.error.noCopy" });
    } finally {
      CloudCopy.prototype.download = download;
    }
    expect(Buffer.from(again.sync["key"]!).equals(oldKey)).toBe(true);
  });

  it("puts nothing back once the copy was turned off meanwhile", async () => {
    const onedrive = await folder();
    const a = await pc({ "library.json": "a0" });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    const gone = await partFiles(onedrive);
    for (const file of gone) await rm(file);
    const put = await new CloudCopy(new FolderStorage(onedrive)).heal(Buffer.from(atA.sync["key"]!), a.roots, atA.sync["state"], () => false);
    expect(put).toBe(0);
    expect(await partFiles(onedrive)).toEqual([]);
  });

  it("lets a PC on the old key take the new key of a PC that started over, so the two don't go back and forth", async () => {
    const onedrive = await folder();
    const o = await pc({ "library.json": "o0" });
    const atO = tavora(o);
    await atO.sync.beforeLoad();
    await atO.sync.turnOn(onedrive);
    const oldKey = Buffer.from(atO.sync["key"]!);
    // Another PC started over with a new key: its copy goes on top.
    const newKey = newCopyKey();
    const n = await pc({ "library.json": "n0" });
    const [current] = await manifests(onedrive);
    const fromN = await new CloudCopy(new FolderStorage(onedrive)).upload(newKey, n.roots, { ...EMPTY_STATE, version: Number(current!.slice(0, 16)) });
    if (fromN.status !== "uploaded") throw new Error(fromN.status);

    // The PC on the old key is asked, and told that another PC may have started over.
    await writeFile(path.join(o.userData, "library.json"), "o1");
    const again = tavora(o);
    await again.sync.beforeLoad();
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    expect(again.sync.view()).toMatchObject({ conflict: true, conflictKind: "unreadable" });
    // A key that doesn't open that copy changes nothing: this PC keeps the key it has.
    await expect(again.sync.enterOtherKey(recoveryKey(newCopyKey()))).rejects.toMatchObject({ key: "cloudCopy.error.wrongKey" });
    expect(Buffer.from(again.sync["key"]!).equals(oldKey)).toBe(true);
    expect(again.sync.view()).toMatchObject({ on: true, conflictKind: "unreadable" });
    // The new key: the copy goes on with it, and the user keeps one side as when turning on.
    await again.sync.enterOtherKey(recoveryKey(newKey));
    expect(Buffer.from(again.sync["key"]!).equals(newKey)).toBe(true);
    expect(again.sync.view()).toMatchObject({ on: true, conflict: true, conflictKind: null });
    await again.sync.keep("pc");
    expect(again.sync.view()).toMatchObject({ conflict: false, problem: null });
    // Its side went up under the new key: the PC that started over opens it, nothing unreadable.
    expect(await new CloudCopy(new FolderStorage(onedrive)).download(newKey, n.roots, path.join(n.root, "staging"), fromN.state.version, fromN.state)).toMatchObject({ marked: true });
  });

  it("forgets that the newest copy won't open once an ordinary conflict comes", async () => {
    const onedrive = await folder();
    const a = await pc({ "library.json": "a0" });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    const key = Buffer.from(atA.sync["key"]!);
    const [current] = await manifests(onedrive);
    const planted = `${String(9_000_000_000_000).padStart(16, "0")}-${current!.slice(0, 16)}.bin`;
    await writeFile(path.join(onedrive, "Tavora", "manifests", planted), "junk");
    await writeFile(path.join(a.userData, "library.json"), "a1");
    const again = tavora(a);
    await again.sync.beforeLoad();
    await expect(again.sync.keep("cloud")).rejects.toMatchObject({ key: "cloudCopy.error.unreadable" });
    expect(again.sync.view().conflictKind).toBe("unreadable");
    // The junk goes, and another PC saves a copy that opens: an ordinary question which side to keep.
    await rm(path.join(onedrive, "Tavora", "manifests", planted));
    const b = await pc({ "library.json": "b1" });
    const fromB = await new CloudCopy(new FolderStorage(onedrive)).upload(key, b.roots, { ...EMPTY_STATE, version: Number(current!.slice(0, 16)) });
    if (fromB.status !== "uploaded") throw new Error(fromB.status);
    await again.sync["fetchNewer"](again.sync["turn"]);
    expect(again.sync.view()).toMatchObject({ conflict: true, conflictKind: null });
  });

  it("puts back parts of its own last save that went missing from the folder", async () => {
    const onedrive = await folder();
    const a = await pc({ "library.json": "a0", "module-data/m/g/storage.json": "notes" });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    // Another PC's clean-up took them before it had this save's manifest.
    const gone = await partFiles(onedrive);
    for (const file of gone) await rm(file);
    const again = tavora(a);
    await again.sync.beforeLoad();
    expect((await partFiles(onedrive)).sort()).toEqual(gone.sort());
    const b = await pc();
    expect(await new CloudCopy(new FolderStorage(onedrive)).download(Buffer.from(atA.sync["key"]!), b.roots, path.join(b.root, "staging"))).toMatchObject({ marked: true });
  });

  it("says when the folder can't be used", async () => {
    const atA = tavora(await pc());
    await atA.sync.beforeLoad();
    await expect(atA.sync.turnOn(path.join(await folder(), "not-there"))).rejects.toMatchObject({ key: "cloudCopy.error.no-folder" });
    expect(atA.sync.view()).toMatchObject({ on: false, folder: null });
  });
});

describe("what anyone who can write the folder can do", () => {
  const DAY = 24 * 60 * 60_000;
  const pad = (value: number) => String(value).padStart(16, "0");
  /** Sets every file of the copy back by `ms`, as if written that long ago. */

  it("can't pass a part off as a manifest to a PC that has seen marked ones, though a module shaped it like one", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const storage = new FolderStorage(onedrive);
    // A module saves a file shaped like a list that names nothing: taken as the copy, it would empty every place of it.
    const version = 9_000_000_000_000;
    const forged = JSON.stringify({ v: 1, version, pictures: true, files: [] });
    const a = await pc({ "library.json": "mine", "module-data/m/g/storage.json": forged });
    const up = await new CloudCopy(storage).upload(key, a.roots, EMPTY_STATE);
    if (up.status !== "uploaded") throw new Error(up.status);
    expect(up.state.marked).toBe(true);

    // The part is sealed like every other: put in a manifest's place, as a newer version, it opens with the key.
    const id = partId(copyKeys(key), Buffer.from(forged)).toString("hex");
    const sealed = await readFile(path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id));
    const header = Buffer.alloc(16);
    header.write("TVC1");
    await writeFile(path.join(onedrive, "Tavora", "manifests", `${pad(version)}-${pad(up.state.version)}.bin`), Buffer.concat([header, sealed]));

    // It has no mark: a PC that took or saved a marked one doesn't take it on its own (the user is asked, as for an older list).
    const b = await pc({ "library.json": "mine" });
    await expect(new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"), up.state.version, up.state)).rejects.toMatchObject({ reason: "older" });
    // Nor does a PC that never synced, as the folder holds a marked one. Only the user's own choice takes it.
    await expect(new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"))).rejects.toMatchObject({ reason: "older" });
    expect(await new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"), 0, { chosen: true })).toMatchObject({ version, files: {} });
    // One with a mark that isn't right is damaged, for any PC, also when everything else about it fits its name.
    await rm(path.join(onedrive, "Tavora", "manifests", `${pad(version)}-${pad(up.state.version)}.bin`));
    const marked = JSON.stringify({ v: 1, version, parent: 5, pictures: true, files: [], mark: "AAAA" });
    await writeFile(path.join(a.userData, "module-data/m/g/storage.json"), marked);
    const markedId = partId(copyKeys(key), Buffer.from(marked)).toString("hex");
    const second = await new CloudCopy(storage).upload(key, a.roots, up.state);
    if (second.status !== "uploaded") throw new Error(second.status);
    const markedPart = await readFile(path.join(onedrive, "Tavora", "parts", markedId.slice(0, 2), markedId));
    await writeFile(path.join(onedrive, "Tavora", "manifests", `${pad(version)}-${pad(5)}.bin`), Buffer.concat([header, markedPart]));
    // Earlier lists open with the key, so the key is right and the newest is what's off: asked, never taken.
    await expect(new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"))).rejects.toBeInstanceOf(NewestUnreadable);
    await expect(new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"), 0, { chosen: true })).rejects.toBeInstanceOf(NewestUnreadable);
  });

  it("doesn't take an older copy than the one this PC synced, when newer manifests were deleted or the folder put back", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "v1" });
    const first = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    await writeFile(path.join(a.userData, "library.json"), "v2");
    const second = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, first.state);
    if (second.status !== "uploaded") throw new Error(second.status);
    await rm(path.join(onedrive, "Tavora", "manifests", `${pad(second.state.version)}-${pad(first.state.version)}.bin`));
    // Its own manifest is gone, and the copy is older than it: the user is asked.
    expect(await new FolderStorage(onedrive).remote()).toMatchObject({ version: first.state.version });
    const b = await pc();
    const staging = path.join(b.root, "staging");
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, staging, second.state.version, second.state)).rejects.toMatchObject({ reason: "older" });
    expect(await new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, staging, 0, { ...second.state, chosen: true })).toMatchObject({ version: first.state.version });
  });

  it("asks when the folder was put back and another PC saved since, once or twice", async () => {
    for (const saves of [1, 2]) {
      const key = newCopyKey();
      const onedrive = await folder();
      const a = await pc({ "library.json": "v1" });
      const first = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
      if (first.status !== "uploaded") throw new Error(first.status);
      await writeFile(path.join(a.userData, "library.json"), "v2");
      const second = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, first.state);
      if (second.status !== "uploaded") throw new Error(second.status);
      // OneDrive goes back a day: A's save is gone. PC C, still at the first version, saves on.
      await rm(path.join(onedrive, "Tavora", "manifests", `${pad(second.state.version)}-${pad(first.state.version)}.bin`));
      const c = await pc({ "library.json": "c1" });
      let state = first.state;
      for (let round = 1; round <= saves; round++) {
        await writeFile(path.join(c.userData, "library.json"), `c${round}`);
        const up = await new CloudCopy(new FolderStorage(onedrive)).upload(key, c.roots, state);
        if (up.status !== "uploaded") throw new Error(up.status);
        state = up.state;
      }
      // A's save isn't in the copy's line: A asks (CopySync.fetchNewer), whether C's number is above A's or not.
      expect(await new FolderStorage(onedrive).remote()).toMatchObject({ version: state.version });
      expect(await takes(onedrive, key, second.state)).toBe(false);
    }
  });

  // Whether A's first save numbers above or below P's is random: three runs see both often enough, each a dozen saves.
  it("asks a PC whose sync app was stuck for a month while it saved, once it catches up", { timeout: 30_000 }, async () => {
    for (let round = 0; round < 3; round++) {
      const key = newCopyKey();
      const shared = await folder();
      const clock = { now: Date.now() };
      const storageAt = (dir: string) => new FolderStorage(dir, { now: () => clock.now });
      const a = await pc({ "library.json": "k" });
      const k = await new CloudCopy(storageAt(shared)).upload(key, a.roots, EMPTY_STATE);
      if (k.status !== "uploaded") throw new Error(k.status);
      // P's own folder: its sync app stops bringing anything, and P saves on K.
      const pFolder = await folder();
      await cp(path.join(shared, "Tavora"), path.join(pFolder, "Tavora"), { recursive: true });
      const p = await pc({ "library.json": "p-work" });
      const p1 = await new CloudCopy(storageAt(pFolder)).upload(key, p.roots, k.state);
      if (p1.status !== "uploaded") throw new Error(p1.status);
      // A saves on K too and goes on; a month later its clean-up drops its first saves.
      let state = k.state;
      for (let save = 1; save <= 7; save++) {
        if (save === 7) {
          clock.now += 40 * DAY;
          await age(shared, 35 * DAY, clock.now);
        }
        await writeFile(path.join(a.userData, "library.json"), `a${save}`);
        const up = await new CloudCopy(storageAt(shared)).upload(key, a.roots, state);
        if (up.status !== "uploaded") throw new Error(up.status);
        state = up.state;
      }
      // P's sync app catches up.
      await cp(path.join(shared, "Tavora"), path.join(pFolder, "Tavora"), { recursive: true, force: false });
      expect(await storageAt(pFolder).remote()).toMatchObject({ version: state.version });
      expect(await takes(pFolder, key, p1.state)).toBe(false);
    }
  });

  it("finds the marked manifests behind any number of files put before them", async () => {
    for (const filler of ["junk", "copies"] as const) {
      const key = newCopyKey();
      const keys = copyKeys(key);
      const onedrive = await folder();
      const version = 9_000_000_000_000;
      const forged = JSON.stringify({ v: 1, version, pictures: true, files: [] });
      const a = await pc({ "library.json": "mine", "module-data/m/g/storage.json": forged });
      const up = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
      if (up.status !== "uploaded") throw new Error(up.status);
      const id = partId(keys, Buffer.from(forged)).toString("hex");
      const header = Buffer.alloc(16);
      header.write("TVC1");
      const planted = Buffer.concat([header, await readFile(path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id))]);
      const dir = path.join(onedrive, "Tavora", "manifests");
      await writeFile(path.join(dir, `${pad(version)}-${pad(up.state.version)}.bin`), planted);
      // Ten files between it and the real one: without the key, or the same part again (it opens, and has no mark).
      for (let n = 1; n <= 10; n++) await writeFile(path.join(dir, `${pad(version - n)}-${pad(up.state.version)}.bin`), filler === "junk" ? "junk" : planted);
      // A PC that synced before, with an older Tavora (it never saw a mark), and changed nothing: asked, not taken.
      const b = await pc();
      await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, path.join(b.root, "staging"), up.state.version, { sealed: true })).rejects.toMatchObject({ reason: "older" });
    }
  });

  describe("a list put there high up, that the user kept this PC's side over", () => {
    const plant = (dir: string, version: number, base: number) => writeFile(path.join(dir, "Tavora", "manifests", `${pad(version)}-${pad(base)}.bin`), "junk");
    const keptOver = (state: CopyState, over: number): CopyState => ({ ...state, version: over, kept: true, keptFrom: state.version });
    const up = (onedrive: string, key: Uint8Array, roots: Awaited<ReturnType<typeof pc>>["roots"], state: CopyState) => new CloudCopy(new FolderStorage(onedrive)).upload(key, roots, state);

    for (const junk of [2 ** 47, 2 ** 50, 2 ** 52 - 1]) {
      it(`at ${junk}: another PC's save under it isn't saved over unasked`, async () => {
        const key = newCopyKey();
        const onedrive = await folder();
        const a = await pc({ "library.json": "a0" });
        const b = await pc({ "library.json": "a0" });
        const first = await up(onedrive, key, a.roots, EMPTY_STATE);
        if (first.status !== "uploaded") throw new Error(first.status);
        await writeFile(path.join(b.userData, "library.json"), "B's work");
        const fromB = await up(onedrive, key, b.roots, first.state);
        if (fromB.status !== "uploaded") throw new Error(fromB.status);
        await plant(onedrive, junk, first.state.version);
        await writeFile(path.join(a.userData, "library.json"), "A's work");
        const fromA = await up(onedrive, key, a.roots, keptOver(first.state, junk));
        const remote = await new FolderStorage(onedrive).remote();
        // Either A is asked and B's save stays the newest one that opens, or A went on top and B is asked.
        if (fromA.status === "conflict") expect(remote!.version === fromB.state.version || !(await takes(onedrive, key, fromB.state))).toBe(true);
        else expect(await takes(onedrive, key, fromB.state)).toBe(false);
      });

      it(`at ${junk}: two PCs that both kept their side over it don't save over each other unasked`, async () => {
        const key = newCopyKey();
        const onedrive = await folder();
        const a = await pc({ "library.json": "a0" });
        const c = await pc({ "library.json": "a0" });
        const first = await up(onedrive, key, a.roots, EMPTY_STATE);
        if (first.status !== "uploaded") throw new Error(first.status);
        await plant(onedrive, junk, first.state.version);
        await writeFile(path.join(a.userData, "library.json"), "A's work");
        await writeFile(path.join(c.userData, "library.json"), "C's work");
        expect((await up(onedrive, key, a.roots, keptOver(first.state, junk))).status).toBe("uploaded");
        expect((await up(onedrive, key, c.roots, keptOver(first.state, junk))).status).toBe("conflict");
      });
    }

    it("asks on a start over on top of a list just below 2^52, and removes nothing", async () => {
      const key = newCopyKey();
      const onedrive = await folder();
      const a = await pc({ "library.json": "a0" });
      const first = await up(onedrive, key, a.roots, EMPTY_STATE);
      if (first.status !== "uploaded") throw new Error(first.status);
      await plant(onedrive, 2 ** 52 - 1, first.state.version);
      const before = await manifests(onedrive);
      // Another PC starts over on top of the newest: no save could go above it.
      const n = await pc({ "library.json": "n0" });
      expect(await up(onedrive, newCopyKey(), n.roots, { ...EMPTY_STATE, version: 2 ** 52 - 1 })).toMatchObject({ status: "conflict", version: 2 ** 52 - 1 });
      expect(await manifests(onedrive)).toEqual(before);
    });

    it("removes nothing on a start over above 2^48, and the new key's copy goes on top", async () => {
      const key = newCopyKey();
      const onedrive = await folder();
      const a = await pc({ "library.json": "a0" });
      const first = await up(onedrive, key, a.roots, EMPTY_STATE);
      if (first.status !== "uploaded") throw new Error(first.status);
      await plant(onedrive, 2 ** 48 - 1, first.state.version);
      await writeFile(path.join(a.userData, "library.json"), "a1");
      const s1 = await up(onedrive, key, a.roots, keptOver(first.state, 2 ** 48 - 1));
      if (s1.status !== "uploaded") throw new Error(s1.status);
      await writeFile(path.join(a.userData, "library.json"), "a2");
      const s2 = await up(onedrive, key, a.roots, s1.state);
      if (s2.status !== "uploaded") throw new Error(s2.status);
      // Another PC starts over: its copy under a new key, on top of the newest, with nothing kept over.
      const n = await pc({ "library.json": "n0" });
      const started = await up(onedrive, newCopyKey(), n.roots, { ...EMPTY_STATE, version: s2.state.version });
      expect(started.status).toBe("uploaded");
      const left = (await manifests(onedrive)).map((name) => Number(name.slice(0, 16)));
      expect(left).toEqual(expect.arrayContaining([s1.state.version, s2.state.version]));
    });

    it("never removes this key's lists above 2^48, only ones it doesn't open", async () => {
      const key = newCopyKey();
      const onedrive = await folder();
      const a = await pc({ "library.json": "a0" });
      const first = await up(onedrive, key, a.roots, EMPTY_STATE);
      if (first.status !== "uploaded") throw new Error(first.status);
      // Saves on top of a list put there just below 2^48 climb on it, to above 2^48.
      await plant(onedrive, 2 ** 48 - 1, first.state.version);
      await writeFile(path.join(a.userData, "library.json"), "a1");
      const s1 = await up(onedrive, key, a.roots, keptOver(first.state, 2 ** 48 - 1));
      if (s1.status !== "uploaded") throw new Error(s1.status);
      await writeFile(path.join(a.userData, "library.json"), "a2");
      const s2 = await up(onedrive, key, a.roots, s1.state);
      if (s2.status !== "uploaded") throw new Error(s2.status);
      const real = [s1.state.version, s2.state.version];
      expect(real.every((version) => version > 2 ** 48)).toBe(true);
      // Then one near the top, kept over too: only it goes.
      await plant(onedrive, 2 ** 52 - 1, s2.state.version);
      await writeFile(path.join(a.userData, "library.json"), "a3");
      const s3 = await up(onedrive, key, a.roots, keptOver(s2.state, 2 ** 52 - 1));
      expect(s3.status).toBe("uploaded");
      const left = (await manifests(onedrive)).map((name) => Number(name.slice(0, 16)));
      expect(left).toEqual(expect.arrayContaining(real));
      expect(left).not.toContain(2 ** 52 - 1);
    });
  });

  it("never reuses parts noted under another key", async () => {
    const onedrive = await folder();
    const oldKey = newCopyKey();
    const a = await pc({ "library.json": "a0", "profile.json": "same profile" });
    const first = await new CloudCopy(new FolderStorage(onedrive)).upload(oldKey, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    const newKey = newCopyKey();
    const n = await pc({ "library.json": "n0" });
    const fromN = await new CloudCopy(new FolderStorage(onedrive)).upload(newKey, n.roots, { ...EMPTY_STATE, version: first.state.version });
    if (fromN.status !== "uploaded") throw new Error(fromN.status);
    // This PC's state still notes the old key's parts (a crash while the key changed), and it saves under the new key.
    await writeFile(path.join(a.userData, "library.json"), "a1");
    const kept = await new CloudCopy(new FolderStorage(onedrive)).upload(newKey, a.roots, { ...first.state, version: fromN.state.version, kept: true });
    expect(kept.status).toBe("uploaded");
    const c = await pc();
    expect(await new CloudCopy(new FolderStorage(onedrive)).download(newKey, c.roots, path.join(c.root, "staging"), 0, { chosen: true })).toMatchObject({ files: { "profile.json": expect.anything() } });
  });

  it("counts a save as done when its list is only held for a moment when read back", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "a0" });
    const first = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    const before = new Set(await manifests(onedrive));
    const proto = FolderStorage.prototype as unknown as { readManifest: (file: { name: string }) => Promise<unknown> };
    const original = proto.readManifest;
    proto.readManifest = async function (this: unknown, file: { name: string }) {
      if (!before.has(file.name)) throw new CopyError("folder-locked", "something in the cloud copy folder can't be read right now");
      return original.call(this, file);
    };
    let saved: Awaited<ReturnType<CloudCopy["upload"]>>;
    try {
      await writeFile(path.join(a.userData, "library.json"), "a1");
      saved = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, first.state);
    } finally {
      proto.readManifest = original;
    }
    expect(saved.status).toBe("uploaded");
    if (saved.status !== "uploaded") return;
    // The next save goes on top of it, never into "both changed".
    await writeFile(path.join(a.userData, "library.json"), "a2");
    expect(await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, saved.state)).toMatchObject({ status: "uploaded" });
  });

  it("can't rename a manifest to say it was saved on top of another version", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "v1" });
    const first = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    await writeFile(path.join(a.userData, "library.json"), "v2");
    const second = await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, first.state);
    if (second.status !== "uploaded") throw new Error(second.status);
    const dir = path.join(onedrive, "Tavora", "manifests");
    const newest = `${pad(second.state.version)}-${pad(first.state.version)}.bin`;
    await rename(path.join(dir, newest), path.join(dir, `${pad(second.state.version)}-${pad(0)}.bin`));
    const b = await pc();
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, path.join(b.root, "staging"))).rejects.toBeInstanceOf(NewestUnreadable);
  });

  it("still reads a manifest an older Tavora wrote, and cleans up around it", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    let now = Date.now();
    const storage = new FolderStorage(onedrive, { now: () => now });
    const a = await pc({ "library.json": "old" });
    // As Tavora 0.24.133 wrote it: no parent, no mark.
    const content = Buffer.from("old");
    const keys = copyKeys(key);
    const id = partId(keys, content);
    await storage.putParts([{ id, data: seal(keys, content) }]);
    const sha256 = createHash("sha256").update(content).digest("hex");
    const list = seal(keys, Buffer.from(JSON.stringify({ v: 1, version: 7, pictures: true, files: [{ path: "library.json", size: 3, sha256, parts: [id.toString("hex")] }] })));
    expect(await storage.swap(0, 7, [id.toString("hex")], list)).toMatchObject({ status: "saved", version: 7 });
    const b = await pc();
    const taken = await new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"));
    expect(taken).toMatchObject({ version: 7, sealed: true });
    expect(taken?.marked).toBeUndefined();
    expect(await read(path.join(b.root, "staging"), "library.json")).toBe("old");

    // Saved over by this Tavora five times and a month on, it goes with the part only it used.
    let state = { ...EMPTY_STATE, version: 7 };
    for (let round = 1; round <= 5; round++) {
      await writeFile(path.join(a.userData, "library.json"), `new ${round}`);
      const up = await new CloudCopy(storage).upload(key, a.roots, state);
      if (up.status !== "uploaded") throw new Error(up.status);
      state = up.state;
      if (round === 4) {
        now += 40 * DAY;
        await age(onedrive, 35 * DAY, now);
      }
    }
    expect(await manifests(onedrive)).toHaveLength(5);
    const oldPart = path.join(onedrive, "Tavora", "parts", id.toString("hex").slice(0, 2), id.toString("hex"));
    expect(await partFiles(onedrive)).toContain(oldPart);
    for (let day = 1; day <= 8; day++) {
      now += DAY;
      await writeFile(path.join(a.userData, "library.json"), `day ${day}`);
      const later = await new CloudCopy(storage).upload(key, a.roots, state);
      if (later.status !== "uploaded") throw new Error(later.status);
      state = later.state;
    }
    expect(await partFiles(onedrive)).not.toContain(oldPart);
  });

  it("can't swap one part for another", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "mine", "module-data/m/g/storage.json": "notes" });
    await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    const [first, second] = await partFiles(onedrive);
    const [one, two] = [await readFile(first!), await readFile(second!)];
    await writeFile(first!, two);
    await writeFile(second!, one);
    const b = await pc();
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, path.join(b.root, "staging"))).rejects.toMatchObject({ reason: "damaged" });
  });

  it("can't make the clean-up delete parts a manifest still uses by trimming the ids outside its seal", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    let now = Date.now();
    const storage = new FolderStorage(onedrive, { now: () => now });
    const a = await pc({ "library.json": "v1" });
    const first = await new CloudCopy(storage).upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    await writeFile(path.join(a.userData, "library.json"), "v2");
    const second = await new CloudCopy(storage).upload(key, a.roots, first.state);
    if (second.status !== "uploaded") throw new Error(second.status);
    expect(await partFiles(onedrive)).toHaveLength(2);

    // Weeks later the older manifest, kept as one of the newest five, says outside its seal that it uses no parts.
    now += 40 * DAY;
    await age(onedrive, 35 * DAY, now);
    const [older] = await manifests(onedrive);
    const file = path.join(onedrive, "Tavora", "manifests", older!);
    const body = await readFile(file);
    await writeFile(file, Buffer.concat([body.subarray(0, 12), Buffer.alloc(4), body.subarray(16 + body.readUInt32BE(12) * 32)]));
    await age(onedrive, 35 * DAY, now);

    await writeFile(path.join(a.userData, "library.json"), "v3");
    const third = await new CloudCopy(storage).upload(key, a.roots, second.state);
    if (third.status !== "uploaded") throw new Error(third.status);
    // Its part stays: what the clean-up deletes it learns from inside the seal.
    expect(await partFiles(onedrive)).toHaveLength(3);
    expect(await manifests(onedrive)).toHaveLength(3);
  });

  it("reads no manifest or part bigger than the format allows, and writes none", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const a = await pc({ "library.json": "mine" });
    await new CloudCopy(new FolderStorage(onedrive)).upload(key, a.roots, EMPTY_STATE);
    const b = await pc();
    const staging = path.join(b.root, "staging");
    const [part] = await partFiles(onedrive);
    const real = await readFile(part!);
    await truncate(part!, MAX_PART_FILE + 1);
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, staging)).rejects.toMatchObject({ reason: "damaged", message: expect.stringContaining("bigger") });
    await writeFile(part!, real);
    const [name] = await manifests(onedrive);
    await truncate(path.join(onedrive, "Tavora", "manifests", name!), MAX_MANIFEST_FILE + 1);
    // Not read: as the newest, it is one that doesn't open.
    expect((await new FolderStorage(onedrive).manifest())?.sealed).toHaveLength(0);
    expect(await new FolderStorage(onedrive).remote()).toMatchObject({ size: 0 });
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, staging)).rejects.toMatchObject({ reason: "damaged" });

    // Nor does it write one no Tavora would read.
    const empty = await folder();
    expect(await new FolderStorage(empty).swap(0, null, [], Buffer.alloc(MAX_MANIFEST_FILE))).toMatchObject({ status: "too-big" });
    expect(await readdir(empty)).toEqual([]);
  });

  /** Six saves of this Tavora, a month and more ago; the next save cleans up. */
  async function sixOldSaves() {
    const key = newCopyKey();
    const onedrive = await folder();
    const clock = { now: Date.now() };
    const storage = new FolderStorage(onedrive, { now: () => clock.now });
    const a = await pc({ "library.json": "v0" });
    let state = EMPTY_STATE;
    const versions: { version: number; base: number }[] = [];
    for (let round = 1; round <= 6; round++) {
      await writeFile(path.join(a.userData, "library.json"), `v${round}`);
      const up = await new CloudCopy(storage).upload(key, a.roots, state);
      if (up.status !== "uploaded") throw new Error(up.status);
      versions.push({ version: up.state.version, base: state.version });
      state = up.state;
    }
    clock.now += 40 * DAY;
    await age(onedrive, 35 * DAY, clock.now);
    const saved = { state };
    const saveAgain = async (content = "v7") => {
      await writeFile(path.join(a.userData, "library.json"), content);
      const up = await new CloudCopy(storage).upload(key, a.roots, saved.state);
      if (up.status !== "uploaded") throw new Error(up.status);
      saved.state = up.state;
    };
    /** A save a day for eight days: parts seen unused before then have waited a week (each look counts the day since the one before). */
    const aWeekOn = async () => {
      for (let day = 1; day <= 8; day++) {
        clock.now += DAY;
        await saveAgain(`day ${day}`);
      }
    };
    /** Where the part of a library holding `text` is. */
    const partOf = (text: string) => {
      const id = partId(copyKeys(key), Buffer.from(text)).toString("hex");
      return path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id);
    };
    const manifestFile = (at: number) => path.join(onedrive, "Tavora", "manifests", `${pad(versions[at]!.version)}-${pad(versions[at]!.base)}.bin`);
    return { key, onedrive, clock, storage, a, state, versions, saveAgain, aWeekOn, partOf, manifestFile };
  }

  it("cleans up as before when nothing was changed", async () => {
    const { onedrive, saveAgain, aWeekOn, partOf } = await sixOldSaves();
    await saveAgain();
    expect(await manifests(onedrive)).toHaveLength(5);
    // The two dropped manifests' parts are seen unused now, and stay for a week.
    expect(await partFiles(onedrive)).toHaveLength(7);
    await aWeekOn();
    expect(await manifests(onedrive)).toHaveLength(5);
    for (const gone of ["v1", "v2"]) expect(await partFiles(onedrive)).not.toContain(partOf(gone));
    expect(await partFiles(onedrive)).toContain(partOf("day 8"));
  });

  it("doesn't count a clock that jumps ahead as the week a part waits", async () => {
    const { key, onedrive, clock, storage, saveAgain } = await sixOldSaves();
    const keys = copyKeys(key);
    const content = Buffer.from("written by a PC whose manifest is on its way");
    const id = partId(keys, content).toString("hex");
    await storage.putParts([{ id: partId(keys, content), data: seal(keys, content) }]);
    await saveAgain();
    // The clock jumps eight days ahead, twice: each save after a jump counts three days, so the part has waited six.
    const file = path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id);
    clock.now += 8 * DAY;
    await saveAgain("v8");
    clock.now += 60_000;
    await saveAgain("v9");
    clock.now += 8 * DAY;
    await saveAgain("v10");
    expect(await partFiles(onedrive)).toContain(file);
    // A third: nine days, and it goes.
    clock.now += 8 * DAY;
    await saveAgain("v11");
    expect(await partFiles(onedrive)).not.toContain(file);
  });

  it("keeps where it was before keeping over a list, and which key it synced with, across a restart", async () => {
    const a = await pc();
    const file = path.join(a.userData, "cloud-copy.json");
    const state: CopyState = { version: 2 ** 52 - 1, pictures: true, files: {}, kept: true, keptFrom: 3_145_728, keyId: "0123456789abcdef" };
    await saveCopyState(file, state);
    expect(await loadCopyState(file)).toEqual(state);
  });

  it("cleans up nothing when a kept manifest's name says another version than its seal", async () => {
    const { onedrive, versions, saveAgain, manifestFile } = await sixOldSaves();
    await rename(manifestFile(3), path.join(onedrive, "Tavora", "manifests", `${pad(versions[3]!.version + 1)}-${pad(versions[3]!.base)}.bin`));
    await saveAgain();
    expect(await manifests(onedrive)).toHaveLength(7);
    expect(await partFiles(onedrive)).toHaveLength(7);
  });

  it("cleans up nothing when a kept manifest's ids outside the seal say other parts", async () => {
    const { onedrive, saveAgain, manifestFile } = await sixOldSaves();
    const body = await readFile(manifestFile(3));
    body.fill(0xab, 16, 16 + 32);
    await writeFile(manifestFile(3), body);
    await saveAgain();
    expect(await manifests(onedrive)).toHaveLength(7);
    expect(await partFiles(onedrive)).toHaveLength(7);
  });

  it("goes on past a manifest it can't read that is older than any it keeps, and removes it", async () => {
    const { onedrive, clock, saveAgain } = await sixOldSaves();
    const then = new Date(clock.now - 35 * DAY);
    // Junk, and a list sealed with the key from before Start over: no PC opens either.
    const junk = path.join(onedrive, "Tavora", "manifests", `${pad(1)}-${pad(0)}.bin`);
    await writeFile(junk, "not a manifest");
    const header = Buffer.alloc(16);
    header.write("TVC1");
    const oldKey = path.join(onedrive, "Tavora", "manifests", `${pad(2)}-${pad(1)}.bin`);
    await writeFile(oldKey, Buffer.concat([header, seal(copyKeys(newCopyKey()), Buffer.from(JSON.stringify({ v: 1, version: 2, pictures: true, files: [] })))]));
    for (const file of [junk, oldKey]) await utimes(file, then, then);
    await saveAgain();
    expect(await manifests(onedrive)).toHaveLength(5);
    expect(await partFiles(onedrive)).toHaveLength(7);
  });

  it("stops at a manifest it can't read right now, wherever it is, and deletes nothing", async () => {
    const { onedrive, saveAgain } = await sixOldSaves();
    // The oldest, past the five kept and a month old, is busy (or online only) right now: it isn't junk.
    const busy = (await manifests(onedrive))[0]!;
    const proto = FolderStorage.prototype as unknown as { readManifest: (file: { name: string }) => Promise<unknown> };
    const original = proto.readManifest;
    proto.readManifest = async function (this: unknown, file: { name: string }) {
      if (file.name === busy) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return original.call(this, file);
    };
    try {
      const before = await manifests(onedrive);
      await saveAgain();
      // All of them stay, and every part: the six saves' and the new one's.
      expect(await manifests(onedrive)).toEqual(expect.arrayContaining(before));
      expect(await partFiles(onedrive)).toHaveLength(7);
    } finally {
      proto.readManifest = original;
    }
  });

  it("cleans up a sync app's copies of parts a week after it first saw them, and nothing else in the part folders", async () => {
    const { onedrive, saveAgain, aWeekOn } = await sixOldSaves();
    const [part] = await partFiles(onedrive);
    const shard = path.dirname(part!);
    const copies = [`${path.basename(part!)} (1)`, `${path.basename(part!)} (Desk's conflicted copy 2026-11-23)`, `${path.basename(part!)}-DESK`];
    // Not a part nor a copy of one: never Tavora's to delete, however old.
    const others = ["desktop.ini", "notes.txt", "ABCDEF.tmp"];
    for (const name of [...copies, ...others]) await writeFile(path.join(shard, name), "x");
    await saveAgain();
    // Seen now: they stay a week.
    for (const name of copies) expect(await readdir(shard)).toContain(name);
    await aWeekOn();
    // One that comes later counts from when it is first seen.
    const later = `${path.basename(part!)} (2)`;
    await writeFile(path.join(shard, later), "x");
    await saveAgain("after");
    const left = await readdir(shard);
    for (const name of copies) expect(left).not.toContain(name);
    for (const name of [later, ...others]) expect(left).toContain(name);
  });

  it("keeps a part no manifest uses for a week after this PC first saw it, whatever its time or this PC's own saves say", async () => {
    const { key, onedrive, clock, storage, saveAgain, aWeekOn } = await sixOldSaves();
    const keys = copyKeys(key);
    // This PC was away: another PC saved meanwhile, and its parts came first, with that PC's time on them.
    const content = Buffer.from("written while this PC was away");
    const id = partId(keys, content);
    await storage.putParts([{ id, data: seal(keys, content) }]);
    const file = path.join(onedrive, "Tavora", "parts", id.toString("hex").slice(0, 2), id.toString("hex"));
    await utimes(file, new Date(clock.now - 10 * DAY), new Date(clock.now - 10 * DAY));
    await saveAgain();
    expect(await partFiles(onedrive)).toContain(file);
    // This PC saves again an hour on: its own new manifests don't make the part look old.
    clock.now += 60 * 60_000;
    await saveAgain("v7b");
    expect(await partFiles(onedrive)).toContain(file);
    // Still unused a week after it was first seen: gone.
    await aWeekOn();
    expect(await partFiles(onedrive)).not.toContain(file);
  });

  it("remembers when it first saw a part unused across restarts, and only for that folder", async () => {
    const key = newCopyKey();
    const keys = copyKeys(key);
    const onedrive = await folder();
    const clock = { now: Date.now() };
    const a = await pc({ "library.json": "v0" });
    const unusedFile = path.join(a.userData, "cloud-copy-unused.json");
    const storage = () => new FolderStorage(onedrive, { now: () => clock.now, unusedFile });
    const up = await new CloudCopy(storage()).upload(key, a.roots, EMPTY_STATE);
    if (up.status !== "uploaded") throw new Error(up.status);
    const content = Buffer.from("no manifest uses this");
    const id = partId(keys, content).toString("hex");
    await storage().putParts([{ id: partId(keys, content), data: seal(keys, content) }]);
    let state = up.state;
    const save = async (text: string) => {
      await writeFile(path.join(a.userData, "library.json"), text);
      const next = await new CloudCopy(storage()).upload(key, a.roots, state);
      if (next.status !== "uploaded") throw new Error(next.status);
      state = next.state;
    };
    await save("v1");
    // A start a day, for eight days: each still knows how long it has waited.
    for (let day = 1; day <= 8; day++) {
      clock.now += DAY;
      await save(`day ${day}`);
    }
    expect(await partFiles(onedrive)).not.toContain(path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id));
    // A note for another folder doesn't count here.
    const saved = JSON.parse(await readFile(unusedFile, "utf8")) as { folder: string };
    expect(saved.folder).toBe(onedrive);
  });

  it("stops at a manifest it can't read while that one could be kept", async () => {
    const { onedrive, clock, versions, saveAgain } = await sixOldSaves();
    // Written just now, as another PC's manifest a sync app hasn't finished: it may be one to keep.
    const half = path.join(onedrive, "Tavora", "manifests", `${pad(versions[1]!.version + 1)}-${pad(versions[1]!.version)}.bin`);
    await writeFile(half, "half synced");
    await utimes(half, new Date(clock.now), new Date(clock.now));
    await saveAgain();
    expect(await manifests(onedrive)).toHaveLength(8);
  });

  it("counts only marked manifests for the five newer ones a manifest needs before it goes", async () => {
    const key = newCopyKey();
    const keys = copyKeys(key);
    const onedrive = await folder();
    const clock = { now: Date.now() };
    const storage = new FolderStorage(onedrive, { now: () => clock.now });
    const a = await pc({ "library.json": "v1" });
    const first = await new CloudCopy(storage).upload(key, a.roots, EMPTY_STATE);
    if (first.status !== "uploaded") throw new Error(first.status);
    // Five unmarked ones on top: an older Tavora's, or parts put there.
    let base = first.state.version;
    for (let round = 0; round < 5; round++) {
      const version = storage.nextVersion(base);
      expect(await storage.swap(base, version, [], seal(keys, Buffer.from(JSON.stringify({ v: 1, version, pictures: true, files: [] }))))).toMatchObject({ status: "saved" });
      base = version;
    }
    clock.now += 40 * DAY;
    await age(onedrive, 35 * DAY, clock.now);
    await writeFile(path.join(a.userData, "library.json"), "v2");
    const up = await new CloudCopy(storage).upload(key, a.roots, { ...first.state, version: base });
    expect(up).toMatchObject({ status: "uploaded" });
    expect(await manifests(onedrive)).toContain(`${pad(first.state.version)}-${pad(0)}.bin`);
    expect(await manifests(onedrive)).toHaveLength(7);
  });

  it("writes a part used again anew once it is over a day old, so every sync app brings its new time", async () => {
    const key = newCopyKey();
    const keys = copyKeys(key);
    const onedrive = await folder();
    const clock = { now: Date.now() };
    const storage = new FolderStorage(onedrive, { now: () => clock.now });
    const content = Buffer.from("same");
    const id = partId(keys, content);
    const file = path.join(onedrive, "Tavora", "parts", id.toString("hex").slice(0, 2), id.toString("hex"));
    await storage.putParts([{ id, data: seal(keys, content) }]);
    const written = await stat(file);
    // Within a day: only touched.
    clock.now += 60 * 60_000;
    await storage.putParts([{ id, data: seal(keys, content) }]);
    expect((await stat(file)).ino).toBe(written.ino);
    // Two days on: written again, and it still opens as the same part.
    clock.now += 2 * DAY;
    await utimes(file, new Date(clock.now - 2 * DAY), new Date(clock.now - 2 * DAY));
    await storage.putParts([{ id, data: seal(keys, content) }]);
    expect((await stat(file)).ino).not.toBe(written.ino);
    const [again] = await storage.getParts([id.toString("hex")]);
    expect(open(keys, again!.data).equals(content)).toBe(true);
  });

  it("keeps a part a PC used again, though no manifest the clean-up sees uses it yet", async () => {
    const { key, onedrive, storage, saveAgain } = await sixOldSaves();
    const keys = copyKeys(key);
    // Another PC's library is "v1" again: its part is in the folder already, and its manifest is still on its way.
    const content = Buffer.from("v1");
    const id = partId(keys, content).toString("hex");
    await storage.putParts([{ id: partId(keys, content), data: seal(keys, content) }]);
    await saveAgain();
    expect(await partFiles(onedrive)).toContain(path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id));
    expect(await partFiles(onedrive)).toHaveLength(7);
  });

  it("follows no link or junction in its folder", async () => {
    // A fixed key: a part's shard (its name's first two letters) comes from the key, and a random one put the second
    // upload's own part into the junction's shard about 1 run in 85, so the upload ran into the link and failed (folder-locked).
    const key = Buffer.alloc(newCopyKey().length, 9);
    const onedrive = await folder();
    let now = Date.now();
    const storage = new FolderStorage(onedrive, { now: () => now });
    const a = await pc({ "library.json": "v1" });
    const up = await new CloudCopy(storage).upload(key, a.roots, EMPTY_STATE);
    if (up.status !== "uploaded") throw new Error(up.status);
    now += 40 * DAY;
    await age(onedrive, 35 * DAY, now);

    // Somewhere else on the PC, a file named like a part, old enough to be cleaned up, and a link to it as a shard.
    const elsewhere = await folder();
    const victim = path.join(elsewhere, "a".repeat(64));
    await writeFile(victim, "not the copy's");
    await utimes(victim, new Date(now - 35 * DAY), new Date(now - 35 * DAY));
    const shards = await readdir(path.join(onedrive, "Tavora", "parts"));
    const shard = ["aa", "ab", "ac"].find((name) => !shards.includes(name))!;
    await symlink(elsewhere, path.join(onedrive, "Tavora", "parts", shard), "junction");
    await writeFile(path.join(a.userData, "library.json"), "v2");
    const second = await new CloudCopy(storage).upload(key, a.roots, up.state);
    expect(second).toMatchObject({ status: "uploaded" });
    expect(await readFile(victim, "utf8")).toBe("not the copy's");

    // Manifests behind a link aren't read, and aren't "no copy" either.
    const moved = path.join(elsewhere, "manifests");
    await rename(path.join(onedrive, "Tavora", "manifests"), moved);
    await symlink(moved, path.join(onedrive, "Tavora", "manifests"), "junction");
    await expect(storage.remote()).rejects.toMatchObject({ reason: "folder-locked" });
    await expect(storage.manifest()).rejects.toMatchObject({ reason: "folder-locked" });
    // Deleting the copy removes the link, not what it leads to.
    await storage.remove();
    expect(await readdir(moved)).not.toHaveLength(0);
    expect(await readFile(victim, "utf8")).toBe("not the copy's");
  });

  it("deletes only the link when the Tavora folder itself is a link or junction", async () => {
    const onedrive = await folder();
    // Somewhere else, folders named like the copy's, and the copy's Tavora folder made a junction to them.
    const elsewhere = await folder();
    for (const name of ["manifests", "parts"]) {
      await mkdir(path.join(elsewhere, name));
      await writeFile(path.join(elsewhere, name, "keep.txt"), "not the copy's");
    }
    await symlink(elsewhere, path.join(onedrive, "Tavora"), "junction");
    await new FolderStorage(onedrive).remove();
    for (const name of ["manifests", "parts"]) expect(await readFile(path.join(elsewhere, name, "keep.txt"), "utf8")).toBe("not the copy's");
    expect(await readdir(onedrive)).toEqual([]);
    // A file named Tavora isn't the copy's: it stays.
    await writeFile(path.join(onedrive, "Tavora"), "a note");
    await new FolderStorage(onedrive).remove();
    expect(await readFile(path.join(onedrive, "Tavora"), "utf8")).toBe("a note");
  });
});
