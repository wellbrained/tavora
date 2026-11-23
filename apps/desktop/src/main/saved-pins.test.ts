// What each store of the user's files writes, pinned byte for byte as Tavora 0.24.147 (before saved-file.ts) wrote it:
// from no file, from its saved sample, from a newer Tavora's file and from a damaged one, and what it does with a file
// it can't read right now. saved-pins/ holds what that Tavora's own code wrote; a later Tavora must write the same, so
// the files it writes open in the previous version, and it must read that version's files to the same result.
// `UPDATE_SAVED_PINS=1` writes the pins again: only for a store whose saved format changes on purpose (its version
// goes up), never to make a test pass.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAccount, saveAccount } from "./account";
import { loadDiscordSecrets, saveDiscordSecrets, type Encryptor } from "./discord-store";
import { DocumentStore } from "./documents";
import { ChosenFolders } from "./folder-access";
import { GameOverlayStore } from "./game-overlays";
import { GrantStore } from "./grants";
import { HotkeyStore } from "./hotkeys";
import { forgetOwner, readOwnerRecords } from "./installer";
import { onUnreadableFileKept, unreadableFilesKept } from "./json";
import { queueLocalDataMove } from "./module-data";
import { OfficialUpdates, readOfficialRecords } from "./official-updates";
import { OverlayStore } from "./overlays";
import { ConnectionFile } from "./connection";
import { loadLibrary, SavedData } from "./saved-data";
import { ModuleStore, PanelStateStore } from "./storage";
import { TrafficFile } from "./traffic";
import { loadWorkspace, saveWorkspace } from "./workspace";

const SAMPLES = path.join(__dirname, "saved-samples");
const PINS = path.join(__dirname, "saved-pins");
const UPDATE = process.env.UPDATE_SAVED_PINS === "1";
const KEY = "0123456789abcdef0123456789abcdef";
const PANEL = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-23T10:00:00.000Z");

const encryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (text) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
  decrypt: (data) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
};

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-pins-"));
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.useRealTimers();
  onUnreadableFileKept(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const at = (...names: string[]) => path.join(dir, ...names);
const slashed = () => dir.split(path.sep).join("/");
/** The separator of the paths the stores are given: the system's, or Windows' to see the pins hold there too. */
let separator = path.sep;
/** The names in the data folder this run gave a store as a path, each made with `separator`. */
const given = new Set<string>();
const inData = (name: string) => {
  given.add(name);
  return `${dir}${separator}${name}`;
};

/**
 * The data folder's path shown as `%USERDATA%`, written with `/` or with the system's separator, so the pins are the
 * same on every system. A path a store was given shows as `%USERDATA%%SEP%<name>` only when the store wrote it exactly
 * as given, with the separator it came with: one that changed the separator shows it. Nothing else of the text changes.
 */
function hidePaths(text: string): string {
  let shown = text;
  for (const name of [...given].sort((a, b) => b.length - a.length)) shown = shown.split(JSON.stringify(`${dir}${separator}${name}`).slice(1, -1)).join(`%USERDATA%%SEP%${name}`);
  return shown.split(JSON.stringify(slashed()).slice(1, -1)).join("%USERDATA%").split(JSON.stringify(dir).slice(1, -1)).join("%USERDATA%");
}

/** How a store is opened, changed and written, for one of the user's files. */
interface Pinned<H = any> {
  name: string;
  /** Where the file is, in the data folder. */
  file: string[];
  /** The sample it starts from (saved-samples/), `%USERDATA%` turned into the data folder. */
  sample: string;
  /** The field the version is in. */
  versionKey?: "v";
  /** Opens the store, reading the file when it reads at start. */
  open(): Promise<H>;
  /** What the store read, as it gives it out. */
  read?(store: H): unknown;
  /** One change of the user's, written. */
  change(store: H): Promise<unknown> | unknown;
  /** Waits for what was saved to be written. */
  flush?(store: H): Promise<unknown>;
  /** Hides what is made fresh each time (a random id). */
  normalize?(text: string): string;
}

const GRANT = { owner: KEY, manifest: { id: "community.someone.timer", version: "2.0.0", permissions: { network: ["api.timer.example"] } } };
const official = () => new OfficialUpdates({ userData: dir, pins: { key: "fedcba9876543210fedcba9876543210", account: "account" }, safety: { blocked: () => null, revoked: () => null, firstKeyChain: (key: string) => ({ key, account: null }) } as never });

const STORES: Pinned[] = [
  {
    name: "grants",
    file: ["grants.json"],
    sample: "grants.v1.json",
    open: () => GrantStore.load(dir, () => NOW),
    read: (store: GrantStore) => store.get(KEY, "community.someone.tracker") ?? null,
    change: (store: GrantStore) => store.grant(GRANT),
  },
  {
    name: "hotkeys",
    file: ["hotkeys.json"],
    sample: "hotkeys.v2.json",
    open: () => HotkeyStore.load(dir),
    read: (store: HotkeyStore) => store.all(),
    change: (store: HotkeyStore) => store.set({ owner: "official", moduleId: "tavora.clock-counter", workspaceId: "poe2", action: "increment", target: "kills", label: "Kills", accelerator: "Ctrl+Shift+K" }),
    flush: (store: HotkeyStore) => store.flush(),
  },
  {
    name: "traffic",
    file: ["traffic.json"],
    sample: "traffic.v1.json",
    open: async () => {
      const file = new TrafficFile(at("traffic.json"));
      return { file, months: await file.load() };
    },
    read: ({ months }) => months,
    change: ({ file, months }) => file.save([...months, { month: "2026-11", downBytes: 1, upBytes: 2, countedFrom: 3 }]),
    flush: ({ file }) => file.flush(),
  },
  {
    name: "connection",
    file: ["connection.json"],
    sample: "connection.v1.json",
    open: async () => {
      const file = new ConnectionFile(at("connection.json"));
      return { file, data: await file.load() };
    },
    read: ({ data }) => data,
    change: ({ file, data }) => file.save({ ...data, savedAt: 1763200000000 }),
    flush: ({ file }) => file.flush(),
  },
  {
    name: "connection-at-quit",
    file: ["connection.json"],
    sample: "connection.v1.json",
    open: async () => {
      const file = new ConnectionFile(at("connection.json"));
      return { file, data: await file.load() };
    },
    read: ({ data }) => data,
    change: ({ file, data }) => file.saveNow({ ...data, savedAt: 1763300000000 }),
  },
  {
    name: "overlays",
    file: ["overlays.json"],
    sample: "overlays.v2.json",
    open: () => OverlayStore.load(dir),
    read: (store: OverlayStore) => store.peek({ owner: "official", moduleId: "tavora.clock-counter", workspaceId: "poe2", key: "deaths" }),
    change: (store: OverlayStore) => store.publish({ owner: "official", moduleId: "tavora.clock-counter", workspaceId: "poe2", key: "deaths" }, { count: 13 }),
    flush: (store: OverlayStore) => store.save(),
    // A link made from nothing gets a random token.
    normalize: (text) => text.replace(/"token": ?"(?!0afd3377dcfeb531c32f3d13bc68569a)[0-9a-f]{32}"/g, '"token": "<new>"'),
  },
  {
    name: "official-updates",
    file: ["official-updates.json"],
    sample: "official-updates.v1.json",
    open: async () => {
      const store = official();
      await store.load();
      return store;
    },
    read: () => readOfficialRecords(dir),
    change: (store: OfficialUpdates) => store.save({ id: "tavora.clock-counter", version: "1.1.0", sha256: "a".repeat(64), signer: "fedcba9876543210fedcba9876543210" }),
  },
  {
    name: "module-owners",
    file: ["module-owners.json"],
    sample: "module-owners.v1.json",
    open: async () => undefined,
    read: () => readOwnerRecords(dir),
    change: () => forgetOwner(dir, "local.notes"),
  },
  {
    name: "module-data-pending",
    file: ["module-data-pending.json"],
    sample: "module-data-pending.v1.json",
    open: async () => undefined,
    change: () => queueLocalDataMove(dir, "local.timer", KEY),
  },
  {
    name: "game-overlays",
    file: ["game-overlays.json"],
    sample: "game-overlays.v5.json",
    open: () => GameOverlayStore.load(dir),
    change: (store: GameOverlayStore) => store.markExclusiveHintShown(),
    flush: (store: GameOverlayStore) => store.save(),
  },
  {
    name: "module-settings",
    file: ["module-data", "local", "local.notes", "poe2", "storage.json"],
    sample: "storage.v1.json",
    open: async () => new ModuleStore(at("module-data", "local", "local.notes", "poe2", "storage.json")),
    read: async (store: ModuleStore) => Object.fromEntries(await Promise.all((await store.keys()).map(async (key) => [key, await store.get(key)]))),
    change: (store: ModuleStore) => store.set("zoom", 2),
  },
  {
    name: "panel-state",
    file: ["panel-state", `${PANEL}.json`],
    sample: "panel-state.v1.json",
    open: async () => new PanelStateStore(at("panel-state")),
    read: (store: PanelStateStore) => store.get(PANEL),
    change: (store: PanelStateStore) => store.set(PANEL, { scroll: 1 }),
  },
  {
    name: "panel-state-owned",
    file: ["panel-state", `${PANEL}.json`],
    sample: "panel-state.v1.json",
    open: async () => new PanelStateStore(at("panel-state")),
    read: (store: PanelStateStore) => store.get(PANEL, KEY),
    change: (store: PanelStateStore) => store.set(PANEL, { scroll: 2 }, KEY),
  },
  {
    name: "document",
    file: ["documents", "build-1.json"],
    sample: "document.v1.json",
    open: async () => new DocumentStore(at("documents")),
    read: (store: DocumentStore) => store.get("build-1"),
    change: (store: DocumentStore) => store.put({ id: "build-1", title: "Lightning Arrow", data: { class: "Ranger", level: 93 } }),
  },
  {
    name: "chosen-folders",
    file: ["folder-access", "local", "local.game", "folders.json"],
    sample: "folders.v1.json",
    open: async () => new ChosenFolders(dir, "local", "local.game"),
    read: (store: ChosenFolders) => store.get("Documents/My Games/Path of Exile 2"),
    change: (store: ChosenFolders) => store.set("Documents/My Games/Elden Ring", inData("Elden Ring")),
  },
  {
    name: "library",
    file: ["library.json"],
    sample: "library.v2.json",
    open: async () => ({ data: new SavedData(dir), library: await loadLibrary(dir) }),
    read: ({ library }) => library,
    change: ({ data, library }) => data.saveLibrary({ ...library, language: "en" }),
    flush: ({ data }) => data.flush(),
    normalize: (text) => text.replace(/"installId": ?"[0-9a-f]{64}"/g, '"installId": "<new>"'),
  },
  {
    name: "profile",
    file: ["profile.json"],
    sample: "profile.v1.json",
    open: async () => {
      const data = new SavedData(dir);
      return { data, ...(await data.loadProfile()) };
    },
    read: ({ profile, saved }) => ({ profile, saved }),
    change: ({ data, profile }) => data.saveProfile({ ...profile, name: "Nina" }),
    normalize: (text) => text.replace(/"id": ?"(?!5f0c6a52)[0-9a-f-]{36}"/g, '"id": "<new>"'),
  },
  {
    name: "workspace",
    file: ["workspace.json"],
    sample: "workspace.v3.json",
    open: async () => ({ state: await loadWorkspace(at("workspace.json"), ["poe2", "local-notes"], () => true) }),
    read: ({ state }) => state,
    change: ({ state }) => saveWorkspace(at("workspace.json"), state),
  },
  {
    name: "account",
    file: ["account.json"],
    sample: "",
    versionKey: "v",
    open: async () => ({ account: await loadAccount(at("account.json"), encryptor) }),
    read: ({ account }) => account,
    change: () => saveAccount(at("account.json"), encryptor, { token: "t".repeat(24), email: "nik@example.com", discord: null, createdAt: "2026-11-01T00:00:00.000Z" }),
  },
  {
    name: "discord",
    file: ["discord.json"],
    sample: "",
    versionKey: "v",
    open: async () => ({ secrets: await loadDiscordSecrets(at("discord.json"), encryptor) }),
    read: ({ secrets }) => secrets,
    change: () => saveDiscordSecrets(at("discord.json"), encryptor, { token: { accessToken: "a", refreshToken: "r", expiresAt: 1 } as never, last: null, games: {} }),
  },
];

/** A sealed file as Tavora writes it, its data sealed with the test's encryptor. */
const sealedSample = (data: unknown) => JSON.stringify({ v: 1, data: encryptor.encrypt(JSON.stringify(data)).toString("base64") });
const SEALED: Record<string, string> = {
  account: sealedSample({ token: "s".repeat(24), email: "old@example.com", discord: "nik", createdAt: "2026-10-01T00:00:00.000Z" }),
  discord: sealedSample({ token: { accessToken: "x", refreshToken: "y", expiresAt: 2 }, last: null, games: {} }),
};

async function sampleText(store: Pinned): Promise<string> {
  if (!store.sample) return SEALED[store.name]!;
  return (await readFile(path.join(SAMPLES, store.sample), "utf8")).split("%USERDATA%").join(JSON.stringify(slashed()).slice(1, -1));
}

async function put(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Every file in the data folder and what it holds, the data folder's path and the times in names hidden. */
async function snapshot(store: Pinned): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const hide = (text: string) => {
    const shown = hidePaths(text);
    return store.normalize ? store.normalize(shown) : shown;
  };
  const walk = async (folder: string): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[path.relative(dir, full).split(path.sep).join("/").replace(/\.corrupt-\d+/, ".corrupt-<time>")] = hide(await readFile(full, "utf8"));
    }
  };
  await walk(dir);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

