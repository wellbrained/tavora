// What the cloud copy writes of its own files, pinned byte for byte and in order, as Tavora 0.24.155 (before they moved
// to saved-file.ts) wrote them: the state (cloud-copy.json, and cloud-copy-swapping.json during a swap), where it is
// kept (cloud-copy-place.json), the swap's status (cloud-copy-status.json), the staged copy's list (copy-list.json, and
// an older Tavora's staged.json), a swap's incoming lists (incoming-lists.json, in its backup) and the parts this PC saw
// unused (cloud-copy-unused.json). Each from no file, from what that Tavora writes, from a newer Tavora's file, from a
// damaged one and from one that can't be read right now; and the flows that write them, every file put in place, moved
// or removed, in order. cloud-copy-pins/ holds what that Tavora's own code wrote: a later Tavora must write the same, so
// the previous version opens what it writes, in the order the cloud copy relies on (docs/state-machines.md).
// `UPDATE_SAVED_PINS=1` writes the pins again: only for a file whose saved format changes on purpose (its version goes
// up), never to make a test pass.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudCopy, copyRoots, EMPTY_STATE, lookCopyState, saveCopyState, type CopyState } from "./cloud-copy";
import { lookSwapStatus, writeSwapStatus, type SwapStatus } from "./cloud-copy-swap";
import { CopySync, loadPlace } from "./cloud-copy-sync";
import { cleanUp, pc, service } from "./cloud-copy.test-helper";
import { newCopyKey } from "./copy-crypto";
import { FolderStorage } from "./copy-folder";
import { onUnreadableFileKept, unreadableFilesKept } from "./json";

/** The cloud copy's own files, and the copies set aside next to them. */
const OWN = /(?:^|[\\/])(?:cloud-copy|cloud-copy-swapping|cloud-copy-place|cloud-copy-status|cloud-copy-unused|copy-list|staged|incoming-lists|swap-plan|cloud-copy-lost)\.json(?:\.[^\\/]*)?$/;

const record = vi.hoisted(() => ({ on: false, ops: [] as string[], shown: (file: string) => file, text: (text: string) => text }));

vi.mock("node:fs/promises", async (original) => {
  const real = await original<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: (async (from: string, to: string) => {
      if (record.on && OWN.test(String(to))) {
        const temp = /\.[0-9a-f]{12}\.tmp$/.test(String(from));
        record.ops.push(temp ? `put ${record.shown(String(to))} ${record.text(await real.readFile(from, "utf8"))}` : `move ${record.shown(String(from))} -> ${record.shown(String(to))}`);
      }
      return real.rename(from, to);
    }) as typeof real.rename,
    rm: (async (file: string, options: never) => {
      if (record.on && OWN.test(String(file))) {
        const there = await real.stat(file).then(
          () => "was there",
          () => "not there",
        );
        record.ops.push(`remove ${record.shown(String(file))} (${there})`);
      }
      return real.rm(file, options);
    }) as typeof real.rm,
  };
});

const PINS = path.join(__dirname, "cloud-copy-pins");
const UPDATE = process.env.UPDATE_SAVED_PINS === "1";
const NOW = Date.parse("2026-11-23T10:00:00.000Z");
const encryptor = { ready: async () => true, isAvailable: () => true, encrypt: async (text: string) => Buffer.from(`sealed:${text}`), decrypt: async (data: Buffer) => data.toString().replace(/^sealed:/, "") };

/** The folders a run made, each shown by its name. */
let places: [string, string][] = [];
const named = (dir: string, name: string) => {
  places.push([dir, name]);
  return dir;
};

/**
 * A path, or a file's text, with the folders of the run shown by their names and `/` between names. A text's paths are
 * JSON (`\\` between names on Windows).
 */
