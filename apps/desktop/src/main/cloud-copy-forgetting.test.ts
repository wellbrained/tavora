// Turning the copy off while Use the cloud copy writes its answer. The status file's writes go one at a time
// (copy-files.ts), so the turn-off writes its status right after the answer's: the answer waits for it to settle. Once it
// is off, nothing restarts and nothing is left chosen; when it couldn't be turned off, the answer stands, on disk and here.
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopySync } from "./cloud-copy-sync";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { FolderStorage } from "./copy-folder";
import { readSavedFile } from "./json";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(real.rename), rm: vi.fn(real.rm) };
});
const realRename = vi.mocked(rename).getMockImplementation()!;
const realRm = vi.mocked(rm).getMockImplementation()!;
/** A rename that fails with this code (a full disk), or none. */
let failing: (from: string) => string | null = () => null;
/** A removal that fails as busy. */
let rmFailing: (file: string) => boolean = () => false;
/** Runs before a rename onto `to` goes on: what happens meanwhile (the user turning the copy off). */
let meanwhile: (to: string) => Promise<void> = async () => undefined;

beforeEach(() => {
  failing = () => null;
  rmFailing = () => false;
  meanwhile = async () => undefined;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    const code = failing(String(from));
    if (code) throw Object.assign(new Error(code), { code });
    await meanwhile(String(to));
    return realRename(from, to);
  });
  vi.mocked(rm).mockImplementation(async (file, options) => {
    if (rmFailing(String(file))) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    return realRm(file, options);
  });
});
afterEach(async () => {
  failing = () => null;
  rmFailing = () => false;
  meanwhile = async () => undefined;
  await cleanUp();
});

type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;
const encryptor = { ready: async () => true, isAvailable: () => true, encrypt: async (text: string) => Buffer.from(`sealed:${text}`), decrypt: async (data: Buffer) => data.toString().replace(/^sealed:/, "") };
const lib = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const there = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );
const statusFile = (at: Pc) => path.join(at.userData, "cloud-copy-status.json");

function tavora(cloud: Service, at: Pc) {
  const events = { restarts: 0 };
  const sync = new CopySync({
    userData: at.userData,
    enabled: true,
    files: { root: () => at.moduleFiles, defaultRoot: () => at.moduleFiles },
    account: { token: () => cloud.token, id: () => "me" },
    serviceUrl: "http://tavora.test/v1/account",
    fetch: cloud.fetch,
    encryptor,
    restart: () => void events.restarts++,
  });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return { sync, events };
}

/** As host.ts: settle, read the library, check, save fresh files where missing. */
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

const A = { "library.json": lib("elden-ring"), "workspace.json": '{"from":"copy"}', "profile.json": '{"name":"copy"}' };

/** PC A with its copy in a folder, started again, and the newest version in that folder. */
async function setup() {
  const cloud = await service();
  const a = await pc(A);
  const folder = path.join(a.root, "OneDrive");
  await mkdir(folder);
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn(folder);
  const storage = new FolderStorage(folder);
  return { cloud, a, t: await appStart(cloud, a), remote: async () => (await storage.remote())?.version };
}

/** Use the cloud copy, with the copy turned off while its answer is being written (and that turn-off made to fail, or not). */
async function turnedOffDuringTheAnswer(s: Awaited<ReturnType<typeof setup>>, turnOffFails: boolean, by: "user" | "background" = "user", failsAt: "status" | "state-file" = "status") {
  let off: Promise<unknown> | null = null;
  meanwhile = async (to) => {
    if (off || !to.endsWith("cloud-copy-status.json")) return;
    if (turnOffFails && failsAt === "state-file") {
      // The turn-off's status write works, but the state file stays busy.
      rmFailing = (file) => file.endsWith("cloud-copy.json");
    } else if (turnOffFails) {
      // The answer's write is under way; the turn-off's own status write fails (a full disk), and so does its removal.
      failing = (from) => (from.includes("cloud-copy-status.json") ? "ENOSPC" : null);
      rmFailing = (file) => file.endsWith("cloud-copy-status.json");
    }
    // Not waited for in here: it writes the status right after the write under way.
    // A background forget (the copy was deleted, a new key) is not the user's turn-off.
    off = (by === "user" ? s.t.sync.turnOff() : (s.t.sync as unknown as { forget(problem: string | null): Promise<void> }).forget("deleted")).then(
      () => "off",
      () => "failed",
    );
  };
  let answerKey: string | null = null;
  const answer = await s.t.sync.restore().then(
    () => "resolved",
    (error: { key?: string }) => {
      answerKey = error.key ?? null;
      return "failed";
    },
  );
  const turnOff = await off;
  failing = () => null;
  rmFailing = () => false;
  meanwhile = async () => undefined;
  const status = await readFile(statusFile(s.a), "utf8").then(
    (text) => (JSON.parse(text) as { phase: string }).phase,
    () => "idle",
  );
  return { answer, answerKey, turnOff, status };
}

