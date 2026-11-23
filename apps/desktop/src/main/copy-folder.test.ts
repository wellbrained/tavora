import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rename, rm, symlink, truncate, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudCopyView } from "../shared/host-api";

import { CloudCopy, EMPTY_STATE, swapInCopy } from "./cloud-copy";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { CopySync } from "./cloud-copy-sync";
import { copyKeys, newCopyKey, partId, seal } from "./copy-crypto";
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

const manifests = async (dir: string) => (await readdir(path.join(dir, "Tavora", "manifests"))).sort();
const read = (dir: string, name: string) => readFile(path.join(dir, name), "utf8");

describe("the cloud copy in a folder", () => {
  it("takes a PC's data to another PC through the folder, sealed", async () => {
    const key = newCopyKey();
    const onedrive = await folder();
    const copy = new CloudCopy(new FolderStorage(onedrive));
    const a = await pc({ "library.json": '{"games":["elden-ring"]}', "module-data/m/g/storage.json": "secret notes" });
    const uploaded = await copy.upload(key, a.roots, EMPTY_STATE);
    expect(uploaded).toMatchObject({ status: "uploaded", pictures: true });
    if (uploaded.status !== "uploaded") return;
    expect(await copy.remote(uploaded.state.version)).toMatchObject({ version: uploaded.state.version, follows: true, size: expect.any(Number) });

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
    const remoteA = await new FolderStorage(atA).remote(fromA.state.version);
    const remoteB = await new FolderStorage(atB).remote(fromB.state.version);
    expect(remoteA?.version).toBe(winner);
    expect(remoteB?.version).toBe(winner);
    expect([remoteA?.follows, remoteB?.follows].sort()).toEqual([false, true]);
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
    expect(await new FolderStorage(onedrive).remote(up.state.version)).toMatchObject({ version: up.state.version, follows: true });
  });

  it("cleans up old manifests and parts no one uses, but only once they are old", async () => {
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
    const old = new Date(now - 35 * 24 * 60 * 60_000);
    for (const file of await readdir(path.join(onedrive, "Tavora"), { recursive: true })) await utimes(path.join(onedrive, "Tavora", file), old, old);
    await writeFile(path.join(a.userData, "library.json"), "v9");
    const up = await new CloudCopy(storage).upload(key, a.roots, state);
    if (up.status !== "uploaded") throw new Error(up.status);
    expect(await manifests(onedrive)).toHaveLength(5);
    expect(await parts()).toHaveLength(5);
    const b = await pc();
    await new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"));
    expect(await read(path.join(b.root, "staging"), "library.json")).toBe("v9");
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
  const line = [
    { version: 30, base: 20 },
    { version: 21, base: 10 },
    { version: 20, base: 10 },
    { version: 10, base: 0 },
  ];
  it("knows which saves are in the newest version's line", () => {
    expect(follows(line, 30)).toBe(true);
    expect(follows(line, 20)).toBe(true);
    expect(follows(line, 10)).toBe(true);
    expect(follows(line, 0)).toBe(true);
    // Saved at the same time as 20, and lost.
    expect(follows(line, 21)).toBe(false);
  });
  it("can't tell about a save that is cleaned up already, and doesn't ask then", () => {
    expect(follows(line, 5)).toBe(true);
  });
});

describe("the cloud copy in a folder, as Tavora runs it", () => {
  const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

  function tavora(at: Awaited<ReturnType<typeof pc>>) {
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
  const partFiles = async (dir: string) =>
    (await readdir(path.join(dir, "Tavora", "parts"), { recursive: true })).filter((name) => /[0-9a-f]{64}$/.test(name)).map((name) => path.join(dir, "Tavora", "parts", name));
  /** Sets every file of the copy back by `ms`, as if written that long ago. */
  async function age(dir: string, ms: number, now: number) {
    const then = new Date(now - ms);
    for (const file of await readdir(path.join(dir, "Tavora"), { recursive: true })) await utimes(path.join(dir, "Tavora", file), then, then);
  }

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
    await expect(new CloudCopy(storage).download(key, b.roots, path.join(b.root, "staging"))).rejects.toMatchObject({ reason: "damaged" });
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
    // Its own manifest is gone, so the folder can't tell it was left behind; the version still can.
    expect(await new FolderStorage(onedrive).remote(second.state.version)).toMatchObject({ version: first.state.version, follows: true });
    const b = await pc();
    const staging = path.join(b.root, "staging");
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, staging, second.state.version, second.state)).rejects.toMatchObject({ reason: "older" });
    expect(await new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, staging, 0, { ...second.state, chosen: true })).toMatchObject({ version: first.state.version });
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
    await expect(new CloudCopy(new FolderStorage(onedrive)).download(key, b.roots, path.join(b.root, "staging"))).rejects.toMatchObject({ reason: "damaged" });
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
    expect(await partFiles(onedrive)).toHaveLength(5);
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
    await expect(new FolderStorage(onedrive).manifest()).rejects.toMatchObject({ reason: "damaged", message: expect.stringContaining("bigger") });
    await expect(new FolderStorage(onedrive).remote()).rejects.toMatchObject({ reason: "damaged" });

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
    const saveAgain = async () => {
      await writeFile(path.join(a.userData, "library.json"), "v7");
      const up = await new CloudCopy(storage).upload(key, a.roots, state);
      if (up.status !== "uploaded") throw new Error(up.status);
    };
    const manifestFile = (at: number) => path.join(onedrive, "Tavora", "manifests", `${pad(versions[at]!.version)}-${pad(versions[at]!.base)}.bin`);
    return { key, onedrive, clock, storage, a, state, versions, saveAgain, manifestFile };
  }

  it("cleans up as before when nothing was changed", async () => {
    const { onedrive, saveAgain } = await sixOldSaves();
    await saveAgain();
    expect(await manifests(onedrive)).toHaveLength(5);
    expect(await partFiles(onedrive)).toHaveLength(5);
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

  it("goes on past a manifest it can't read that is older than any it keeps, and leaves that one alone", async () => {
    const { onedrive, clock, saveAgain } = await sixOldSaves();
    const junk = path.join(onedrive, "Tavora", "manifests", `${pad(1)}-${pad(0)}.bin`);
    await writeFile(junk, "not a manifest");
    await utimes(junk, new Date(clock.now - 35 * DAY), new Date(clock.now - 35 * DAY));
    await saveAgain();
    expect(await manifests(onedrive)).toHaveLength(6);
    expect(await manifests(onedrive)).toContain(`${pad(1)}-${pad(0)}.bin`);
    expect(await partFiles(onedrive)).toHaveLength(5);
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

  it("keeps a part a PC used again, though no manifest the clean-up sees uses it yet", async () => {
    const { key, onedrive, storage, saveAgain } = await sixOldSaves();
    const keys = copyKeys(key);
    // Another PC's library is "v1" again: its part is in the folder already, and its manifest is still on its way.
    const content = Buffer.from("v1");
    const id = partId(keys, content).toString("hex");
    await storage.putParts([{ id: partId(keys, content), data: seal(keys, content) }]);
    await saveAgain();
    expect(await partFiles(onedrive)).toContain(path.join(onedrive, "Tavora", "parts", id.slice(0, 2), id));
    expect(await partFiles(onedrive)).toHaveLength(6);
  });

  it("follows no link or junction in its folder", async () => {
    const key = newCopyKey();
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
});
