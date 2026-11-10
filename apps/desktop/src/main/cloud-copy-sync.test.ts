import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudCopyView } from "../shared/host-api";

import { CloudCopy, ServiceStorage } from "./cloud-copy";
import { FOLDER_NAME } from "./copy-folder";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { CLOSE_QUIET_MS, CopySync, questionsView, type Question } from "./cloud-copy-sync";
import { FolderPairing, Pairing } from "./pairing";

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

/** Tavora on a PC: the cloud copy as the host runs it, with what it showed and whether it restarted. */
function tavora(cloud: Service, at: Pc, { signedIn = true, devData = false } = {}) {
  const views: CloudCopyView[] = [];
  const events = { restarts: 0, closed: 0 };
  const sync = new CopySync({
    userData: at.userData,
    enabled: true,
    devData,
    files: { root: () => at.moduleFiles },
    account: { token: () => (signedIn ? cloud.token : null) },
    serviceUrl: "http://tavora.test/v1/account",
    fetch: cloud.fetch,
    encryptor,
    restart: () => void events.restarts++,
  });
  sync.attach({ flush: async () => undefined, onChange: (view) => views.push(view) });
  return { sync, views, events };
}

const read = (dir: string, name: string) => readFile(path.join(dir, name), "utf8");

async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !check(); tries++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
}

/** Turns the copy on at PC A with its data, and returns the recovery key it showed. */
async function startCopy(cloud: Service, a: Pc) {
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  const key = first.sync.view().recoveryKey;
  expect(key).toMatch(/^[0-9A-Z]{4}-/);
  expect(first.sync.view()).toMatchObject({ on: true, problem: null, copy: { size: expect.any(Number) } });
  return { ...first, key: key! };
}