describe("turning the copy off while its state file is busy", () => {
  it("a file that lets go after a moment: the copy goes off and stays off at the next start", async () => {
    const s = await setup();
    let busyFor = 2;
    rmFailing = (file) => file.endsWith("cloud-copy.json") && busyFor-- > 0;
    await expect(s.t.sync.turnOff()).resolves.toBeUndefined();
    expect(s.t.sync.view().on).toBe(false);
    expect(await there(path.join(s.a.userData, "cloud-copy.json"))).toBe(false);
    const next = tavora(s.cloud, s.a);
    await next.sync.beforeLoad();
    expect(next.sync.view().on).toBe(false);
  }, 60_000);

  it("no upload starts while it is retried, so the state file isn't written back", async () => {
    const s = await setup();
    let busyFor = 3;
    rmFailing = (file) => file.endsWith("cloud-copy.json") && busyFor-- > 0;
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"pc, changed"}');
    const off = s.t.sync.turnOff();
    const up = s.t.sync.sync(true).catch(() => undefined);
    await off;
    await up;
    expect(s.t.sync.view().on).toBe(false);
    expect(await there(path.join(s.a.userData, "cloud-copy.json"))).toBe(false);
    const next = tavora(s.cloud, s.a);
    await next.sync.beforeLoad();
    expect(next.sync.view().on).toBe(false);
  }, 60_000);

  it("the state parked while a copy waits is tried again too, and a busy one fails the turn-off", async () => {
    const s = await setup();
    const parked = path.join(s.a.userData, "cloud-copy-swapping.json");
    await writeFile(parked, await readFile(path.join(s.a.userData, "cloud-copy.json")));
    rmFailing = (file) => file.endsWith("cloud-copy-swapping.json");
    await expect(s.t.sync.turnOff()).rejects.toMatchObject({ key: "cloudCopy.error.offFailed" });
    expect(s.t.sync.view().on).toBe(true);
    expect(await there(parked)).toBe(true);
    rmFailing = () => false;
    await expect(s.t.sync.turnOff()).resolves.toBeUndefined();
    expect(await there(parked)).toBe(false);
  }, 60_000);

  it("a file that stays busy: the turn-off fails, the copy shows as still on, and it is on at the next start too", async () => {
    const s = await setup();
    rmFailing = (file) => file.endsWith("cloud-copy.json");
    await expect(s.t.sync.turnOff()).rejects.toMatchObject({ key: "cloudCopy.error.offFailed" });
    expect(s.t.sync.view().on).toBe(true);
    expect(await there(path.join(s.a.userData, "cloud-copy.json"))).toBe(true);
    const next = tavora(s.cloud, s.a);
    await next.sync.beforeLoad();
    expect(next.sync.view().on).toBe(true);
    rmFailing = () => false;
    // Pressing it again works once the file lets go.
    await expect(s.t.sync.turnOff()).resolves.toBeUndefined();
    expect(s.t.sync.view().on).toBe(false);
    expect(await there(path.join(s.a.userData, "cloud-copy.json"))).toBe(false);
  }, 60_000);
});

