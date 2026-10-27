import { cp, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudCopyView } from "../shared/host-api";
import { AccountKey } from "./account-key";
import { CloudCopy, EMPTY_STATE, ServiceStorage, swapInCopy } from "./cloud-copy";
import { cleanUp, pc } from "./cloud-copy.test-helper";
import { CopySync } from "./cloud-copy-sync";
import { newCopyKey } from "./copy-crypto";
import { FolderStorage, follows } from "./copy-folder";

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
  // Signed out: the service is never asked.
  const offService = new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: (() => Promise.reject(new Error("no service"))) as typeof fetch, token: () => null });

  function tavora(at: Awaited<ReturnType<typeof pc>>) {
    const views: CloudCopyView[] = [];
    const events = { restarts: 0 };
    const sync = new CopySync({
      userData: at.userData,
      enabled: true,
      moduleFiles: () => at.moduleFiles,
      service: offService,
      accountKey: new AccountKey({ file: path.join(at.userData, "account-key.json"), encryptor, baseUrl: "http://tavora.test/v1/account", fetch: (() => Promise.reject(new Error("no service"))) as typeof fetch, token: () => null }),
      flush: async () => undefined,
      restart: () => void events.restarts++,
      onChange: (view) => views.push(view),
    });
    return { sync, views, events };
  }

  it("works signed out, stays on after signing out, and brings a PC's data to another", async () => {
    const onedrive = await folder();
    const a = await pc({ "library.json": JSON.stringify({ version: 1, games: { "elden-ring": {} } }) });
    const atA = tavora(a);
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    const key = atA.sync.view().recoveryKey!;
    expect(atA.sync.view()).toMatchObject({ on: true, folder: onedrive, limit: null, problem: null, copy: { size: expect.any(Number) } });
    await atA.sync.signedOut();
    expect(atA.sync.view().on).toBe(true);

    // After a restart it still knows the folder.
    const again = tavora(a);
    await again.sync.beforeLoad();
    expect(again.sync.view()).toMatchObject({ on: true, folder: onedrive });

    const b = await pc({ "library.json": JSON.stringify({ version: 1, games: {} }) });
    const atB = tavora(b);
    await atB.sync.beforeLoad();
    await atB.sync.turnOn(onedrive);
    expect(atB.sync.view().askKey).toBe(true);
    await atB.sync.enterKey(key);
    await atB.sync.keep("cloud");
    expect(atB.events.restarts).toBe(1);
    await tavora(b).sync.beforeLoad();
    expect(JSON.parse(await read(b.userData, "library.json")).games).toHaveProperty("elden-ring");
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

  it("says when the folder can't be used", async () => {
    const atA = tavora(await pc());
    await atA.sync.beforeLoad();
    await expect(atA.sync.turnOn(path.join(await folder(), "not-there"))).rejects.toMatchObject({ key: "cloudCopy.error.no-folder" });
    expect(atA.sync.view()).toMatchObject({ on: false, folder: null });
  });
});
