// The cloud copy when something goes wrong: data lost on this PC, a swap cut off, a folder that can't be read.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BATCH_BYTES, CloudCopy, EMPTY_STATE, swapInCopy, type CopyStorage, type RemoteCopy, type SwapAnswer } from "./cloud-copy";
import { CopySync } from "./cloud-copy-sync";
import { FolderStorage } from "./copy-folder";
import { newCopyKey } from "./copy-crypto";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { readSavedFile } from "./json";

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };
type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

function tavora(cloud: Service, at: Pc, now?: () => Date) {
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
    ...(now ? { now } : {}),
  });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return { sync, events };
}

const read = (dir: string, name: string) => readFile(path.join(dir, name), "utf8");
const library = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const remoteVersion = async (cloud: Service) => (await cloud.client().remote())?.version;

async function startCopy(cloud: Service, a: Pc) {
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  return { ...first, key: first.sync.view().recoveryKey! };
}

/** A second PC with the same copy, in step with it. */
async function secondPc(cloud: Service, key: string, files: Record<string, string>) {
  const b = await pc(files);
  const at = tavora(cloud, b);
  await at.sync.beforeLoad();
  await at.sync.turnOn();
  await at.sync.enterKey(key);
  await at.sync.keep("cloud");
  await tavora(cloud, b).sync.beforeLoad();
  return b;
}

describe("data lost on this PC", () => {
  it("doesn't upload a library it couldn't read, also after a restart, until the user chooses", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "workspace.json": '{"version":3,"workspaces":{}}', "profile.json": "{}" });
    await startCopy(cloud, a);
    const version = await remoteVersion(cloud);

    await writeFile(path.join(a.userData, "library.json"), "{ broken");
    const damaged = tavora(cloud, a);
    await readSavedFile(path.join(a.userData, "library.json"), { version: 2 });
    await damaged.sync.beforeLoad();
    await damaged.sync.checkDataFiles();
    expect(damaged.sync.view()).toMatchObject({ conflict: true, conflictKind: "lost" });
    expect(damaged.sync.dataHeld).toBe(true);

    // Tavora goes on and saves an empty library; the timer's upload waits.
    await writeFile(path.join(a.userData, "library.json"), library());
    await damaged.sync.sync();
    expect(await remoteVersion(cloud)).toBe(version);
    await expect(damaged.sync.startOver()).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });

    // The next start still knows, though the file is there again.
    const next = tavora(cloud, a);
    await next.sync.beforeLoad();
    await next.sync.checkDataFiles();
    expect(next.sync.view()).toMatchObject({ conflict: true, conflictKind: "lost" });
    await next.sync.sync();
    expect(await remoteVersion(cloud)).toBe(version);

    // Using the copy brings it back, at the same version.
    await next.sync.keep("cloud");
    expect(next.events.restarts).toBe(1);
    const restored = tavora(cloud, a);
    await restored.sync.beforeLoad();
    await restored.sync.checkDataFiles();
    expect(JSON.parse(await read(a.userData, "library.json")).workspaces).toEqual({ "elden-ring": {} });
    expect(restored.sync.view()).toMatchObject({ conflict: false, conflictKind: null });
  });

  it("uploads this PC's side once the user chooses it", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "workspace.json": "{}" });
    await startCopy(cloud, a);
    const version = await remoteVersion(cloud);
    await writeFile(path.join(a.userData, "library.json"), "{ broken");
    const damaged = tavora(cloud, a);
    await readSavedFile(path.join(a.userData, "library.json"), { version: 2 });
    await damaged.sync.beforeLoad();
    await damaged.sync.checkDataFiles();
    await writeFile(path.join(a.userData, "library.json"), library("hades"));

    await damaged.sync.keep("pc");
    expect(damaged.sync.view()).toMatchObject({ conflict: false, conflictKind: null });
    expect(await remoteVersion(cloud)).toBeGreaterThan(version!);
  });

  it("counts a data file gone since the last sync as lost, and one that never was as nothing", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "workspace.json": "{}" });
    await startCopy(cloud, a);

    const fine = tavora(cloud, a);
    await fine.sync.beforeLoad();
    await fine.sync.checkDataFiles(); // no profile.json, and it was never synced
    expect(fine.sync.view()).toMatchObject({ conflict: false, conflictKind: null });

    await rename(path.join(a.userData, "workspace.json"), path.join(a.root, "elsewhere.json"));
    const gone = tavora(cloud, a);
    await gone.sync.beforeLoad();
    await gone.sync.checkDataFiles();
    expect(gone.sync.view()).toMatchObject({ conflict: true, conflictKind: "lost" });
  });

  it("asks before taking a copy that has none of this PC's workspaces", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring", "hades") });
    const { key, sync: atA } = await startCopy(cloud, a);
    const b = await secondPc(cloud, key, { "library.json": "{}" });

    // An older Tavora on A lost its library and uploaded what it started with.
    await writeFile(path.join(a.userData, "library.json"), library());
    await atA.sync();

    const atB = tavora(cloud, b);
    await atB.sync.beforeLoad();
    expect(atB.sync.view()).toMatchObject({ conflict: true, restartToTake: false });
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toEqual({ "elden-ring": {}, hades: {} });
  });
});

