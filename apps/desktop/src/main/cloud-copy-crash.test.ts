// A power cut at every file operation of settling a cloud copy, and a second one at every operation after that, on the
// real code. Whatever happens, nothing uploads a mix of two sides, and neither side's data is lost.
import { link, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CloudCopy, copyRoots, EMPTY_STATE, hasLocalChanges, scanCopy, type CopyState } from "./cloud-copy";
import { CopySync } from "./cloud-copy-sync";
import { stepSwap, SWAP_IDLE, type SwapEvent, type SwapPlan, type SwapStatus } from "./cloud-copy-swap";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { FolderStorage } from "./copy-folder";
import { readSavedFile } from "./json";

const power = vi.hoisted(() => ({
  at: null as number | null,
  count: 0,
  fired: false,
  /** Files a virus scan holds for a moment: reading them fails as busy. */
  busy: new Set<string>(),
  read(file: unknown) {
    if (this.busy.has(String(file))) throw Object.assign(new Error("busy"), { code: "EBUSY" });
  },
  trip() {
    if (this.at === null) return;
    if (this.count++ >= this.at) {
      this.fired = true;
      throw Object.assign(new Error("power cut"), { code: "EPOWER" });
    }
  },
}));

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  const guard = <T extends (...args: never[]) => unknown>(fn: T) =>
    (async (...args: never[]) => {
      power.trip();
      return fn(...args);
    }) as unknown as T;
  return {
    ...real,
    rename: guard(real.rename),
    rm: guard(real.rm),
    rmdir: guard(real.rmdir),
    mkdir: guard(real.mkdir),
    writeFile: guard(real.writeFile),
    cp: guard(real.cp),
    readFile: (async (file: never, options: never) => {
      power.read(file);
      return real.readFile(file, options);
    }) as typeof real.readFile,
    stat: (async (file: never, options: never) => {
      power.read(file);
      return real.stat(file, options);
    }) as typeof real.stat,
    open: (async (file: never, flags: never, mode: never) => {
      if (flags !== undefined && flags !== "r") power.trip();
      return real.open(file, flags, mode);
    }) as typeof real.open,
  };
});

afterAll(cleanUp);

/**
 * CI goes through every first cut. Locally every fifth one, as the whole table takes minutes: set TAVORA_CRASH_ALL to run
 * all of it.
 */
const EVERY_FIRST_CUT = Boolean(process.env.CI || process.env.TAVORA_CRASH_ALL);
const skipFirstCut = (n: number) => !EVERY_FIRST_CUT && n % 5 !== 0;
/** A cut deeper down, where a test cuts three starts in a row: every fifth one, and all of them with TAVORA_CRASH_ALL. */
const skipDeeperCut = (n: number) => !process.env.TAVORA_CRASH_ALL && n % 5 !== 0;

const encryptor = { ready: async () => true, isAvailable: () => true, encrypt: async (text: string) => Buffer.from(`sealed:${text}`), decrypt: async (data: Buffer) => data.toString().replace(/^sealed:/, "") };
type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

/** Restarts asked for since the last look. */
let restarts = 0;
const tavora = (cloud: Service, at: Pc) => {
  const sync = new CopySync({ userData: at.userData, enabled: true, files: { root: () => at.moduleFiles }, account: { token: () => cloud.token, id: () => "me" }, serviceUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, encryptor, restart: () => void restarts++ });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return sync;
};

const library = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
// Each side has module files too: B has a folder of them the copy doesn't hold at all.
const A: Record<string, string> = { "library.json": library("elden-ring"), "workspace.json": '{"from":"copy"}', "modules/dice/m.json": "dice copy", "module-data/x/y.json": "data copy", "module-blobs/official/pic.txt": "pic copy", "profile.json": "{\"name\":\"copy\"}" };
const B: Record<string, string> = { "library.json": library("hollow-knight"), "workspace.json": '{"from":"pc"}', "modules/dice/m.json": "dice pc", "module-data/x/y.json": "data pc", "module-blobs/official/pic.txt": "pic pc", "module-blobs/local/own.txt": "own pc", "profile.json": "{\"name\":\"pc\"}" };
const NAMES = Object.keys(B);
const fileOf = (at: Pc, name: string) => (name.startsWith("module-blobs/") ? path.join(at.moduleFiles, ...name.split("/").slice(1)) : path.join(at.userData, ...name.split("/")));
const read = (at: Pc, name: string) => readFile(fileOf(at, name), "utf8").catch(() => "<gone>");
const statusFile = (at: Pc) => path.join(at.userData, "cloud-copy-status.json");
const STATUS = "cloud-copy-status.json";
const phaseOf = async (at: Pc) => {
  const text = await readFile(statusFile(at), "utf8").catch(() => null);
  return text === null ? "idle" : (JSON.parse(text) as { phase: string }).phase;
};