function hidePaths(text: string): string {
  let shown = text;
  // Each folder as JSON writes it, as the system writes it, and with `/` (the samples' form on Windows).
  for (const [dir, name] of [...places].sort((a, b) => b[0].length - a[0].length)) for (const form of [JSON.stringify(dir).slice(1, -1), dir, dir.split(path.sep).join("/")]) shown = shown.split(form).join(name);
  return shown.replace(/\\\\|\\(?!")/g, "/");
}

/**
 * What is made fresh each run, shown the same way every time: times (numbers past 10^9) as `<time>`, a folder's versions
 * (random below) as `<version>`, ids and hashes (hex) by the order they first appear in, and the time in a backup's name.
 */
function normalize(text: string, ids = new Map<string, string>()): string {
  const id = (hex: string) => {
    if (!ids.has(hex)) ids.set(hex, `<id ${ids.size + 1}>`);
    return ids.get(hex)!;
  };
  return hidePaths(text)
    .replace(/cloud-copy-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/g, "cloud-copy-<time>-")
    .replace(/\b[0-9a-f]{16,}\b/g, id)
    .replace(/"(version|keptFrom)":\d{5,}/g, '"$1":<version>')
    .replace(/(?<![\w.])\d{10,}(?:\.\d+)?(?![\w.])/g, "<time>");
}

/** A value read, with what normalize hides hidden in its strings and numbers. */
function plain(value: unknown): unknown {
  const ids = new Map<string, string>();
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return normalize(item, ids);
    if (typeof item === "number") return item >= 1e9 ? "<time>" : item;
    if (Array.isArray(item)) return item.map(walk);
    if (item instanceof Error) return [item.constructor.name, (item as NodeJS.ErrnoException).code ?? (item as { code?: string }).code].filter(Boolean).join(" ");
    if (typeof item === "object" && item !== null) return Object.fromEntries(Object.entries(item).map(([key, inner]) => [normalize(key, ids), walk(inner)]));
    return item ?? null;
  };
  return walk(value);
}

beforeEach(() => {
  places = [];
  record.ops = [];
  record.shown = normalize;
  record.text = (text) => text;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  record.on = false;
  onUnreadableFileKept(null);
  vi.restoreAllMocks();
});
afterAll(cleanUp);

async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Every file in a folder and what it holds, the run's folders and the times in names hidden. */
async function snapshot(dir: string, only: RegExp = /./): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (only.test(full)) files[path.relative(dir, full).split(path.sep).join("/").replace(/\.corrupt-\d+/, ".corrupt-<time>")] = normalize(await readFile(full, "utf8"));
    }
  };
  await walk(dir);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

const failure = (error: unknown) => `threw ${(error as NodeJS.ErrnoException).code ?? (error as Error).name}`;

/** One of the cloud copy's files, read and written the way the cloud copy does it, from a fresh data folder each time. */
interface Pinned {
  name: string;
  file: string;
  /** What that Tavora writes, `%DATA%` for the data folder. */
  sample: string;
  /** Reads it, and writes one change, in `dir`. */
  read(dir: string): Promise<unknown>;
  change(dir: string, read: unknown): Promise<unknown>;
  /** The files that count: the cloud copy's own, or every one. */
  only?: RegExp;
}

const STATE: CopyState = { version: 7, pictures: true, files: { "library.json": { size: 2048, mtimeMs: 1763100000000, sha256: "a".repeat(64), parts: ["b".repeat(64)] } }, sealed: true, marked: true, listed: true, keptFrom: 6, keyId: "c".repeat(32) };
const plan = (dir: string) => ({ keepIn: path.join(dir, "backups", "cloud-copy-2026-11-23T10-00-00-000Z-this-pc"), moduleFiles: path.join(dir, "Pictures"), own: { moduleFilesFolder: "D:\\Pictures" }, empty: [path.join(dir, "modules")], place: null, account: "me", earlierIn: ["data/modules"] });