describe("a swap that was cut off", () => {
  it("leaves what is already in place, and puts in the rest", async () => {
    const at = await pc({ "library.json": "new library", "workspace.json": "old workspace", "module-data/a.json": "old data" });
    const staging = path.join(at.root, "staging");
    const kept = path.join(at.root, "kept");
    await mkdir(path.join(staging, "module-data"), { recursive: true });
    await writeFile(path.join(staging, "workspace.json"), "new workspace");
    await writeFile(path.join(staging, "module-data", "a.json"), "new data");
    // library.json was swapped before the cut: its old side is kept and its staged side is gone.
    await mkdir(kept, { recursive: true });
    await writeFile(path.join(kept, "library.json"), "old library");
    const file = { size: 1, sha256: "0".repeat(64), parts: ["0".repeat(64)] };

    await swapInCopy(staging, at.roots, kept, { version: 2, pictures: true, files: { "library.json": file, "workspace.json": file, "module-data/a.json": file } });

    expect(await read(at.userData, "library.json")).toBe("new library");
    expect(await read(at.userData, "workspace.json")).toBe("new workspace");
    expect(await read(at.userData, "module-data/a.json")).toBe("new data");
    expect(await read(kept, "library.json")).toBe("old library");
    expect(await read(kept, "workspace.json")).toBe("old workspace");
    expect(await read(kept, "module-data/a.json")).toBe("old data");
  });

  it("is finished at the next start, with this PC's settings and one backup", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: { "elden-ring": {} } }), "workspace.json": '"from a"' });
    const { key } = await startCopy(cloud, a);
    const b = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: {}, developmentFolders: ["D:\\mine"] }), "workspace.json": '"from b"' });
    const atB = tavora(cloud, b);
    await atB.sync.beforeLoad();
    await atB.sync.turnOn();
    await atB.sync.enterKey(key);
    await atB.sync.keep("cloud");

    // Cut off after library.json went in.
    const stagingDir = path.join(b.userData, "cloud-copy-staging");
    const keepIn = path.join(b.userData, "backups", "cloud-copy-2026-11-21T00-00-00-000Z-this-pc");
    await mkdir(keepIn, { recursive: true });
    // Choosing the copy parked the state already, as during a swap.
    expect(await stat(path.join(b.userData, "cloud-copy-swapping.json")).then(() => true, () => false)).toBe(true);
    await writeFile(path.join(b.userData, "cloud-copy-status.json"), JSON.stringify({ v: 1, phase: "swapping", plan: { keepIn, moduleFiles: b.moduleFiles, own: { developmentFolders: ["D:\\mine"] }, empty: [] } }));
    await rename(path.join(b.userData, "library.json"), path.join(keepIn, "library.json"));
    await rename(path.join(stagingDir, "data", "library.json"), path.join(b.userData, "library.json"));

    const next = tavora(cloud, b);
    await next.sync.beforeLoad();

    const taken = JSON.parse(await read(b.userData, "library.json"));
    expect(taken.workspaces).toEqual({ "elden-ring": {} });
    expect(taken.developmentFolders).toEqual(["D:\\mine"]);
    expect(await read(b.userData, "workspace.json")).toBe('"from a"');
    // Picked up at a later start, what it moves counts as written since: this PC never synced it.
    expect(await read(keepIn, "written-since/workspace.json")).toBe('"from b"');
    expect(JSON.parse(await read(keepIn, "library.json")).developmentFolders).toEqual(["D:\\mine"]);
    expect(await readdir(path.join(b.userData, "backups"))).toEqual([path.basename(keepIn)]);
    expect(await readdir(b.userData)).not.toContain("cloud-copy-staging");
    // Nothing is left to send back.
    const version = await remoteVersion(cloud);
    await next.sync.sync(true);
    expect(await remoteVersion(cloud)).toBe(version);
  });

  it("waits for a swap that started just as the start's time ran out", async () => {
    const budget = 987_654;
    const cloud = await service();
    const a = await pc({ "library.json": library("elden-ring"), "workspace.json": '"one"' });
    const { key, sync: atA } = await startCopy(cloud, a);
    const b = await secondPc(cloud, key, { "library.json": "{}" });
    await writeFile(path.join(a.userData, "workspace.json"), '"two"');
    await atA.sync();

    // The start's time runs out at the moment the swap names its backup folder.
    const realTimeout = globalThis.setTimeout;
    let runOut: () => void = () => undefined;
    const timers = vi.spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, ms?: number) => {
      if (ms !== budget) return realTimeout(run, ms);
      runOut = run;
      return { unref: () => undefined };
    }) as unknown as typeof setTimeout);
    try {
      const later = tavora(cloud, b, () => {
        runOut();
        return new Date();
      });
      await later.sync.beforeLoad(budget);
      expect(await read(b.userData, "workspace.json")).toBe('"two"');
      expect(later.sync.view().restartToTake).toBe(false);
    } finally {
      timers.mockRestore();
    }
  });
});