const plain = (store: Pinned, value: unknown) => {
  const text = hidePaths(JSON.stringify(value ?? null));
  return JSON.parse(store.normalize ? store.normalize(text) : text) as unknown;
};
const failure = (error: unknown) => `threw ${(error as NodeJS.ErrnoException).code ?? (error as Error).name}`;

/** Opens, reads, changes and writes, as one start of Tavora would. */
async function run(store: Pinned): Promise<{ read: unknown; files: Record<string, string>; told: number }> {
  const before = unreadableFilesKept();
  let read: unknown;
  try {
    const opened = await store.open();
    read = plain(store, await store.read?.(opened));
    await store.change(opened);
    await store.flush?.(opened);
  } catch (error) {
    read = failure(error);
  }
  return { read, files: await snapshot(store), told: unreadableFilesKept() - before };
}

/** A file a newer Tavora wrote: the sample with a higher version and a field this Tavora doesn't know. */
function newer(store: Pinned, text: string): string {
  const key = store.versionKey ?? "version";
  const value = JSON.parse(text) as Record<string, unknown>;
  return `${JSON.stringify({ ...value, [key]: (value[key] as number) + 1, somethingNew: { kept: true } }, null, 2)}\n`;
}

async function scenarios(store: Pinned): Promise<Record<string, unknown>> {
  const file = at(...store.file);
  const clear = async () => {
    for (const name of await readdir(dir)) await rm(at(name), { recursive: true, force: true });
  };
  const result: Record<string, unknown> = {};
  result.empty = await run(store);
  await clear();
  await put(file, await sampleText(store));
  result.sample = await run(store);
  await clear();
  await put(file, newer(store, await sampleText(store)));
  result.newer = await run(store);
  await clear();
  await put(file, "{ damaged");
  result.damaged = await run(store);
  await clear();
  // A folder in its place can't be read as a file: what the store does when it reads it, and when it writes afterwards.
  await mkdir(file, { recursive: true });
  let held: string;
  try {
    const opened = await store.open();
    await rm(file, { recursive: true });
    try {
      await store.change(opened);
      await store.flush?.(opened);
      held = "changed";
    } catch (error) {
      held = `change ${failure(error)}`;
    }
  } catch (error) {
    held = `open ${failure(error)}`;
    await rm(file, { recursive: true, force: true });
  }
  // Writes that were dropped quietly have had their moment.
  await new Promise((resolve) => setTimeout(resolve, 20));
  result.held = { outcome: held, files: await snapshot(store) };
  return result;
}