describe("the cloud copy, as Tavora runs it", () => {
  it("tells Settings when it runs in the dev build's own data, so turning on asks first", async () => {
    const cloud = await service();
    const at = await pc({});
    expect(tavora(cloud, at, { devData: true }).sync.view().devData).toBe(true);
    expect(tavora(cloud, at).sync.view().devData).toBe(false);
  });

  it("brings PC A's data to PC B once B has the recovery key, keeping B's own settings and data", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: { "elden-ring": {} }, moduleFilesFolder: "C:\\A pictures" }), "modules/dice/manifest.json": "dice" });
    const { key } = await startCopy(cloud, a);

    const b = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: {}, developmentFolders: ["D:\\mine"] }) });
    const atB = tavora(cloud, b);
    await atB.sync.beforeLoad();
    await atB.sync.turnOn();
    expect(atB.sync.view().askKey).toBe(true);
    await expect(atB.sync.enterKey("not a key")).rejects.toMatchObject({ key: "cloudCopy.error.badKey" });
    const other = (await startCopy(await service(), await pc({ "library.json": "{}" }))).key;
    await expect(atB.sync.enterKey(other)).rejects.toMatchObject({ key: "cloudCopy.error.wrongKey" });
    expect(atB.sync.view().on).toBe(false);

    await atB.sync.enterKey(key.toLowerCase().replace(/-/g, " "));
    // B has data of its own: the user keeps one side.
    expect(atB.sync.view()).toMatchObject({ on: true, askKey: false, conflict: true });
    await atB.sync.keep("cloud");
    expect(atB.events.restarts).toBe(1);
    // Nothing changed yet: the copy is taken at the start, before anything reads the data.
    expect(JSON.parse(await read(b.userData, "library.json")).workspaces).toEqual({});

    const restarted = tavora(cloud, b);
    await restarted.sync.beforeLoad();
    const library = JSON.parse(await read(b.userData, "library.json"));
    expect(library.workspaces).toEqual({ "elden-ring": {} });
    // Folders on this PC stay this PC's.
    expect(library.moduleFilesFolder).toBeUndefined();
    expect(library.developmentFolders).toEqual(["D:\\mine"]);
    expect(await read(b.userData, "modules/dice/manifest.json")).toBe("dice");
    // B's own data is kept as a local backup.
    const backups = await readdir(path.join(b.userData, "backups"));
    expect(backups).toEqual([expect.stringMatching(/^cloud-copy-.*-this-pc$/)]);
    expect(JSON.parse(await read(path.join(b.userData, "backups", backups[0]!), "library.json")).developmentFolders).toEqual(["D:\\mine"]);
    expect(restarted.sync.view()).toMatchObject({ on: true, conflict: false });
    // B's own settings are not a change to send back.
    await restarted.sync.sync(true);
    expect((await new CloudCopy(new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => cloud.token })).remote())?.version).toBe(1);
  });

  it("takes a newer copy at start when this PC did not change, and uploads changes made here", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": '{"games":1}' });
    const { key, sync: atA } = await startCopy(cloud, a);
    const b = await pc({ "library.json": "{}" });
    const atB = tavora(cloud, b);
    await atB.sync.turnOn();
    await atB.sync.enterKey(key);
    await atB.sync.keep("cloud");
    await tavora(cloud, b).sync.beforeLoad();

    // A changes something and syncs it (as the timer would).
    await writeFile(path.join(a.userData, "library.json"), '{"games":2}');
    await atA.sync();
    // B starts and gets it, silently.
    const later = tavora(cloud, b);
    await later.sync.beforeLoad();
    expect(await read(b.userData, "library.json")).toBe('{"games":2}');
    expect(later.sync.view()).toMatchObject({ conflict: false, restartToTake: false });

    // B changes something; A gets it at its next start.
    await writeFile(path.join(b.userData, "workspace.json"), '{"b":true}');
    await later.sync.sync();
    await tavora(cloud, a).sync.beforeLoad();
    expect(await read(a.userData, "workspace.json")).toBe('{"b":true}');
  });

  it("doesn't take an older copy the service hands out as a newer version without asking", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { key, sync: atA } = await startCopy(cloud, a);
    const manifest = "http://tavora.test/v1/account/copy/manifest";
    const old = Buffer.from(await (await cloud.fetch(manifest, { headers: { authorization: `Bearer ${cloud.token}` } })).arrayBuffer());
    // The first version's parts stay in the copy: only a file is added.
    await writeFile(path.join(a.userData, "workspace.json"), "w2");
    await atA.sync();
    const b = await pc({ "library.json": "b0" });
    const setup = tavora(cloud, b);
    await setup.sync.turnOn();
    await setup.sync.enterKey(key);
    await setup.sync.keep("cloud");
    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b.userData, "workspace.json")).toBe("w2");

    // The service serves the first manifest again, as version 9.
    const replay = (async (url: string, init?: RequestInit) => {
      const answer = await cloud.fetch(url, init);
      if ((init?.method ?? "GET") !== "GET") return answer;
      if (url === manifest) return new Response(old, { headers: { "x-copy-version": "9" } });
      if (url.endsWith("/copy")) {
        const body = (await answer.json()) as { copy: Record<string, unknown> };
        return Response.json({ copy: { ...body.copy, version: 9 } });
      }
      return answer;
    }) as typeof fetch;
    const atB = tavora({ ...cloud, fetch: replay }, b);
    await atB.sync.beforeLoad();
    expect(await read(b.userData, "workspace.json")).toBe("w2");
    expect(atB.sync.view()).toMatchObject({ conflict: true, restartToTake: false });
    expect(atB.events.restarts).toBe(0);
    // Keeping this PC answers it; the replayed copy only goes aside as a backup. (The upload after it fails here
    // only because this fake service's version 9 doesn't exist.)
    await atB.sync.keep("pc").catch(() => undefined);
    expect(atB.sync.view().conflict).toBe(false);
    expect(await read(b.userData, "workspace.json")).toBe("w2");
  });

  it("asks a PC that missed a delete before it takes the copy made after it", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { key } = await startCopy(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2");
    await tavora(cloud, a).sync.sync();
    // While A is off, B deletes the copy and starts a new one from its own data.
    const b = await pc({ "library.json": "b0" });
    const atB = tavora(cloud, b);
    await atB.sync.turnOn();
    await atB.sync.enterKey(key);
    await atB.sync.keep("pc");
    await atB.sync.remove();
    await atB.sync.turnOn();
    await until(() => atB.sync.view().on);

    const atA = tavora(cloud, a);
    await atA.sync.beforeLoad();
    expect(await read(a.userData, "library.json")).toBe("a2");
    expect(atA.sync.view()).toMatchObject({ on: true, conflict: true });
    // Taking the cloud side works: the user chose it.
    await atA.sync.keep("cloud");
    expect(atA.events.restarts).toBe(1);
    await tavora(cloud, a).sync.beforeLoad();
    expect(await read(a.userData, "library.json")).toBe("b0");
  });

  it("asks which side to keep when both changed, and keeps the other as a local backup", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { key, sync: atA } = await startCopy(cloud, a);
    const b = await pc({ "library.json": "b0" });
    const setup = tavora(cloud, b);
    await setup.sync.turnOn();
    await setup.sync.enterKey(key);
    await setup.sync.keep("cloud");
    await tavora(cloud, b).sync.beforeLoad();

    await writeFile(path.join(a.userData, "library.json"), "a2");
    await atA.sync();
    await writeFile(path.join(b.userData, "library.json"), "b2!");
    const atB = tavora(cloud, b);
    await atB.sync.beforeLoad();
    // Neither side is lost: B's change stays until the user picks.
    expect(await read(b.userData, "library.json")).toBe("b2!");
    expect(atB.sync.view().conflict).toBe(true);
    // Nothing goes up while the question is open.
    await atB.sync.sync();
    await expect(atB.sync.sync(true)).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });

    await atB.sync.keep("pc");
    expect(atB.sync.view().conflict).toBe(false);
    const backups = await readdir(path.join(b.userData, "backups"));
    const cloudSide = backups.find((name) => name.endsWith("-cloud"))!;
    expect(await read(path.join(b.userData, "backups", cloudSide), "library.json")).toBe("a2");
    // A gets B's side at its next start.
    await tavora(cloud, a).sync.beforeLoad();
    expect(await read(a.userData, "library.json")).toBe("b2!");
  });

  it("finishes a slow download in the background and waits for a restart", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { key, sync: atA } = await startCopy(cloud, a);
    const b = await pc({ "library.json": "b0" });
    const setup = tavora(cloud, b);
    await setup.sync.turnOn();
    await setup.sync.enterKey(key);
    await setup.sync.keep("cloud");
    await tavora(cloud, b).sync.beforeLoad();
    await writeFile(path.join(a.userData, "library.json"), "a2");
    await atA.sync();

    const atB = tavora(cloud, b);
    await atB.sync.beforeLoad(0);
    await until(() => atB.sync.view().restartToTake);
    expect(await read(b.userData, "library.json")).toBe("a1");
    atB.sync.restart();
    expect(atB.events.restarts).toBe(1);
    await tavora(cloud, b).sync.beforeLoad();
    expect(await read(b.userData, "library.json")).toBe("a2");
  });

  it("uploads the last changes before the window closes", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { sync } = await startCopy(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    let closed = 0;
    expect(sync.holdClose(() => void closed++)).toBe(true);
    // A second close while it uploads still waits.
    expect(sync.holdClose(() => void closed++)).toBe(true);
    await until(() => closed === 1);
    // Then the window may close.
    expect(sync.holdClose(() => void closed++)).toBe(false);
    expect((await new CloudCopy(new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => cloud.token })).remote())?.version).toBe(2);
  });

  it("lets the window close at once when the copy is off", async () => {
    const cloud = await service();
    const { sync } = tavora(cloud, await pc({ "library.json": "{}" }));
    await sync.beforeLoad();
    expect(sync.holdClose(() => undefined)).toBe(false);
  });

  it("turns off on every PC when the copy is deleted", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { key } = await startCopy(cloud, a);
    const b = await pc({ "library.json": "b0" });
    const atB = tavora(cloud, b);
    await atB.sync.turnOn();
    await atB.sync.enterKey(key);
    await atB.sync.keep("pc");
    await atB.sync.remove();
    expect(atB.sync.view()).toMatchObject({ on: false, copy: null });

    const atA = tavora(cloud, a);
    await atA.sync.beforeLoad();
    expect(atA.sync.view()).toMatchObject({ on: false, problem: "deleted" });
    // The data on the PCs stays.
    expect(await read(a.userData, "library.json")).toBe("a1");
  });

  it("moves from our server to a folder and back, keeping the recovery key", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a" });
    const { sync, key } = await startCopy(cloud, a);
    sync.keySaved();
    const onedrive = await mkdtemp(path.join(os.tmpdir(), "tavora-onedrive-"));
    try {
      await sync.move(onedrive);
      expect(sync.view()).toMatchObject({ on: true, folder: onedrive, limit: null, problem: null });
      // The server's copy is gone, so the other PCs there turn off.
      expect(await new CloudCopy(new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => cloud.token })).remote()).toBeNull();
      await sync.move(null);
      expect(sync.view()).toMatchObject({ on: true, folder: null });
      expect(await readdir(onedrive)).toEqual([]);
      sync.showKey();
      expect(sync.view().recoveryKey).toBe(key);
    } finally {
      await rm(onedrive, { recursive: true, force: true });
    }
  });

  it("says whether a picked folder is missing or can't be written to, instead of turning on", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a" });
    const { sync } = tavora(cloud, a);
    await sync.beforeLoad();
    const onedrive = await mkdtemp(path.join(os.tmpdir(), "tavora-onedrive-"));
    try {
      await expect(sync.turnOn(path.join(onedrive, "gone"))).rejects.toMatchObject({ key: "cloudCopy.error.no-folder" });
      // Where Tavora keeps its files in the folder is taken by a plain file, so nothing can be written there.
      await writeFile(path.join(onedrive, FOLDER_NAME), "in the way");
      await expect(sync.turnOn(onedrive)).rejects.toMatchObject({ key: "cloudCopy.error.folder-locked" });
      expect(sync.view().on).toBe(false);
    } finally {
      await rm(onedrive, { recursive: true, force: true });
    }
  });

  it("keeps the account's key when the copy is turned off, and forgets it when signed out", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { sync } = await startCopy(cloud, a);
    await sync.turnOff();
    expect(sync.view().on).toBe(false);
    // On again without typing the key, and without showing it again.
    sync.keySaved();
    await sync.turnOn();
    expect(sync.view()).toMatchObject({ on: true, askKey: false, recoveryKey: null });

    await sync.signedOut();
    expect(sync.view().on).toBe(false);
    await sync.turnOn();
    expect(sync.view()).toMatchObject({ on: false, askKey: true });
  });

  it("starts over with a new key when the old one is lost, and other PCs then ask for it", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const { key, sync: running } = await startCopy(cloud, a);
    const b = await pc({ "library.json": "b0" });
    const atB = tavora(cloud, b);
    await atB.sync.turnOn();
    expect(atB.sync.view().askKey).toBe(true);
    await atB.sync.startOver();
    const newKey = atB.sync.view().recoveryKey;
    expect(newKey).toMatch(/^[0-9A-Z]{4}-/);
    expect(newKey).not.toBe(key);
    // B's data is the new copy.
    expect(atB.sync.view()).toMatchObject({ on: true, askKey: false, problem: null, copy: { size: expect.any(Number) } });

    // A sees a newer copy its old key can't open: its key and copy are forgotten, and its data stays.
    const atA = tavora(cloud, a);
    await atA.sync.beforeLoad();
    expect(atA.sync.view()).toMatchObject({ on: false, problem: "new-key" });
    // A, had it still been running with the old key, never overwrites the new copy: it can't open it, and stops.
    await writeFile(path.join(a.userData, "library.json"), "a2");
    await running.sync();
    expect(running.view().conflict).toBe(true);
    await expect(running.keep("pc")).rejects.toMatchObject({ key: "cloudCopy.error.new-key" });
    expect(running.view()).toMatchObject({ on: false, problem: "new-key" });
    await writeFile(path.join(a.userData, "library.json"), "a1");
    await atA.sync.turnOn();
    expect(atA.sync.view().askKey).toBe(true);
    await expect(atA.sync.enterKey(key)).rejects.toMatchObject({ key: "cloudCopy.error.wrongKey" });
    await atA.sync.enterKey(newKey!);
    expect(atA.sync.view()).toMatchObject({ on: true, conflict: true });
    expect(await read(a.userData, "library.json")).toBe("a1");
  });

  it("starts as usual offline or signed out, and says why it did not sync", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    await startCopy(cloud, a);
    const signedOut = tavora(cloud, a, { signedIn: false });
    await signedOut.sync.beforeLoad();
    expect(signedOut.sync.view()).toMatchObject({ on: true, problem: "signed-out" });
    await signedOut.sync.signedOut();
    expect(signedOut.sync.view().on).toBe(false);
  });

  it("goes on at a new PC once another PC sent the key through the copy's folder, signed out", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: { "elden-ring": {} } }) });
    const onedrive = path.join(a.root, "OneDrive");
    await mkdir(onedrive);
    const atA = tavora(cloud, a, { signedIn: false });
    await atA.sync.beforeLoad();
    await atA.sync.turnOn(onedrive);
    expect(atA.sync.view()).toMatchObject({ on: true, folder: onedrive });

    const b = await pc({ "library.json": JSON.stringify({ version: 2, workspaces: {} }) });
    const atB = tavora(cloud, b, { signedIn: false });
    await atB.sync.beforeLoad();
    await atB.sync.turnOn(onedrive);
    expect(atB.sync.view().askKey).toBe(true);

    const pairing = (sync: CopySync, name: string) => {
      return new Pairing({
        copySync: sync,
        account: { token: () => null },
        serviceUrl: "http://tavora.test/v1/account",
        deviceName: name,
        folderTransport: (_folder, deviceName) => new FolderPairing(onedrive, deviceName),
        onChange: () => undefined,
        focus: () => undefined,
      });
    };
    const fromA = pairing(atA.sync, "Desk");
    const toB = pairing(atB.sync, "Laptop");
    await toB.start();
    await fromA.lookForRequests();
    await toB.lookForAnswer();
    await fromA.lookForRequests();
    await fromA.decide(fromA.view().approve!.id, true);
    await toB.lookForAnswer();
    await toB.confirm();
    // B has the key and takes up the copy: it has data of its own, so the user keeps one side.
    expect(atB.sync.view()).toMatchObject({ on: true, askKey: false, conflict: true, folder: onedrive });
    fromA.dispose();
    toB.dispose();
  });
});