async function everything(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await everything(full)));
    else out.push(await readFile(full, "utf8").catch(() => ""));
  }
  return out;
}

/**
 * A snapshot of a folder, its files hard-linked. A power cut leaves file dates alone, and the copy tells a change by size
 * and date, so a snapshot has to keep them to the last digit: `cp` gives new ones on Linux, which reads as a local edit.
 * Tavora replaces files by renaming, so a link keeps what it held; a test changing a file uses replaceFile.
 */
async function snapshotOf(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await snapshotOf(path.join(from, entry.name), path.join(to, entry.name));
    else await link(path.join(from, entry.name), path.join(to, entry.name));
  }
}

/** Writes a file without touching the snapshots that link to it. */
async function replaceFile(file: string, text: string): Promise<void> {
  await rm(file, { force: true });
  await writeFile(file, text);
}

const restore = async (at: Pc, from: string) => {
  await rm(at.root, { recursive: true, force: true });
  await snapshotOf(from, at.root);
};

/** Runs `work` with the power going off before its operation number `at`. False when it finished before that. */
async function cut(work: () => Promise<unknown>, at: number): Promise<boolean> {
  power.at = at;
  power.count = 0;
  power.fired = false;
  await work().catch(() => undefined);
  const fired = power.fired;
  power.at = null;
  power.fired = false;
  return fired;
}

/**
 * The files under a folder as one string, with what changes from run to run left out (dates in backup names, random temp
 * names). What a start does depends only on this, so a state already checked needs no second look.
 */
