// Whole sequences across several starts, written apart from the other cloud copy tests. Each states the correct result.
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopySync } from "./cloud-copy-sync";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { readSavedFile } from "./json";

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return { ...real, rename: vi.fn(real.rename), stat: vi.fn(real.stat), readFile: vi.fn(real.readFile) };
});
const realRename = vi.mocked(rename).getMockImplementation()!;
const realStat = vi.mocked(stat).getMockImplementation()!;
const realRead = vi.mocked(readFile).getMockImplementation()!;
let held: (from: string, to: string) => boolean = () => false;
let busyRead: (file: string) => boolean = () => false;
beforeEach(() => {
  held = () => false;
  busyRead = () => false;
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (held(String(from), String(to))) throw Object.assign(new Error("held"), { code: "EPERM" });
    return realRename(from, to);
  });
  vi.mocked(stat).mockImplementation(realStat as never);
  vi.mocked(readFile).mockImplementation(((file: string, options: never) => (busyRead(String(file)) ? Promise.reject(Object.assign(new Error("busy"), { code: "EBUSY" })) : realRead(file, options))) as never);
});
afterEach(async () => {
  held = () => false;
  busyRead = () => false;
  await cleanUp();
});
const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };
type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;
function tavora(cloud: Service, at: Pc) {
  const events = { restarts: 0 };
  const sync = new CopySync({ userData: at.userData, enabled: true, files: { root: () => at.moduleFiles }, account: { token: () => cloud.token, id: () => "me" }, serviceUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, encryptor, restart: () => void events.restarts++ });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return { sync, events };
}
const lib = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const read = (at: Pc, name: string) => realRead(path.join(at.userData, name), "utf8") as Promise<string>;
const there = (file: string) => realStat(file).then(() => true, () => false);
const remoteVersion = async (cloud: Service) => (await cloud.client().remote())?.version;
const statusFile = (at: Pc) => path.join(at.userData, "cloud-copy-status.json");
const stateFile = (at: Pc) => path.join(at.userData, "cloud-copy.json");
const A = { "library.json": lib("elden-ring"), "workspace.json": '{"from":"copy"}', "modules/dice/m.json": "dice copy", "module-data/x/y.json": "data copy" };
const B = { "library.json": lib("hollow-knight"), "workspace.json": '{"from":"pc"}', "modules/dice/m.json": "dice pc", "module-data/x/y.json": "data pc" };
async function pair() {
  const cloud = await service();
  const a = await pc(A);
  const first = tavora(cloud, a);
  await first.sync.beforeLoad();
  await first.sync.turnOn();
  const key = first.sync.view().recoveryKey!;
  const b = await pc(B);
  const at = tavora(cloud, b);
  await at.sync.beforeLoad();
  await at.sync.turnOn();
  await at.sync.enterKey(key);
  return { cloud, a, b, at, first };
}
async function everything(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await everything(full)));
    else out.push((await realRead(full, "utf8")) as string);
  }
  return out;
}
const stuckAt = (dirName: string) => (from: string) => path.basename(from) === dirName && from.includes("cloud-copy-staging");