const STORES: Pinned[] = [
  {
    name: "state",
    file: "cloud-copy.json",
    sample: JSON.stringify({ v: 1, version: 7, pictures: true, files: STATE.files, kept: true, sealed: true, marked: true, listed: true, keptFrom: 6, keyId: "c".repeat(32) }),
    read: (dir) => lookCopyState(path.join(dir, "cloud-copy.json")),
    change: async (dir, looked) => {
      const state = (looked as { status: string; value?: CopyState }).value ?? EMPTY_STATE;
      await saveCopyState(path.join(dir, "cloud-copy.json"), { ...state, version: state.version + 1 });
    },
  },
  {
    name: "parked-state",
    file: "cloud-copy-swapping.json",
    sample: JSON.stringify({ v: 1, version: 7, pictures: false, files: {} }),
    read: (dir) => lookCopyState(path.join(dir, "cloud-copy-swapping.json")),
    change: (dir) => saveCopyState(path.join(dir, "cloud-copy-swapping.json"), STATE),
  },
  {
    name: "status",
    file: "cloud-copy-status.json",
    sample: "",
    read: (dir) => lookSwapStatus(path.join(dir, "cloud-copy-status.json"), path.join(dir, "backups")),
    change: async (dir, looked) => {
      const file = path.join(dir, "cloud-copy-status.json");
      const steps: SwapStatus[] = [{ phase: "chosen" }, { phase: "swapping", plan: plan(dir) }, { phase: "undoing", plan: { ...plan(dir), place: path.join(dir, "OneDrive"), own: null } }, { phase: "asking", why: "lost", files: ["library.json", "workspace.json"] }, { phase: "asking", why: "went-back", files: [] }];
      const seen: string[] = [];
      for (const step of steps) {
        await writeSwapStatus(file, step);
        seen.push(normalize(await readFile(file, "utf8")));
      }
      await writeSwapStatus(file, { phase: "idle" });
      return { looked, seen };
    },
  },
  {
    name: "place",
    file: "cloud-copy-place.json",
    sample: JSON.stringify({ v: 1, folder: "%DATA%/OneDrive" }),
    read: (dir) => loadPlace(path.join(dir, "cloud-copy-place.json")),
    change: async () => undefined,
  },
  {
    name: "unused",
    file: "cloud-copy-unused.json",
    sample: JSON.stringify({ v: 1, folder: "%DATA%/OneDrive", last: NOW - 60_000, waited: { ["ab".repeat(16)]: 1000 } }),
    only: /cloud-copy-unused/,
    read: async () => undefined,
    change: async (dir) => {
      const folder = path.join(dir, "OneDrive");
      await mkdir(folder, { recursive: true });
      const roots = copyRoots(path.join(dir, "data"), path.join(dir, "Pictures"));
      const storage = () => new FolderStorage(folder, { now: () => NOW, unusedFile: path.join(dir, "cloud-copy-unused.json") });
      const key = newCopyKey();
      let state = EMPTY_STATE;
      const saved: string[] = [];
      // Two saves: the second leaves a part of the first unused.
      for (const text of ["first", "second"]) {
        await put(path.join(dir, "data", "library.json"), text);
        const up = await new CloudCopy(storage()).upload(key, roots, state);
        saved.push(up.status);
        if (up.status === "uploaded") state = up.state;
      }
      return saved;
    },
  },
];

/** A file a newer Tavora wrote: the sample with a higher version and a field this Tavora doesn't know. */
const newer = (text: string) => JSON.stringify({ ...(JSON.parse(text) as object), v: 2, somethingNew: { kept: true } });