describe("turned off while Use the cloud copy writes its answer", () => {
  it("off: nothing is left chosen, nothing restarts, and nothing goes up", async () => {
    const s = await setup();
    expect(await turnedOffDuringTheAnswer(s, false)).toEqual({ answer: "resolved", answerKey: null, turnOff: "off", status: "idle" });
    expect(s.t.sync.view().on).toBe(false);
    expect(s.t.events.restarts).toBe(0);
    expect(s.t.sync.dataHeld).toBe(false);
    const before = await s.remote();
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"pc, after the answer"}');
    await s.t.sync.sync(true).catch(() => undefined);
    expect(await s.remote()).toBe(before);
  }, 60_000);

  it("couldn't be turned off: the answer says the copy is still on and nothing restarts; nothing goes up over the chosen copy; the next press restarts", async () => {
    const s = await setup();
    expect(await turnedOffDuringTheAnswer(s, true)).toEqual({ answer: "failed", answerKey: "cloudCopy.error.offFailed", turnOff: "failed", status: "chosen" });
    expect(s.t.sync.view().on).toBe(true);
    expect(s.t.events.restarts).toBe(0);
    expect(s.t.sync.dataHeld).toBe(true);
    const before = await s.remote();
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"pc, after the answer"}');
    await s.t.sync.sync(true).catch(() => undefined);
    expect(await s.remote()).toBe(before);
    // The user presses Use the cloud copy again: it restarts.
    await expect(s.t.sync.restore()).resolves.toBeUndefined();
    expect(s.t.events.restarts).toBe(1);
  }, 60_000);

  it("couldn't be turned off because the state file stays busy: the answer says so, and its status stands on disk", async () => {
    const s = await setup();
    expect(await turnedOffDuringTheAnswer(s, true, "user", "state-file")).toEqual({ answer: "failed", answerKey: "cloudCopy.error.offFailed", turnOff: "failed", status: "chosen" });
    expect(s.t.sync.view().on).toBe(true);
    expect(s.t.events.restarts).toBe(0);
  }, 60_000);

  it("a background forget that fails (not the user's turn-off) doesn't stop the answer with the turn-off message", async () => {
    const s = await setup();
    const result = await turnedOffDuringTheAnswer(s, true, "background");
    expect(result).toMatchObject({ answer: "resolved", answerKey: null, turnOff: "failed", status: "chosen" });
    expect(s.t.events.restarts).toBe(1);
  }, 60_000);
});

describe("an upload racing the turn-off", () => {
  const stateAt = (s: Awaited<ReturnType<typeof setup>>) => path.join(s.a.userData, "cloud-copy.json");
  async function onAtNextStart(s: Awaited<ReturnType<typeof setup>>) {
    const next = tavora(s.cloud, s.a);
    await next.sync.beforeLoad();
    return next.sync.view().on;
  }

  it("no upload starts while the turn-off retries a busy state file, and nothing is written back", async () => {
    const s = await setup();
    const before = await s.remote();
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"pc, changed"}');
    let up: Promise<unknown> | null = null;
    let busy = 2;
    rmFailing = (file) => {
      if (!file.endsWith("cloud-copy.json") || busy <= 0) return false;
      busy--;
      // Upload now (or the timer), while the turn-off waits for the busy file.
      up ??= s.t.sync.sync(true).catch(() => undefined);
      return true;
    };
    await s.t.sync.turnOff();
    await up;
    expect(up).not.toBeNull();
    expect(await s.remote()).toBe(before);
    expect(s.t.sync.view().on).toBe(false);
    expect(await there(stateAt(s))).toBe(false);
    expect(await onAtNextStart(s)).toBe(false);
  }, 60_000);

  it("a sync already past its checks that uploads during the removal writes nothing back, even when the fresh file is then busy", async () => {
    const s = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    s.t.sync.attach({ flush: () => gate, onChange: () => undefined });
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"pc, changed"}');
    // Started before the turn-off: past its checks, waiting for the panels to save.
    const up = s.t.sync.sync(true).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    let racing = false;
    let wrote = false;
    meanwhile = async (to) => {
      if (racing && to.endsWith("cloud-copy.json")) wrote = true;
    };
    let parkedTries = 0;
    rmFailing = (file) => {
      // The parked file is held for all but the last try (about 770 ms): the upload goes up meanwhile.
      if (file.endsWith("cloud-copy-swapping.json") && parkedTries++ < 5) {
        if (!racing) {
          racing = true;
          release();
        }
        return true;
      }
      // A state file written meanwhile is held by the virus scan.
      return wrote && file.endsWith("cloud-copy.json");
    };
    await s.t.sync.turnOff();
    await up;
    rmFailing = () => false;
    expect(s.t.sync.view().on).toBe(false);
    expect(await there(stateAt(s))).toBe(false);
    expect(await onAtNextStart(s)).toBe(false);
  }, 60_000);
});
