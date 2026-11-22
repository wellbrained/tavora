// A power cut at every file operation of settling a cloud copy, and a second one at every operation after that, on the
// real code. Whatever happens, nothing uploads a mix of two sides, and neither side's data is lost.
import { link, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { CopySync } from "./cloud-copy-sync";
import { stepSwap, SWAP_IDLE, type SwapEvent, type SwapPlan, type SwapStatus } from "./cloud-copy-swap";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { FolderStorage } from "./copy-folder";
import { readSavedFile } from "./json";

const power = vi.hoisted(() => ({
  at: null as number | null,
  count: 0,
  fired: false,
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

const encryptor = { isAvailable: () => true, encrypt: (text: string) => Buffer.from(`sealed:${text}`), decrypt: (data: Buffer) => data.toString().replace(/^sealed:/, "") };
type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

const tavora = (cloud: Service, at: Pc) => {
  const sync = new CopySync({ userData: at.userData, enabled: true, files: { root: () => at.moduleFiles }, account: { token: () => cloud.token, id: () => "me" }, serviceUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, encryptor, restart: () => undefined });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return sync;
};

const library = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const A = { "library.json": library("elden-ring"), "workspace.json": '{"from":"copy"}', "modules/dice/m.json": "dice copy", "module-data/x/y.json": "data copy" };
const B = { "library.json": library("hollow-knight"), "workspace.json": '{"from":"pc"}', "modules/dice/m.json": "dice pc", "module-data/x/y.json": "data pc" };
const NAMES = Object.keys(A) as (keyof typeof A)[];
const read = (at: Pc, name: string) => readFile(path.join(at.userData, name), "utf8").catch(() => "<gone>");
const statusFile = (at: Pc) => path.join(at.userData, "cloud-copy-status.json");
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
  return { cloud, b, snapshot, version: await remote(), remote };
}

type Setup = Awaited<ReturnType<typeof chosen>>;

/** The copy is in, nothing is held, B's data is safe in a backup, and nothing went up. */
async function copyIsIn({ cloud, b, version, remote }: Setup, label: string, bad: string[]) {
  const next = tavora(cloud, b);
  await next.beforeLoad();
  for (const name of NAMES) if ((await read(b, name)) !== A[name]) bad.push(`${label}: ${name} is ${await read(b, name)}`);
  const kept = await everything(path.join(b.userData, "backups"));
  for (const name of NAMES) if (!kept.includes(B[name])) bad.push(`${label}: lost this PC's ${name}`);
  if (next.dataHeld) bad.push(`${label}: still held`);
  await next.sync().catch(() => undefined);
  if ((await remote()) !== version) bad.push(`${label}: uploaded`);
}

/** B's data is back whole, the question stands, and nothing went up. */
async function pcIsBack({ cloud, b, version, remote }: Setup, label: string, bad: string[]) {
  const next = tavora(cloud, b);
  await next.beforeLoad();
  for (const name of NAMES) if ((await read(b, name)) !== B[name]) bad.push(`${label}: ${name} is ${await read(b, name)}`);
  if (next.view().swapUnfinished) bad.push(`${label}: still unfinished`);
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
    expect(bad).toEqual([]);
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
    expect(bad).toEqual([]);
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
    expect(bad).toEqual([]);
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
      for (const name of before) if (!everywhere.includes(B[name])) bad.push(`cut ${n}: lost this PC's ${name}`);
    });
    expect(bad).toEqual([]);
  }, 300_000);
});