describe("what the copy is doing, and closing while it uploads", () => {
  /** Tavora at PC `at` again, with the copy on: its network and its flush (the start of every upload) in the test's hands. */
  async function running(cloud: Service, at: Pc) {
    const net = { offline: false };
    let gate: Promise<void> | null = null;
    const views: CloudCopyView[] = [];
    const sync = new CopySync({
      userData: at.userData,
      enabled: true,
      files: { root: () => at.moduleFiles },
      account: { token: () => cloud.token },
      serviceUrl: "http://tavora.test/v1/account",
      fetch: ((input, init) => (net.offline ? Promise.reject(new TypeError("fetch failed")) : cloud.fetch(input, init))) as typeof fetch,
      encryptor,
      restart: () => undefined,
    });
    sync.attach({ flush: () => gate ?? Promise.resolve(), onChange: (view) => views.push(view) });
    await sync.beforeLoad();
    expect(sync.view().on).toBe(true);
    /** Holds the next uploads at their start until the answer is called. */
    const hold = () => {
      let open!: () => void;
      gate = new Promise((resolve) => (open = resolve));
      return () => {
        gate = null;
        open();
      };
    };
    return { sync, views, net, hold };
  }
  const remoteVersion = (cloud: Service) => cloud.client().remote().then((remote) => remote?.version);
  /** Progress only ever shows while uploading. */
  const consistent = (views: CloudCopyView[]) => views.every((view) => view.progress === null || view.busy === "uploading");

  it("start, progress, done: uploading with how far it got, then idle again", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    await startCopy(cloud, a);
    const { sync, views } = await running(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    views.length = 0;
    await sync.sync(true);
    expect(views[0]).toMatchObject({ busy: "uploading", progress: null });
    expect(views.some((view) => view.busy === "uploading" && view.progress !== null && view.progress.total > 0)).toBe(true);
    expect(views.at(-1)).toMatchObject({ busy: null, progress: null, problem: null });
    expect(consistent(views)).toBe(true);
    expect(await remoteVersion(cloud)).toBe(2);
  });

  it("start, error, retry: offline says so and ends idle; the retry goes up", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    await startCopy(cloud, a);
    const { sync, views, net } = await running(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    net.offline = true;
    await expect(sync.sync(true)).rejects.toMatchObject({ key: "cloudCopy.error.offline" });
    expect(sync.view()).toMatchObject({ busy: null, progress: null, problem: "offline" });
    net.offline = false;
    await sync.sync(true);
    expect(sync.view()).toMatchObject({ busy: null, progress: null, problem: null });
    expect(await remoteVersion(cloud)).toBe(2);
    expect(consistent(views)).toBe(true);
  });

  it("a second start while one runs waits for it, then runs on its own", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    await startCopy(cloud, a);
    const { sync, views, hold } = await running(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    const release = hold();
    views.length = 0;
    const first = sync.sync(true);
    const second = sync.sync(true);
    await until(() => sync.view().busy === "uploading");
    // Only the first one runs, held at its start.
    expect(views.filter((view) => view.busy === "uploading")).toHaveLength(1);
    release();
    await Promise.all([first, second]);
    // Each ran in turn: uploading, idle, uploading, idle.
    const turns = views.map((view) => view.busy).filter((busy, index, all) => busy !== all[index - 1]);
    expect(turns).toEqual(["uploading", null, "uploading", null]);
    expect(sync.view()).toMatchObject({ busy: null, progress: null, problem: null });
    expect(consistent(views)).toBe(true);
    expect(await remoteVersion(cloud)).toBe(2);
  });

  it("quit mid-sync: the close waits, says so after a few seconds, and closes once the upload is done", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    await startCopy(cloud, a);
    const { sync, hold } = await running(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    const release = hold();
    let closed = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(sync.holdClose(() => void closed++)).toBe(true);
      expect(sync.view().closing).toBe(false);
      vi.advanceTimersByTime(CLOSE_QUIET_MS);
      expect(sync.view().closing).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    release();
    await until(() => closed === 1);
    expect(sync.view().closing).toBe(false);
    expect(sync.holdClose(() => void closed++)).toBe(false);
    expect(closed).toBe(1);
    expect(await remoteVersion(cloud)).toBe(2);
  });

  it("quit mid-sync, then Close anyway: closes once, and the notice never shows after", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    await startCopy(cloud, a);
    const { sync, views, hold } = await running(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    const release = hold();
    let closed = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      expect(sync.holdClose(() => void closed++)).toBe(true);
      sync.closeAnyway(() => void closed++);
      expect(closed).toBe(1);
      views.length = 0;
      // Before, the notice's timer still ran and said it was uploading on a window that was closing.
      vi.advanceTimersByTime(CLOSE_QUIET_MS);
      expect(views.some((view) => view.closing)).toBe(false);
      expect(sync.view().closing).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    release();
    // The held upload is queued already; this one runs after it, so nothing writes once the test ends.
    await sync.sync();
    expect(sync.view().busy).toBeNull();
    expect(closed).toBe(1);
  });

  it("quit mid-sync, and the copy turns off meanwhile: the next close goes on, and the upload ending doesn't close again", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    await startCopy(cloud, a);
    const { sync, hold } = await running(cloud, a);
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    const release = hold();
    let closed = 0;
    expect(sync.holdClose(() => void closed++)).toBe(true);
    await until(() => sync.view().busy === "uploading");
    // Signed out on another device: the copy on the service is off here.
    await sync.signedOut();
    expect(sync.holdClose(() => void closed++)).toBe(false);
    release();
    await until(() => sync.view().busy === null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The window closed by itself (holdClose said false); before, the upload's end called close a second time.
    expect(closed).toBe(0);
  });
});