describe("sequences across starts", () => {
  it("work after Later on a stuck module-data swap survives three later swaps", async () => {
    const { cloud, a, b, at } = await pair();
    await at.sync.keep("cloud");
    held = stuckAt("module-data");
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    expect(stuck.sync.view().swapUnfinished).toBe(true);
    held = () => false;
    await mkdir(path.join(b.userData, "module-data", "x"), { recursive: true });
    await writeFile(path.join(b.userData, "module-data", "x", "work.json"), "my work after later");
    const settled = tavora(cloud, b);
    await settled.sync.beforeLoad();
    expect(settled.sync.changesKeptIn).not.toBeNull();
    await settled.sync.sync().catch(() => undefined);
    for (let round = 0; round < 4; round++) {
      await writeFile(path.join(a.userData, "workspace.json"), `{"from":"copy","round":${round}}`);
      const up = tavora(cloud, a);
      await up.sync.beforeLoad();
      await up.sync.sync(true).catch(() => undefined);
      const down = tavora(cloud, b);
      await down.sync.beforeLoad();
      await down.sync.sync().catch(() => undefined);
    }
    expect(await everything(path.join(b.userData, "backups"))).toContain("my work after later");
  }, 90_000);

  it("Restore plus a busy staged file at restart uploads nothing", async () => {
    const { cloud, b, at } = await pair();
    await at.sync.keep("cloud");
    const version = await remoteVersion(cloud);
    busyRead = (file) => file.includes("cloud-copy-staging") && file.endsWith("copy-list.json");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    await next.sync.sync().catch(() => undefined);
    await expect(next.sync.sync(true)).rejects.toBeTruthy();
    expect(await remoteVersion(cloud)).toBe(version);
    expect(next.sync.dataHeld).toBe(true);
  }, 60_000);

  it("a busy library doesn't skip the workspaces guard", async () => {
    const { cloud, a, b, at } = await pair();
    await at.sync.keep("pc");
    await writeFile(path.join(a.userData, "library.json"), lib("something-else"));
    const up = tavora(cloud, a);
    await up.sync.beforeLoad();
    if (up.sync.view().conflict) await up.sync.keep("cloud");
    const again = tavora(cloud, a);
    await again.sync.beforeLoad();
    await writeFile(path.join(a.userData, "library.json"), lib("something-else"));
    await again.sync.sync(true).catch(() => undefined);
    const libFile = path.join(b.userData, "library.json");
    busyRead = (file) => file === libFile;
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    busyRead = () => false;
    expect(JSON.parse(await read(b, "library.json")).workspaces).toHaveProperty("hollow-knight");
    expect(next.sync.dataHeld || next.sync.view().conflict || next.sync.view().restartToTake).toBe(true);
  }, 60_000);

  it("turning off with a busy status keeps the undo mark", async () => {
    const { cloud, b, at } = await pair();
    await at.sync.keep("cloud");
    held = stuckAt("modules");
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    const before = await realRead(statusFile(b), "utf8");
    held = (from, to) => to === statusFile(b);
    await expect(stuck.sync.turnOff()).rejects.toBeTruthy();
    held = () => false;
    expect(await realRead(statusFile(b), "utf8")).toBe(before);
    expect(await there(stateFile(b))).toBe(true);
    await stuck.sync.turnOff();
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(await read(b, "workspace.json")).toBe(B["workspace.json"]);
  }, 60_000);

  it("going back after no changes leaves no written-since", async () => {
    const { cloud, b, at } = await pair();
    await at.sync.keep("cloud");
    held = stuckAt("modules");
    const stuck = tavora(cloud, b);
    await stuck.sync.beforeLoad();
    held = () => false;
    await stuck.sync.keep("pc");
    const next = tavora(cloud, b);
    await next.sync.beforeLoad();
    expect(next.sync.changesKeptIn).toBeNull();
    const backups = path.join(b.userData, "backups");
    for (const name of await readdir(backups)) expect(await there(path.join(backups, name, "written-since"))).toBe(false);
  }, 60_000);

  it("a busy cloud-copy.json keeps the lost-data hold", async () => {
    const cloud = await service();
    const a = await pc(A);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    const version = await remoteVersion(cloud);
    await writeFile(path.join(a.userData, "library.json"), "{ broken");
    await readSavedFile(path.join(a.userData, "library.json"), { version: 2 });
    const lost = tavora(cloud, a);
    await lost.sync.beforeLoad();
    await lost.sync.checkDataFiles();
    expect(lost.sync.view().lostData).toBe(true);
    busyRead = (file) => file === stateFile(a);
    const busy = tavora(cloud, a);
    await busy.sync.beforeLoad();
    expect(busy.sync.dataHeld).toBe(true);
    busyRead = () => false;
    const after = tavora(cloud, a);
    await after.sync.beforeLoad();
    expect(after.sync.view().lostData).toBe(true);
    await after.sync.sync().catch(() => undefined);
    expect(await remoteVersion(cloud)).toBe(version);
  }, 60_000);

  it("a broken chosen copy from an older Tavora uploads nothing", async () => {
    const cloud = await service();
    const a = await pc(A);
    const first = tavora(cloud, a);
    await first.sync.beforeLoad();
    await first.sync.turnOn();
    const version = await remoteVersion(cloud);
    const saved = JSON.parse((await realRead(stateFile(a), "utf8")) as string) as { version: number };
    await mkdir(path.join(a.userData, "cloud-copy-staging", "data"), { recursive: true });
    await writeFile(path.join(a.userData, "cloud-copy-staging", "staged.json"), JSON.stringify({ v: 1, version: saved.version, pictures: true, take: true, files: { "library.json": { size: 5, sha256: "0".repeat(64), parts: [] } } }));
    await writeFile(path.join(a.userData, "workspace.json"), '{"from":"bad local"}');
    const next = tavora(cloud, a);
    await next.sync.beforeLoad();
    await next.sync.checkDataFiles();
    await next.sync.sync().catch(() => undefined);
    expect(await remoteVersion(cloud)).toBe(version);
  }, 60_000);
});