async function scenarios(store: Pinned): Promise<Record<string, unknown>> {
  const run = async (setUp: (dir: string, file: string) => Promise<void>) => {
    const dir = named(await mkdtemp(path.join(os.tmpdir(), "tavora-copy-pins-")), "%DATA%");
    const file = path.join(dir, store.file);
    await setUp(dir, file);
    const before = unreadableFilesKept();
    let read: unknown;
    let changed: unknown;
    try {
      read = plain(await store.read(dir));
      changed = plain(await store.change(dir, await store.read(dir)));
    } catch (error) {
      changed = failure(error);
    }
    const result = { read, changed, files: await snapshot(dir, store.only ?? OWN), told: unreadableFilesKept() - before };
    await rm(dir, { recursive: true, force: true });
    return result;
  };
  const sample = (dir: string) => store.sample.split("%DATA%").join(dir.split(path.sep).join("/"));
  const status = (dir: string) => JSON.stringify({ v: 1, phase: "swapping", plan: plan(dir) });
  const text = (dir: string) => (store.name === "status" ? status(dir) : sample(dir));
  const result: Record<string, unknown> = {};
  result.empty = await run(async () => undefined);
  result.sample = await run((dir, file) => put(file, text(dir)));
  result.newer = await run((dir, file) => put(file, newer(text(dir))));
  result.damaged = await run((_, file) => put(file, "{ damaged"));
  result.shapeless = await run((_, file) => put(file, JSON.stringify({ v: 1 })));
  // A folder in its place can't be read as a file: what it reads, and what a write does once it is gone.
  {
    const dir = named(await mkdtemp(path.join(os.tmpdir(), "tavora-copy-pins-")), "%DATA%");
    const file = path.join(dir, store.file);
    await mkdir(file);
    const read = plain(await store.read(dir).catch(failure));
    await rm(file, { recursive: true });
    const changed = plain(await store.change(dir, read).catch(failure));
    result.held = { read, changed, files: await snapshot(dir, store.only ?? OWN) };
    await rm(dir, { recursive: true, force: true });
  }
  return result;
}

type Service = Awaited<ReturnType<typeof service>>;
type Pc = Awaited<ReturnType<typeof pc>>;

const tavora = (cloud: Service, at: Pc, signedIn = true) => {
  const sync = new CopySync({ userData: at.userData, enabled: true, files: { root: () => at.moduleFiles }, account: { token: () => (signedIn ? cloud.token : null), id: () => (signedIn ? "me" : null) }, serviceUrl: "http://tavora.test/v1/account", fetch: cloud.fetch, encryptor, restart: () => undefined });
  sync.attach({ flush: async () => undefined, onChange: () => undefined });
  return sync;
};

const library = (...ids: string[]) => JSON.stringify({ version: 2, workspaces: Object.fromEntries(ids.map((id) => [id, {}])) });
const A = { "library.json": library("elden-ring"), "workspace.json": '{"from":"copy"}', "modules/dice/m.json": "dice copy", "module-blobs/official/pic.txt": "pic copy" };
const B = { "library.json": library("hollow-knight"), "workspace.json": '{"from":"pc"}', "modules/dice/m.json": "dice pc", "module-blobs/official/pic.txt": "pic pc", "module-blobs/local/own.txt": "own pc" };

/** Two PCs on one account, A's copy on the service: B has the recovery key typed in and chose the copy. */
async function chosen(): Promise<{ cloud: Service; a: Pc; b: Pc }> {
  const cloud = await service();
  const a = await pc(A);
  named(a.root, "%A%");
  const first = tavora(cloud, a);
  await first.beforeLoad();
  await first.turnOn();
  const key = first.view().recoveryKey!;
  const b = await pc(B);
  named(b.root, "%B%");
  record.on = true;
  const at = tavora(cloud, b);
  await at.beforeLoad();
  await at.turnOn();
  await at.enterKey(key);
  await at.keep("cloud");
  return { cloud, a, b };
}

const staging = (at: Pc, name: string) => path.join(at.userData, "cloud-copy-staging", name);