async function signature(dir: string, root = dir): Promise<string> {
  const parts: string[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((x, y) => x.name.localeCompare(y.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) parts.push(path.relative(root, full), await signature(full, root));
    else parts.push(path.relative(root, full), await readFile(full, "utf8").catch(() => "<unreadable>"));
  }
  return parts.join("|").replace(/cloud-copy-\d{4}-[0-9TZ-]+-/g, "cloud-copy-<date>-").replace(/\.[0-9a-f]{12}\.tmp/g, ".<random>.tmp");
}

/** Every power cut of `work`, each from the same files on disk. `after` runs once for each different state a cut leaves. */
async function everyCut(at: Pc, from: string, work: () => Promise<unknown>, after: (step: number) => Promise<void>, seen = new Set<string>()): Promise<number> {
  for (let step = 0; step < 400; step++) {
    await restore(at, from);
    if (!(await cut(work, step))) return step;
    const state = await signature(at.root);
    if (seen.has(state)) continue;
    seen.add(state);
    await after(step);
  }
  throw new Error("it never finished");
}

/** B has its own data, and the user chose A's copy. */
async function chosen() {
  const cloud = await service();
  const a = await pc(A);
  // In a folder: the service's rate limit would stop a test that looks this often.
  const folder = path.join(a.root, "OneDrive");
  await mkdir(folder);
  const first = tavora(cloud, a);
  await first.beforeLoad();
  await first.turnOn(folder);
  const b = await pc(B);
  const at = tavora(cloud, b);
  await at.beforeLoad();
  await at.turnOn(folder);
  await at.enterKey(first.view().recoveryKey!);
  await at.keep("cloud");
  const snapshot = `${b.root}-chosen`;
  await snapshotOf(b.root, snapshot);
  const storage = new FolderStorage(folder);
  const remote = async () => (await storage.remote())?.version;
  return { cloud, b, snapshot, folder, key: first.accountKey.copyKey()!, version: await remote(), remote };
}

type Setup = Awaited<ReturnType<typeof chosen>>;

/** The copy is in, nothing is held, B's data is safe in a backup, and nothing went up. */
async function copyIsIn({ cloud, b, version, remote }: Setup, label: string, bad: string[]) {
  const next = tavora(cloud, b);
  await next.beforeLoad();
  for (const name of Object.keys(A)) if ((await read(b, name)) !== A[name]) bad.push(`${label}: ${name} is ${await read(b, name)}`);
  const kept = await everything(path.join(b.userData, "backups"));
  for (const name of NAMES) if (!kept.includes(B[name]!)) bad.push(`${label}: lost this PC's ${name}`);
  if (next.dataHeld) bad.push(`${label}: still held`);
  await next.sync().catch(() => undefined);
  if ((await remote()) !== version) bad.push(`${label}: uploaded`);
}

/** B's data is back whole, the question stands, and nothing went up. */
async function pcIsBack({ cloud, b, version, remote }: Setup, label: string, bad: string[]) {
  const next = tavora(cloud, b);
  await next.beforeLoad();
  for (const name of NAMES) if ((await read(b, name)) !== B[name]) bad.push(`${label}: ${name} is ${await read(b, name)}`);
  if (next.view().conflictKind === "unfinished") bad.push(`${label}: still unfinished`);
  if (!next.view().conflict) bad.push(`${label}: doesn't ask`);
  await next.sync().catch(() => undefined);
  if ((await remote()) !== version) bad.push(`${label}: uploaded`);
}

const plan: SwapPlan = { keepIn: path.join(path.sep, "data", "backups", "cloud-copy-1-this-pc"), moduleFiles: path.join(path.sep, "pictures"), own: null, empty: [] };
const EVENTS: SwapEvent[] = [
  { type: "chosen" },
  { type: "begin", plan },
  { type: "finished" },
  { type: "go-back" },
  { type: "try-again" },
  { type: "went-back", copyOn: true },
  { type: "went-back", copyOn: false },
  { type: "lost", files: ["library.json"] },
  { type: "copy-gone" },
  { type: "answered" },
  { type: "forgotten" },
];

describe("every status the swap can reach", () => {
  const reachable = () => {
    const seen = new Map<string, SwapStatus>([[JSON.stringify(SWAP_IDLE), SWAP_IDLE]]);
    for (const status of seen.values()) {
      for (const event of EVENTS) {
        const next = stepSwap(status, event);
        seen.set(JSON.stringify(next), next);
      }
    }
    return [...seen.values()];
  };

  it("reaches each phase, and never held", () => {
    expect(new Set(reachable().map((status) => status.phase))).toEqual(new Set(["idle", "chosen", "swapping", "undoing", "asking"]));
  });

  it("leaves a swap only by finishing it or taking it back", () => {
    for (const status of reachable().filter((item) => item.phase === "swapping" || item.phase === "undoing")) {
      for (const event of EVENTS) {
        const next = stepSwap(status, event);
        if (next.phase === "swapping" || next.phase === "undoing") continue;
        expect(status.phase === "swapping" ? event.type === "finished" : event.type === "went-back").toBe(true);
      }
    }
  });

  it("never starts moving files from a question: the user has to choose the copy first", () => {
    for (const status of reachable().filter((item) => item.phase === "asking")) {
      expect(stepSwap(status, { type: "begin", plan })).toEqual(status);
    }
  });
});

describe("a power cut, and a second one", () => {
  it("works on snapshots that keep every file's date and content", async () => {
    const { b, snapshot } = await chosen();
    const file = path.join(b.userData, "workspace.json");
    const before = (await stat(file)).mtimeMs;
    await restore(b, snapshot);
    expect((await stat(file)).mtimeMs).toBe(before);
    await replaceFile(file, "changed");
    await restore(b, snapshot);
    expect(await readFile(file, "utf8")).toBe(B["workspace.json"]);
  });

  it("while the chosen copy goes in: the next start finishes it", async () => {
    const setup = await chosen();
    const { cloud, b, snapshot } = setup;
    const first = `${b.root}-first`;
    const bad: string[] = [];
    const checked = new Set<string>();
    const steps = await everyCut(b, snapshot, () => tavora(cloud, b).beforeLoad(), async (n) => {
      if (skipFirstCut(n)) return;
      await rm(first, { recursive: true, force: true });
      await snapshotOf(b.root, first);
      await copyIsIn(setup, `cut ${n}`, bad);
      await everyCut(b, first, () => tavora(cloud, b).beforeLoad(), (m) => copyIsIn(setup, `cut ${n}, then ${m}`, bad), checked);
    });
    expect(steps).toBeGreaterThan(5);
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("then going back: this PC's data comes back whole", async () => {
    const setup = await chosen();
    const { cloud, b, snapshot } = setup;
    const first = `${b.root}-back`;
    const bad: string[] = [];
    const checked = new Set<string>();
    let swaps = 0;
    await everyCut(b, snapshot, () => tavora(cloud, b).beforeLoad(), async (n) => {
      if (skipFirstCut(n)) return;
      if ((await phaseOf(b)) !== "swapping") return;
      swaps++;
      const status = JSON.parse(await readFile(statusFile(b), "utf8")) as object;
      await replaceFile(statusFile(b), JSON.stringify({ ...status, phase: "undoing" }));
      await rm(first, { recursive: true, force: true });
      await snapshotOf(b.root, first);
      await pcIsBack(setup, `cut ${n}`, bad);
      await everyCut(b, first, () => tavora(cloud, b).beforeLoad(), (m) => pcIsBack(setup, `cut ${n}, then ${m}`, bad), checked);
    });
    expect(swaps).toBeGreaterThan(0);
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("two starts stopped at different files, then going back", async () => {
    const setup = await chosen();
    const { cloud, b, snapshot } = setup;
    const first = `${b.root}-twice`;
    const bad: string[] = [];
    const checked = new Set<string>();
    await everyCut(b, snapshot, () => tavora(cloud, b).beforeLoad(), async (n) => {
      if (skipFirstCut(n)) return;
      if ((await phaseOf(b)) !== "swapping") return;
      await rm(first, { recursive: true, force: true });
      await snapshotOf(b.root, first);
      await everyCut(b, first, () => tavora(cloud, b).beforeLoad(), async (m) => {
        if ((await phaseOf(b)) !== "swapping") return;
        const status = JSON.parse(await readFile(statusFile(b), "utf8")) as object;
        await replaceFile(statusFile(b), JSON.stringify({ ...status, phase: "undoing" }));
        await pcIsBack(setup, `cut ${n}, then ${m}`, bad);
      }, checked);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it.each(["went-back", "lost"] as const)("while answering a question (%s) with the cloud copy: nothing goes up, and no side is lost", async (why) => {
    const setup = await chosen();
    const { cloud, b, snapshot, version, remote } = setup;
    await restore(b, snapshot);
    if (why === "went-back") {
      await replaceFile(statusFile(b), JSON.stringify({ v: 1, phase: "asking", why, files: [] }));
    } else {
      await replaceFile(path.join(b.userData, "library.json"), "{ broken");
      await readSavedFile(path.join(b.userData, "library.json"), { version: 2 });
      await replaceFile(statusFile(b), JSON.stringify({ v: 1, phase: "asking", why, files: ["library.json"] }));
    }
    const asking = `${b.root}-asking`;
    await rm(asking, { recursive: true, force: true });
    await snapshotOf(b.root, asking);
    const before = why === "lost" ? NAMES.filter((name) => name !== "library.json") : NAMES;
    const bad: string[] = [];
    const answer = async () => {
      const at = tavora(cloud, b);
      await at.beforeLoad();
      await at.keep("cloud");
    };
    await everyCut(b, asking, answer, async (n) => {
      const next = tavora(cloud, b);
      await next.beforeLoad();
      await next.sync().catch(() => undefined);
      if ((await remote()) !== version) bad.push(`cut ${n}: uploaded`);
      const everywhere = [...(await everything(path.join(b.userData, "backups"))), ...(await Promise.all(NAMES.map((name) => read(b, name))))];
      for (const name of before) if (!everywhere.includes(B[name]!)) bad.push(`cut ${n}: lost this PC's ${name}`);
    });
    expect(bad.join("\n")).toBe("");
  }, 300_000);
});

// ── What the user and the app do around it ─────────────────────────────

const DATA_FILES = ["library.json", "workspace.json", "profile.json"];

/**
 * A start the app goes on from, as host.ts runs it: the copy settles what it can (`busy` files held by a virus scan
 * meanwhile), the library is read (one that can't be is set aside), the data files are checked, and the app then saves a
 * fresh file wherever one isn't there.
 */
async function appRuns(cloud: Service, at: Pc, busy: string[] = []): Promise<CopySync> {
  for (const name of busy) power.busy.add(path.join(at.userData, name));
  const sync = tavora(cloud, at);
  try {
    await sync.beforeLoad();
    await readSavedFile(path.join(at.userData, "library.json"), { version: 2 }).catch(() => undefined);
    await sync.checkDataFiles();
  } finally {
    power.busy.clear();
  }
  for (const name of DATA_FILES) {
    const file = path.join(at.userData, name);
    if ((await stat(file).catch(() => null)) === null) await writeFile(file, name === "library.json" ? library() : '{"fresh":true}');
  }
  return sync;
}

/** The copy as it is in the folder, file by file. */
async function remoteFiles({ folder, key }: Setup): Promise<Record<string, string>> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tavora-remote-"));
  try {
    const copy = await new CloudCopy(new FolderStorage(folder)).download(key, copyRoots(path.join(dir, "data"), path.join(dir, "files")), path.join(dir, "staged"));
    const files: Record<string, string> = {};
    for (const name of Object.keys(copy?.files ?? {}).sort()) files[name] = await readFile(path.join(dir, "staged", ...name.split("/")), "utf8");
    return files;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What this PC would upload now, file by file. */
async function localFiles(at: Pc): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const found of (await scanCopy(at.roots)).sort((x, y) => x.path.localeCompare(y.path))) files[found.path] = await readFile(found.file, "utf8");
  return files;
}

const same = (x: Record<string, string>, y: Record<string, string>) => JSON.stringify(x) === JSON.stringify(y);

/** The question about lost data stands, and names the library. */
async function asksAboutLibrary(at: Pc): Promise<boolean> {
  const status = JSON.parse((await readFile(statusFile(at), "utf8").catch(() => null)) ?? "{}") as { phase?: string; why?: string; files?: string[] };
  return status.phase === "asking" && status.why === "lost" && status.files?.includes("library.json") === true;
}

/** After an answer was cut off: what the next start must come to, by what the answer got onto the disk. */
async function settles(setup: Setup, label: string, bad: string[]) {
  const phase = await phaseOf(setup.b);
  if (phase === "swapping") return copyIsIn(setup, label, bad);
  if (phase === "undoing") return pcIsBack(setup, label, bad);
  bad.push(`${label}: the status is ${phase}`);
}

/** Every different way the start can stop with files half moved, each as a snapshot. */
async function eachStop({ cloud, b, snapshot }: Setup, then: (n: number, stop: string) => Promise<void>): Promise<void> {
  const stop = `${b.root}-stop`;
  let stops = 0;
  await everyCut(b, snapshot, () => tavora(cloud, b).beforeLoad(), async (n) => {
    if (skipFirstCut(n) || (await phaseOf(b)) !== "swapping") return;
    stops++;
    await rm(stop, { recursive: true, force: true });
    await snapshotOf(b.root, stop);
    await then(n, stop);
  });
  expect(stops).toBeGreaterThan(0);
}

/** B took A's copy: both are the same, and B is in step with it. */
async function copyTaken() {
  const setup = await chosen();
  await restore(setup.b, setup.snapshot);
  await appRuns(setup.cloud, setup.b);
  const taken = `${setup.b.root}-taken`;
  await snapshotOf(setup.b.root, taken);
  return { ...setup, taken };
}

/**
 * What 0.24.108 and 0.24.122 do with the copy (their cloud-copy-sync.ts), which this Tavora can't change: the copy is on
 * when cloud-copy.json is there, and a state in it without a number for its version is the empty one. A staged copy is
 * only `staged.json`, which this Tavora never writes. In step with the copy, what changed goes up; changed here, it asks.
 */
async function olderStart({ folder, key }: Setup, at: Pc): Promise<"off" | "uploaded" | "asks" | "nothing"> {
  const text = await readFile(path.join(at.userData, "cloud-copy.json"), "utf8").catch(() => null);
  if (text === null) return "off";
  const saved = JSON.parse(text) as Record<string, unknown>;
  const state: CopyState =
    saved.v === 1 && typeof saved.version === "number" && typeof saved.files === "object" && saved.files !== null ? { version: saved.version, pictures: saved.pictures !== false, files: saved.files as CopyState["files"] } : EMPTY_STATE;
  const engine = new CloudCopy(new FolderStorage(folder));
  const remote = await engine.remote();
  if (remote?.version === state.version) return (await engine.upload(key, at.roots, state)).status === "uploaded" ? "uploaded" : "nothing";
  return (await hasLocalChanges(at.roots, state)) ? "asks" : "nothing";
}

/**
 * Keep this PC's in 0.24.108 and 0.24.122 (also right after turning the copy on there): the copy comes down as a backup,
 * and everything here goes up on top of it.
 */
async function olderKeepsThisPc({ folder, key }: Setup, at: Pc): Promise<void> {
  const engine = new CloudCopy(new FolderStorage(folder));
  const staging = path.join(at.userData, "cloud-copy-staging");
  await rm(staging, { recursive: true, force: true });
  const copy = (await engine.download(key, at.roots, path.join(staging, "data")))!;
  await mkdir(path.join(at.userData, "backups"), { recursive: true });
  await rm(path.join(at.userData, "backups", "cloud-copy-older-cloud"), { recursive: true, force: true });
  await rename(path.join(staging, "data"), path.join(at.userData, "backups", "cloud-copy-older-cloud"));
  await rm(staging, { recursive: true, force: true });
  const kept = { ...EMPTY_STATE, version: copy.version, kept: true };
  const file = path.join(at.userData, "cloud-copy.json");
  await writeFile(file, JSON.stringify({ v: 1, ...kept }));
  const result = await engine.upload(key, at.roots, kept);
  if (result.status === "uploaded") await writeFile(file, JSON.stringify({ v: 1, ...result.state }));
}

/**
 * Turning the copy on in 0.24.108 and 0.24.122, before the user answers which side to keep: the staging folder goes, the
 * copy comes down as `staged.json`, and the state is the empty one.
 */
async function olderTurnsOn({ folder, key }: Setup, at: Pc): Promise<void> {
  const staging = path.join(at.userData, "cloud-copy-staging");
  await rm(staging, { recursive: true, force: true });
  const copy = (await new CloudCopy(new FolderStorage(folder)).download(key, at.roots, path.join(staging, "data")))!;
  await writeFile(path.join(staging, "staged.json"), JSON.stringify({ v: 1, ...copy, take: false }));
  await writeFile(path.join(at.userData, "cloud-copy.json"), JSON.stringify({ v: 1, ...EMPTY_STATE }));
  await writeFile(path.join(at.userData, "cloud-copy-place.json"), JSON.stringify({ v: 1, folder }));
}

describe("a power cut around what the user and the app do", () => {
  it("Keep this PC's on a stopped swap: this PC's data comes back whole", async () => {
    const setup = await chosen();
    const { cloud, b } = setup;
    const bad: string[] = [];
    const checked = new Set<string>();
    await eachStop(setup, async (n, stop) => {
      await everyCut(b, stop, async () => (await appRuns(cloud, b, [STATUS])).keep("pc"), (m) => settles(setup, `stop ${n}, cut ${m}`, bad), checked);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("Keep this PC's on the question after going back: what goes up is this PC's side whole", async () => {
    const setup = await chosen();
    const { cloud, b, snapshot, version, remote } = setup;
    await restore(b, snapshot);
    await replaceFile(statusFile(b), JSON.stringify({ v: 1, phase: "asking", why: "went-back", files: [] }));
    const asking = `${b.root}-asking-pc`;
    await snapshotOf(b.root, asking);
    const mine = await localFiles(b);
    const bad: string[] = [];
    await everyCut(b, asking, async () => (await appRuns(cloud, b)).keep("pc"), async (n) => {
      const next = await appRuns(cloud, b);
      if (next.view().conflict) await next.keep("pc").catch(() => undefined);
      else await next.sync().catch(() => undefined);
      if ((await remote()) === version) bad.push(`cut ${n}: nothing went up`);
      else if (!same(await remoteFiles(setup), mine)) bad.push(`cut ${n}: what went up isn't this PC's side`);
      for (const name of NAMES) if ((await read(b, name)) !== B[name]) bad.push(`cut ${n}: ${name} is ${await read(b, name)}`);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("turning the copy off on a stopped swap: this PC's data comes back, and nothing goes up", async () => {
    const setup = await chosen();
    const { cloud, b, version, remote } = setup;
    const bad: string[] = [];
    const checked = new Set<string>();
    await eachStop(setup, async (n, stop) => {
      await everyCut(
        b,
        stop,
        async () => (await appRuns(cloud, b, [STATUS])).turnOff(),
        async (m) => {
          const label = `stop ${n}, cut ${m}`;
          if ((await phaseOf(b)) !== "undoing") return copyIsIn(setup, label, bad);
          // Cut off before the copy was forgotten: the swap is taken back, and the question stands.
          const stateLeft = await Promise.all(["cloud-copy.json", "cloud-copy-swapping.json"].map((name) => stat(path.join(b.userData, name)).then(() => true, () => false)));
          if (stateLeft.includes(true)) return pcIsBack(setup, label, bad);
          const next = tavora(cloud, b);
          await next.beforeLoad();
          for (const name of NAMES) if ((await read(b, name)) !== B[name]) bad.push(`${label}: ${name} is ${await read(b, name)}`);
          if (next.view().on || next.view().conflictKind === "unfinished" || next.dataHeld) bad.push(`${label}: not settled as off`);
          if ((await remote()) !== version) bad.push(`${label}: uploaded`);
        },
        checked,
      );
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("uploads: what goes up is always this PC's files as they are", async () => {
    const setup = await copyTaken();
    const { cloud, b, taken } = setup;
    await restore(b, taken);
    await replaceFile(path.join(b.userData, "workspace.json"), '{"from":"pc, later"}');
    await replaceFile(path.join(b.moduleFiles, "official", "pic.txt"), "pic, later");
    const changed = `${b.root}-changed`;
    await snapshotOf(b.root, changed);
    const mine = await localFiles(b);
    const bad: string[] = [];
    await everyCut(b, changed, async () => (await appRuns(cloud, b)).sync(true), async (n) => {
      await (await appRuns(cloud, b)).sync(true).catch(() => undefined);
      if (!same(await remoteFiles(setup), mine)) bad.push(`cut ${n}: the copy isn't this PC's files`);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it.each(["cloud-copy-place.json", "account-key.json", "cloud-copy.json"])("a library lost at a start with %s busy never goes up as a fresh one", async (busy) => {
    const setup = await copyTaken();
    const { cloud, b, taken, version, remote } = setup;
    await restore(b, taken);
    await replaceFile(path.join(b.userData, "library.json"), "{ broken");
    await appRuns(cloud, b, [busy]);
    const after = `${b.root}-lost`;
    await snapshotOf(b.root, after);
    const bad: string[] = [];
    await everyCut(b, after, async () => (await appRuns(cloud, b)).sync(), async (n) => {
      const next = await appRuns(cloud, b);
      await next.sync().catch(() => undefined);
      if ((await remote()) !== version) bad.push(`cut ${n}: uploaded`);
      if (!(await asksAboutLibrary(b))) bad.push(`cut ${n}: doesn't ask about the lost library`);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("a second held start keeps the first one's lost-files note", async () => {
    const setup = await copyTaken();
    const { cloud, b, taken, version, remote } = setup;
    await restore(b, taken);
    await replaceFile(path.join(b.userData, "library.json"), "{ broken");
    await appRuns(cloud, b, ["cloud-copy.json"]);
    // Something else goes at the second one: the profile the first one saved.
    await rm(path.join(b.userData, "profile.json"));
    await appRuns(cloud, b, ["cloud-copy.json"]);
    const after = `${b.root}-twice-lost`;
    await snapshotOf(b.root, after);
    const bad: string[] = [];
    await everyCut(b, after, async () => (await appRuns(cloud, b)).sync(), async (n) => {
      const next = await appRuns(cloud, b);
      await next.sync().catch(() => undefined);
      if ((await remote()) !== version) bad.push(`cut ${n}: uploaded`);
      if (!(await asksAboutLibrary(b))) bad.push(`cut ${n}: doesn't ask about the lost library`);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("the app writing between two stopped starts, then going back: this PC's data comes back whole", async () => {
    const setup = await chosen();
    const { cloud, b } = setup;
    const held = `${b.root}-held`;
    const back = `${b.root}-held-back`;
    const bad: string[] = [];
    const stops = new Set<string>();
    const checked = new Set<string>();
    await eachStop(setup, async (n, stop) => {
      // A start held by a busy status: the app runs on the half-moved files and saves what it misses.
      await restore(b, stop);
      await appRuns(cloud, b, [STATUS]);
      await rm(held, { recursive: true, force: true });
      await snapshotOf(b.root, held);
      await everyCut(
        b,
        held,
        () => tavora(cloud, b).beforeLoad(),
        async (m) => {
          if (skipDeeperCut(m) || (await phaseOf(b)) !== "swapping") return;
          const status = JSON.parse(await readFile(statusFile(b), "utf8")) as object;
          await replaceFile(statusFile(b), JSON.stringify({ ...status, phase: "undoing" }));
          await rm(back, { recursive: true, force: true });
          await snapshotOf(b.root, back);
          await pcIsBack(setup, `stop ${n}, app, stop ${m}`, bad);
          await everyCut(b, back, () => tavora(cloud, b).beforeLoad(), (k) => pcIsBack(setup, `stop ${n}, app, stop ${m}, back cut ${k}`, bad), checked);
        },
        stops,
      );
    });
    expect(bad.join("\n")).toBe("");
  }, 1_800_000);

  it("an older Tavora only turning the copy on during a swap: this PC's data comes back, and Keep this PC's uploads it whole", async () => {
    const setup = await chosen();
    const { cloud, b, folder, remote } = setup;
    const bad: string[] = [];
    const checked = new Set<string>();
    const copyBefore = `${folder}-before`;
    await snapshotOf(folder, copyBefore);
    await eachStop(setup, async (n, stop) => {
      await restore(b, stop);
      await olderTurnsOn(setup, b);
      const older = `${b.root}-turned-on`;
      await rm(older, { recursive: true, force: true });
      await snapshotOf(b.root, older);
      await everyCut(b, older, () => tavora(cloud, b).beforeLoad(), (m) => pcIsBack(setup, `stop ${n}, cut ${m}`, bad), checked);
      await restore(b, older);
      await pcIsBack(setup, `stop ${n}`, bad);
      const at = tavora(cloud, b);
      await at.beforeLoad();
      await at.keep("pc").catch((error: unknown) => bad.push(`stop ${n}: Keep this PC's failed: ${String(error)}`));
      if ((await remote()) === setup.version) bad.push(`stop ${n}: nothing went up`);
      else if (!same(await remoteFiles(setup), await localFiles(b))) bad.push(`stop ${n}: what went up isn't this PC's side`);
      for (const name of NAMES) if ((await read(b, name)) !== B[name]) bad.push(`stop ${n}: ${name} is ${await read(b, name)}`);
      // The next stop starts from the chosen copy again.
      await rm(folder, { recursive: true, force: true });
      await snapshotOf(copyBefore, folder);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("an older Tavora started while a lost library is asked about finds the copy off", async () => {
    const setup = await copyTaken();
    const { cloud, b, taken, version, remote } = setup;
    await restore(b, taken);
    await replaceFile(path.join(b.userData, "library.json"), "{ broken");
    const broken = `${b.root}-broken`;
    await snapshotOf(b.root, broken);
    const bad: string[] = [];
    // Whatever the start that found it lost got onto the disk, the next one asks: then the older Tavora sees nothing on.
    const check = async (label: string) => {
      await appRuns(cloud, b);
      if (!(await asksAboutLibrary(b))) bad.push(`${label}: doesn't ask about the lost library`);
      if ((await olderStart(setup, b)) !== "off") bad.push(`${label}: an older Tavora finds the copy on`);
      if ((await remote()) !== version) bad.push(`${label}: uploaded`);
    };
    await everyCut(b, broken, () => appRuns(cloud, b), (n) => check(`cut ${n}`));
    await restore(b, broken);
    await check("uncut");
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("going back after an older Tavora's turn-on keeps what this PC saw of a sealed copy, whatever the cut", async () => {
    const setup = await chosen();
    const { cloud, b } = setup;
    const bad: string[] = [];
    let done = false;
    await eachStop(setup, async (n, stop) => {
      if (done) return;
      done = true;
      await restore(b, stop);
      const parked = path.join(b.userData, "cloud-copy-swapping.json");
      await replaceFile(parked, JSON.stringify({ ...(JSON.parse(await readFile(parked, "utf8")) as object), sealed: true }));
      await olderTurnsOn(setup, b);
      const older = `${b.root}-sealed`;
      await rm(older, { recursive: true, force: true });
      await snapshotOf(b.root, older);
      await everyCut(b, older, () => tavora(cloud, b).beforeLoad(), async (m) => {
        await tavora(cloud, b).beforeLoad();
        const state = JSON.parse((await readFile(path.join(b.userData, "cloud-copy.json"), "utf8").catch(() => null)) ?? "{}") as { sealed?: boolean };
        if (state.sealed !== true) bad.push(`stop ${n}, cut ${m}: sealed is gone`);
      });
    });
    expect(done).toBe(true);
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it.each(["in step", "lost"] as const)("choosing the cloud copy (%s) never leaves it chosen with the state where an older Tavora uploads", async (how) => {
    const setup = await copyTaken();
    const { cloud, b, taken, version, remote } = setup;
    await restore(b, taken);
    if (how === "lost") {
      await replaceFile(path.join(b.userData, "library.json"), "{ broken");
      await appRuns(cloud, b);
    }
    const before = `${b.root}-choosing`;
    await rm(before, { recursive: true, force: true });
    await snapshotOf(b.root, before);
    const bad: string[] = [];
    const answer = async () => {
      const at = await appRuns(cloud, b);
      await (how === "lost" ? at.keep("cloud") : at.restore());
    };
    await everyCut(b, before, answer, async (n) => {
      if ((await phaseOf(b)) !== "chosen") return;
      if ((await olderStart(setup, b)) !== "off") bad.push(`cut ${n}: chosen, and an older Tavora finds the copy on`);
      if ((await remote()) !== version) bad.push(`cut ${n}: uploaded`);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);

  it("an older Tavora starting during a swap uploads nothing, and this one settles after it", async () => {
    const setup = await chosen();
    const { cloud, b, remote } = setup;
    const bad: string[] = [];
    await eachStop(setup, async (n, stop) => {
      await restore(b, stop);
      // The copy is in the folder, which no snapshot holds: what an earlier stop put up there stays.
      const version = await remote();
      if ((await olderStart(setup, b)) === "asks") await olderKeepsThisPc(setup, b);
      if ((await remote()) !== version) bad.push(`stop ${n}: the older Tavora uploaded the half-moved files`);
      // Shown the copy as off, the user turns it on again there and keeps this PC's side, then works on. That upload
      // can't be helped; what this Tavora does after it can.
      await restore(b, stop);
      await olderKeepsThisPc(setup, b);
      await replaceFile(path.join(b.userData, "workspace.json"), '{"from":"the older Tavora"}');
      const left = await localFiles(b);
      const older = `${b.root}-older`;
      await rm(older, { recursive: true, force: true });
      await snapshotOf(b.root, older);
      // Back on this Tavora, whatever it asks: Keep this PC's.
      for (let start = 0; start < 3; start++) {
        const at = tavora(cloud, b);
        await at.beforeLoad();
        if (at.view().conflict) await at.keep("pc").catch(() => undefined);
      }
      const now = tavora(cloud, b);
      await now.beforeLoad();
      if (!same(await localFiles(b), left)) bad.push(`stop ${n}: what was done in the older Tavora was replaced`);
      if (now.dataHeld || now.view().conflictKind === "unfinished") bad.push(`stop ${n}: still held after the older Tavora`);
      // Or Use the cloud copy: it is in after one restart.
      await restore(b, older);
      restarts = 0;
      for (let start = 0; start < 3; start++) {
        const at = tavora(cloud, b);
        await at.beforeLoad();
        if (at.view().conflict || at.view().conflictKind === "unfinished") await at.keep("cloud").catch(() => undefined);
        else if (start === 0) await at.restore().catch(() => undefined);
      }
      const last = tavora(cloud, b);
      await last.beforeLoad();
      if (restarts > 1) bad.push(`stop ${n}: Use the cloud copy restarted ${restarts} times`);
      if (last.dataHeld || last.view().conflictKind === "unfinished" || !same(await localFiles(b), await remoteFiles(setup))) bad.push(`stop ${n}: the cloud copy isn't in`);
    });
    expect(bad.join("\n")).toBe("");
  }, 600_000);
});