describe("the questions syncing waits on", () => {
  const ALL: Question[] = ["askKey", "conflict", "restartToTake"];
  /** Every mix of the three questions, from none to all (2³ = 8). */
  const mixes: Question[][] = Array.from({ length: 8 }, (_, bits) => ALL.filter((_, index) => bits & (1 << index)));

  /** Opens `questions` on a copy that is on, the way the sync would. */
  async function withQuestions(questions: Question[]) {
    const cloud = await service();
    const a = await pc({ "library.json": "a1" });
    const started = await startCopy(cloud, a);
    for (const question of questions) (started.sync as unknown as { ask(question: Question): void }).ask(question);
    return { ...started, a, cloud };
  }

  it.each(mixes.map((mix) => [mix.join("+") || "none", mix] as const))("Settings reads %s as one flag per open question, the same as three booleans", (_name, mix) => {
    expect(questionsView(new Set(mix))).toEqual({ askKey: mix.includes("askKey"), conflict: mix.includes("conflict"), restartToTake: mix.includes("restartToTake") });
  });

  it.each(mixes.filter((mix) => mix.length > 0).map((mix) => [mix.join("+"), mix] as const))("while %s is open the quiet sync waits and a pressed one stops at a conflict only", async (_name, mix) => {
    const { sync, a, cloud } = await withQuestions(mix);
    expect(sync.view()).toMatchObject(questionsView(new Set(mix)));
    await writeFile(path.join(a.userData, "library.json"), "a2 changed");
    // Quiet: nothing goes up.
    await sync.sync();
    expect((await new CloudCopy(new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => cloud.token })).remote())?.version).toBe(1);
    // Pressed: a conflict refuses; the other questions let the button through.
    if (mix.includes("conflict")) await expect(sync.sync(true)).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });
    else {
      await sync.sync(true);
      expect((await new CloudCopy(new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => cloud.token })).remote())?.version).toBe(2);
    }
    // Moving the copy waits on any of them.
    await expect(sync.move("/elsewhere")).rejects.toMatchObject({ key: "cloudCopy.error.conflict" });
  });

  it("keeping a side answers the conflict and the restart together and leaves the key question", async () => {
    const { sync } = await withQuestions(ALL);
    await sync.keep("pc");
    expect(sync.view()).toMatchObject({ askKey: true, conflict: false, restartToTake: false });
  });

  it.each(mixes.map((mix) => [mix.join("+") || "none", mix] as const))("turning the copy off with %s open closes every question", async (_name, mix) => {
    const { sync } = await withQuestions(mix);
    await sync.turnOff();
    expect(sync.view()).toMatchObject({ on: false, askKey: false, conflict: false, restartToTake: false });
  });

  it.each(mixes.filter((mix) => mix.length > 0).map((mix) => [mix.join("+"), mix] as const))("closing the window does not hold for an upload while %s is open", async (_name, mix) => {
    const { sync } = await withQuestions(mix);
    expect(sync.holdClose(() => undefined)).toBe(false);
  });
});