describe("the folder and the size of a copy", () => {
  it("writes nothing more once the copy is turned off during a download", async () => {
    const at = await pc({});
    await mkdir(at.userData, { recursive: true });
    await writeFile(path.join(at.userData, "library.json"), "data");
    const folder = path.join(at.root, "OneDrive");
    await mkdir(folder);
    const key = newCopyKey();
    const engine = new CloudCopy(new FolderStorage(folder));
    await engine.upload(key, at.roots, EMPTY_STATE);
    const b = await pc({});
    const staging = path.join(b.root, "staging");
    expect(await engine.download(key, b.roots, staging, 0, false, () => false)).toBeNull();
    expect(await readdir(b.root)).not.toContain("staging");
    expect(await readdir(b.root)).not.toContain("staging.parts");
  });

  it("doesn't take a folder it can't read for a deleted copy", async () => {
    const at = await pc({ "library.json": "{}" });
    const folder = path.join(at.root, "OneDrive");
    await mkdir(path.join(folder, "Tavora"), { recursive: true });
    // Reading the manifests folder fails with something other than "not there".
    await writeFile(path.join(folder, "Tavora", "manifests"), "not a folder");
    await expect(new FolderStorage(folder).remote()).rejects.toMatchObject({ reason: "folder-locked" });
  });

  it("never sends more in one upload than the service takes", async () => {
    const at = await pc({});
    await mkdir(at.userData, { recursive: true });
    // Six parts that don't compress, each a little under the part size: two fit in an upload, a third would not.
    await writeFile(path.join(at.userData, "library.json"), randomBytes(6 * 3_900_000));
    const parts = new Map<string, Uint8Array>();
    const sent: number[] = [];
    let copy: { version: number; sealed: Uint8Array } | null = null;
    const storage: CopyStorage = {
      limit: null,
      arrivesLate: false,
      remote: async (): Promise<RemoteCopy | null> => (copy ? { version: copy.version, size: 1, updatedAt: "2026-11-21T00:00:00.000Z" } : null),
      manifest: async () => copy,
      putParts: async (batch) => {
        sent.push(batch.reduce((sum, part) => sum + part.id.length + 4 + part.data.length, 0));
        for (const part of batch) parts.set(part.id.toString("hex"), part.data);
      },
      getParts: async (ids) => ids.slice(0, 2).flatMap((id) => (parts.has(id) ? [{ id, data: parts.get(id)! }] : [])),
      nextVersion: () => null,
      swap: async (_base, _version, _ids, sealed): Promise<SwapAnswer> => {
        copy = { version: 1, sealed };
        return { status: "saved", version: 1, size: 1 };
      },
      remove: async () => undefined,
    };
    const key = newCopyKey();
    const engine = new CloudCopy(storage);
    expect((await engine.upload(key, at.roots, EMPTY_STATE)).status).toBe("uploaded");
    expect(sent.length).toBeGreaterThan(1);
    for (const bytes of sent) expect(bytes).toBeLessThanOrEqual(BATCH_BYTES);

    // And it comes back whole, a few parts at a time, with no parts left on disk.
    const b = await pc({});
    const staging = path.join(b.root, "staging");
    await engine.download(key, b.roots, staging);
    expect((await readFile(path.join(staging, "library.json"))).equals(await readFile(path.join(at.userData, "library.json")))).toBe(true);
    expect(await readdir(b.root)).not.toContain("staging.parts");
  });
});