describe("what each store writes, as Tavora 0.24.147 wrote it", () => {
  it.each(STORES.map((store) => [store.name, store] as const))("%s", async (name, store) => {
    const found = await scenarios(store);
    const pin = path.join(PINS, `${name}.json`);
    if (UPDATE) {
      await mkdir(PINS, { recursive: true });
      await writeFile(pin, `${JSON.stringify(found, null, 2)}\n`);
    }
    expect(found).toEqual(JSON.parse(await readFile(pin, "utf8")));
  });

  it("the pins hold on Windows too, where the paths the stores are given use backslashes", async () => {
    // On Windows the chosen folder's path, as written, is `C:\\…\\Elden Ring`: the pin hides the separator, not the folder.
    separator = "\\";
    try {
      const store = STORES.find((item) => item.name === "chosen-folders")!;
      const found = await scenarios(store);
      expect(JSON.stringify(found)).toContain("%USERDATA%%SEP%Elden Ring");
      expect(found).toEqual(JSON.parse(await readFile(path.join(PINS, "chosen-folders.json"), "utf8")));
    } finally {
      separator = path.sep;
    }
  });

  it("hides only the data folder, and the separator of a path given only where the store kept it", () => {
    const real = dir;
    dir = "C:\\Users\\Nik\\AppData\\Roaming\\Tavora";
    separator = "\\";
    try {
      const place = inData("Elden Ring");
      const text = JSON.stringify({ kept: place, other: "C:\\Other\\Place", slashed: `${slashed()}/x`, native: `${dir}\\y` });
      expect(JSON.parse(hidePaths(text))).toEqual({ kept: "%USERDATA%%SEP%Elden Ring", other: "C:\\Other\\Place", slashed: "%USERDATA%/x", native: "%USERDATA%\\y" });
      // A store that wrote the path with the other separator doesn't match the pin.
      expect(hidePaths(JSON.stringify(place.split("\\").join("/")))).not.toContain("%SEP%");
    } finally {
      dir = real;
      separator = path.sep;
    }
  });

  it("a newer Tavora's file is kept aside exactly as it was", async () => {
    for (const store of STORES) {
      const file = at(...store.file);
      const text = newer(store, await sampleText(store));
      await put(file, text);
      await run(store);
      const version = (JSON.parse(text) as Record<string, number>)[store.versionKey ?? "version"];
      expect(await readFile(`${file}.from-version-${version}`, "utf8"), store.name).toBe(text);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir);
    }
  });

  it("every pin belongs to a store", async () => {
    const names = (await readdir(PINS)).map((name) => name.replace(/\.json$/, "")).sort();
    expect(names).toEqual(STORES.map((store) => store.name).sort());
    // Each pin was written by a store that read its sample.
    for (const name of names) expect((await stat(path.join(PINS, `${name}.json`))).size).toBeGreaterThan(0);
  });
});
