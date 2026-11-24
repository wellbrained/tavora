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
async function turnedOffDuringTheAnswer(s: Awaited<ReturnType<typeof setup>>, turnOffFails: boolean) {
  let off: Promise<unknown> | null = null;
  meanwhile = async (to) => {
    if (off || !to.endsWith("cloud-copy-status.json")) return;
    if (turnOffFails) {
      // The answer's write is under way; the turn-off's own status write fails (a full disk), and so does its removal.
      failing = (from) => (from.includes("cloud-copy-status.json") ? "ENOSPC" : null);
      rmFailing = (file) => file.endsWith("cloud-copy-status.json");
    }
    // Not waited for in here: it writes the status right after the write under way.
    off = s.t.sync.turnOff().then(
      () => "off",
      () => "failed",
    );
  };
  const answer = await s.t.sync.restore().then(
    () => "resolved",
    () => "failed",
  );
  const turnOff = await off;
  failing = () => null;
  rmFailing = () => false;
  meanwhile = async () => undefined;
  const status = await readFile(statusFile(s.a), "utf8").then(
    (text) => (JSON.parse(text) as { phase: string }).phase,
    () => "idle",
  );
  return { answer, turnOff, status };
}

describe("turned off while Use the cloud copy writes its answer", () => {
  it("off: nothing is left chosen, nothing restarts, and nothing goes up", async () => {
    const s = await setup();
    expect(await turnedOffDuringTheAnswer(s, false)).toEqual({ answer: "resolved", turnOff: "off", status: "idle" });
    expect(s.t.sync.view().on).toBe(false);
    expect(s.t.events.restarts).toBe(0);
    expect(s.t.sync.dataHeld).toBe(false);
    const before = await s.remote();
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"pc, after the answer"}');
    await s.t.sync.sync(true).catch(() => undefined);
    expect(await s.remote()).toBe(before);
  }, 60_000);

  it("couldn't be turned off: the answer stands on disk and here, so nothing goes up over the chosen copy", async () => {
    const s = await setup();
    expect(await turnedOffDuringTheAnswer(s, true)).toEqual({ answer: "resolved", turnOff: "failed", status: "chosen" });
    expect(s.t.sync.view().on).toBe(true);
    // The chosen copy goes in at the restart; until then nothing of this PC's goes up.
    expect(s.t.events.restarts).toBe(1);
    expect(s.t.sync.dataHeld).toBe(true);
    const before = await s.remote();
    await writeFile(path.join(s.a.userData, "workspace.json"), '{"from":"pc, after the answer"}');
    await s.t.sync.sync(true).catch(() => undefined);
    expect(await s.remote()).toBe(before);
  }, 60_000);
});