/** What each flow writes of the cloud copy's files, in order. */
const FLOWS: Record<string, () => Promise<void>> = {
  "turned on, and a change goes up": async () => {
    const cloud = await service();
    const a = await pc(A);
    named(a.root, "%A%");
    record.on = true;
    const sync = tavora(cloud, a);
    await sync.beforeLoad();
    await sync.turnOn();
    await writeFile(path.join(a.userData, "workspace.json"), '{"from":"changed"}');
    await sync.sync(true);
  },
  "turned on in a folder signed out, and a change goes up": async () => {
    const cloud = await service();
    const a = await pc(A);
    named(a.root, "%A%");
    const folder = path.join(a.root, "OneDrive");
    await mkdir(folder);
    record.on = true;
    const sync = tavora(cloud, a, false);
    await sync.beforeLoad();
    await sync.turnOn(folder);
    await writeFile(path.join(a.userData, "workspace.json"), '{"from":"changed"}');
    await sync.sync(true);
    // The next start reads where it is.
    const next = tavora(cloud, a, false);
    await next.beforeLoad();
  },
  "the copy chosen, then taken at the next start": async () => {
    const { cloud, b } = await chosen();
    await tavora(cloud, b).beforeLoad();
  },
  "the copy chosen, then this PC's side kept": async () => {
    const { cloud, b } = await chosen();
    await tavora(cloud, b).keep("pc");
  },
  "the copy chosen, its list damaged before the next start": async () => {
    const { cloud, b } = await chosen();
    await writeFile(staging(b, "copy-list.json"), "{ damaged");
    const next = tavora(cloud, b);
    await next.beforeLoad();
    await next.keep("pc").catch(() => undefined);
  },
  "the copy chosen, its list a newer Tavora's before the next start": async () => {
    const { cloud, b } = await chosen();
    await writeFile(staging(b, "copy-list.json"), newer(await readFile(staging(b, "copy-list.json"), "utf8")));
    const next = tavora(cloud, b);
    await next.beforeLoad();
  },
  "the status damaged at the next start, then this PC's side kept": async () => {
    const { cloud, b } = await chosen();
    await writeFile(path.join(b.userData, "cloud-copy-status.json"), "{ damaged");
    const next = tavora(cloud, b);
    await next.beforeLoad();
    await next.keep("pc").catch(() => undefined);
  },
  "the state a newer Tavora's at the next start": async () => {
    const cloud = await service();
    const a = await pc(A);
    named(a.root, "%A%");
    const sync = tavora(cloud, a);
    await sync.beforeLoad();
    await sync.turnOn();
    const file = path.join(a.userData, "cloud-copy.json");
    await writeFile(file, newer(await readFile(file, "utf8")));
    record.on = true;
    const next = tavora(cloud, a);
    await next.beforeLoad();
    await next.sync(true).catch(() => undefined);
  },
  "the state damaged at the next start, then the cloud copy kept": async () => {
    const cloud = await service();
    const a = await pc(A);
    named(a.root, "%A%");
    const sync = tavora(cloud, a);
    await sync.beforeLoad();
    await sync.turnOn();
    await writeFile(path.join(a.userData, "cloud-copy.json"), "{ damaged");
    record.on = true;
    const next = tavora(cloud, a);
    await next.beforeLoad();
    await next.keep("pc").catch(() => undefined);
  },
};

async function flow(name: string): Promise<string[]> {
  record.text = normalize;
  await FLOWS[name]!();
  record.on = false;
  return record.ops;
}

/** A flow's pin, by its name. */
const slug = (name: string) => `flow-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`;

async function pinned(name: string, found: unknown): Promise<void> {
  const pin = path.join(PINS, `${name}.json`);
  if (UPDATE) {
    await mkdir(PINS, { recursive: true });
    await writeFile(pin, `${JSON.stringify(found, null, 2)}\n`);
  }
  expect(found).toEqual(JSON.parse(await readFile(pin, "utf8")));
}

describe("what the cloud copy writes of its own files, as Tavora 0.24.155 wrote it", () => {
  it.each(STORES.map((store) => [store.name, store] as const))("%s", async (name, store) => {
    await pinned(name, await scenarios(store));
  });

  it.each(Object.keys(FLOWS))("%s", async (name) => {
    await pinned(slug(name), await flow(name));
  }, 60_000);

  it("every pin belongs to a file or a flow", async () => {
    const names = (await readdir(PINS)).map((name) => name.replace(/\.json$/, "")).sort();
    expect(names).toEqual([...STORES.map((store) => store.name), ...Object.keys(FLOWS).map(slug)].sort());
  });
});
