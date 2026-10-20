import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CloudCopyView } from "../shared/host-api";
import { CloudCopy, ServiceStorage } from "./cloud-copy";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { CopySync } from "./cloud-copy-sync";

afterEach(cleanUp);

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };

type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

/** Tavora on a PC: the cloud copy as the host runs it, with what it showed and whether it restarted. */
function tavora(cloud: Service, at: Pc, { signedIn = true } = {}) {
  const views: CloudCopyView[] = [];
  const events = { restarts: 0, closed: 0 };
  const sync = new CopySync({
    userData: at.userData,
    enabled: true,
    moduleFiles: () => at.moduleFiles,
    service: new ServiceStorage({ baseUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, token: () => (signedIn ? cloud.token : null) }),
    encryptor,
    flush: async () => undefined,
    restart: () => void events.restarts++,
    onChange: (view) => views.push(view),
  });
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
  it("brings PC A's data to PC B once B has the recovery key, keeping B's own settings and data", async () => {
    const cloud = await service();
    const a = await pc({ "library.json": JSON.stringify({ version: 1, games: { "elden-ring": {} }, moduleFilesFolder: "C:\\A pictures" }), "modules/dice/manifest.json": "dice" });
    const { key } = await startCopy(cloud, a);

    const b = await pc({ "library.json": JSON.stringify({ version: 1, games: {}, developmentFolders: ["D:\\mine"] }) });
    const atB = tavora(cloud, b);
    await atB.sync.beforeLoad();
    await atB.sync.turnOn();
    expect(atB.sync.view().askKey).toBe(true);
    await expect(atB.sync.enterKey("not a key")).rejects.toMatchObject({ key: "cloudCopy.error.badKey" });
    const other = (await startCopy(await service(), await pc({ "library.json": "{}" }))).key;
    await expect(atB.sync.enterKey(other)).rejects.toMatchObject({ key: "cloudCopy.error.wrongKey" });
    expect(atB.sync.view().on).toBe(false);

    await atB.sync.enterKey(key.toLowerCase().replace(/-/g, " "));
    // B has data of its own: the player keeps one side.
    expect(atB.sync.view()).toMatchObject({ on: true, askKey: false, conflict: true });
    await atB.sync.keep("cloud");
    expect(atB.events.restarts).toBe(1);
    // Nothing changed yet: the copy is taken at the start, before anything reads the data.
    expect(JSON.parse(await read(b.userData, "library.json")).games).toEqual({});

    const restarted = tavora(cloud, b);
    await restarted.sync.beforeLoad();
    const library = JSON.parse(await read(b.userData, "library.json"));
    expect(library.games).toEqual({ "elden-ring": {} });
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
    // Neither side is lost: B's change stays until the player picks.
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
});
