// The user's files as Tavora wrote them (saved-samples/, see its README): every one must still open, with what it holds.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiUsageConnector } from "./ai-usage";
import { loadCopyState } from "./cloud-copy";
import { lookSwapStatus } from "./cloud-copy-swap";
import { loadPlace, lookStagedList, readIncomingLists } from "./cloud-copy-sync";
import { readUnused } from "./copy-folder";
import { ConnectionFile } from "./connection";
import { DocumentStore } from "./documents";
import { ChosenFolders } from "./folder-access";
import { ALL_GAMES, GameOverlayStore } from "./game-overlays";
import { GrantStore } from "./grants";
import { HotkeyStore } from "./hotkeys";
import { readOwnerRecords } from "./installer";
import { unreadableFilesKept } from "./json";
import { queueLocalDataMove } from "./module-data";
import { readOfficialRecords } from "./official-updates";
import { OverlayStore } from "./overlays";
import { ReadOnlyFiles } from "./read-only-files";
import { loadLibrary, SavedData } from "./saved-data";
import { STORE_VERSIONS, SUPPORTED_VERSIONS } from "./saved-versions";
import { ModuleStore, PanelStateStore } from "./storage";
import { TrafficFile } from "./traffic";
import { loadWorkspace, saveWorkspace } from "./workspace";
import { moveToWorkspaces } from "./workspace-move";

const SAMPLES = path.join(__dirname, "saved-samples");
const KEY = "0123456789abcdef0123456789abcdef";
const PANEL = "11111111-1111-4111-8111-111111111111";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-samples-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** Puts a sample where Tavora keeps that file, its `%USERDATA%` turned into this run's data folder. */
async function place(sample: string, ...where: string[]): Promise<string> {
  const text = (await readFile(path.join(SAMPLES, sample), "utf8")).split("%USERDATA%").join(JSON.stringify(dir.split(path.sep).join("/")).slice(1, -1));
  const file = path.join(dir, ...where);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
  return file;
}
/** A sample as it is in the folder, parsed. */
const sample = async (name: string) => JSON.parse(await readFile(path.join(SAMPLES, name), "utf8")) as Record<string, any>;
const inData = (...names: string[]) => path.join(dir, ...names).split(path.sep).join("/");

/** Opens a sample the way Tavora does at start: old names moved first (workspace-move.ts), then the store reads it. */
async function start(): Promise<void> {
  await moveToWorkspaces(dir);
}

const SAMPLE_TESTS: Record<string, () => Promise<void>> = {
  "library.v2.json": async () => {
    await place("library.v2.json", "library.json");
    const library = await loadLibrary(dir);
    expect(Object.keys(library.workspaces).sort()).toEqual(["elden-ring", "local-my-game", "local-notes", "poe2"]);
    expect(library.workspaces["local-notes"]).toMatchObject({ kind: "personal", name: "Notes" });
    expect(library.workspaces["local-my-game"]!.trashedAt).toBe("2026-11-12T08:00:00.000Z");
    expect(library.folders["44444444-4444-4444-8444-444444444444"]).toMatchObject({ name: "Souls", label: "SL", workspaces: ["elden-ring"] });
    expect(library).toMatchObject({ favorites: ["poe2"], language: "de", gameStart: "ask", gameEndWorkspaceId: "local-notes", lastWorkspaceId: "poe2", radius: 8 });
    // Read and written again, it is the same file: nothing in it is lost.
    expect(JSON.parse(JSON.stringify(library))).toEqual(await sample("library.v2.json"));
  },
  "library.v1.json": async () => {
    await place("library.v1.json", "library.json");
    await start();
    const library = await loadLibrary(dir);
    expect(Object.keys(library.workspaces).sort()).toEqual(["elden-ring", "local-my-mod", "local-personal", "satisfactory"]);
    expect(library.workspaces["local-personal"]).toMatchObject({ kind: "personal", lastOpenedAt: "2026-10-27T08:00:00.000Z" });
    expect(library.workspaces.satisfactory!.trashedAt).toBe("2026-10-25T10:00:00.000Z");
    expect(library.folders["bbbbbbbb-0000-4000-8000-000000000001"]).toMatchObject({ name: "Souls", workspaces: ["elden-ring"] });
    expect(library).toMatchObject({ startup: "last-workspace", gameEndWorkspaceId: "local-personal", lastWorkspaceId: "local-personal" });
    expect(library.dialogFolders["workspace-image"]).toBe(inData("Pictures"));
  },
  "workspace.v3.json": async () => {
    const file = await place("workspace.v3.json", "workspace.json");
    const state = await loadWorkspace(file, ["poe2", "elden-ring", "local-notes"], () => true);
    const poe2 = state.workspaces.poe2!;
    expect(poe2.instances.map((record) => record.moduleId)).toEqual(["tavora.notes", "wellbrained.poe2-builds"]);
    expect(poe2.instances[0]!.content).toEqual({ id: "build-notes", title: "Build notes" });
    expect(poe2.instances[1]!.panelType).toBe("planner");
    expect(poe2.layout).not.toBeNull();
    expect(poe2.snapshots).toMatchObject([{ name: "Mapping", panelTypes: { "22222222-2222-4222-8222-222222222222": "planner" } }]);
    // Read and written again, it is the same file: nothing in it is lost.
    await saveWorkspace(file, state);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(await sample("workspace.v3.json"));
  },
  "workspace.v2.json": async () => {
    const file = await place("workspace.v2.json", "workspace.json");
    await start();
    const state = await loadWorkspace(file, ["elden-ring", "local-personal"], () => true);
    expect(state.workspaces["elden-ring"]!.instances).toEqual([{ instanceId: "aaaaaaaa-0000-4000-8000-000000000001", moduleId: "tavora.notes" }]);
    expect(state.workspaces["elden-ring"]!.layout).not.toBeNull();
    expect(state.workspaces["elden-ring"]!.snapshots.map((snapshot) => snapshot.name)).toEqual(["Boss"]);
    expect(state.workspaces["local-personal"]!.instances.map((record) => record.moduleId)).toEqual(["tavora.whiteboard", "tavora.todos"]);
  },
  "workspace.v1.json": async () => {
    const file = await place("workspace.v1.json", "workspace.json");
    await start();
    const state = await loadWorkspace(file, ["elden-ring"], () => true);
    expect(state.workspaces["elden-ring"]!.instances).toEqual([{ instanceId: "aaaaaaaa-0000-4000-8000-000000000001", moduleId: "tavora.notes" }]);
  },
  "profile.v1.json": async () => {
    await place("profile.v1.json", "profile.json");
    const { profile, saved } = await new SavedData(dir).loadProfile();
    expect(saved).toBe(true);
    expect(profile).toMatchObject({ id: "5f0c6a52-3a1e-4c62-9d5a-7b8f2e1c4d3a", name: "Nik", initials: "NK" });
  },
  "grants.v1.json": async () => {
    await place("grants.v1.json", "grants.json");
    expect((await GrantStore.load(dir)).get(KEY, "community.someone.tracker")).toMatchObject({ version: "1.2.0", network: ["api.example.com"] });
  },
  "hotkeys.v2.json": async () => {
    await place("hotkeys.v2.json", "hotkeys.json");
    expect((await HotkeyStore.load(dir)).all()).toMatchObject([{ workspaceId: "poe2", target: "deaths", accelerator: "Ctrl+Shift+D" }]);
  },
  "hotkeys.v1.json": async () => {
    await place("hotkeys.v1.json", "hotkeys.json");
    await start();
    expect((await HotkeyStore.load(dir)).all().map((record) => record.workspaceId)).toEqual(["elden-ring", "$all"]);
  },
  "overlays.v2.json": async () => {
    await place("overlays.v2.json", "overlays.json");
    expect((await OverlayStore.load(dir)).find("0afd3377dcfeb531c32f3d13bc68569a")).toMatchObject({ link: { workspaceId: "poe2", key: "deaths" }, state: { count: 12 } });
  },
  "overlays.v1.json": async () => {
    await place("overlays.v1.json", "overlays.json");
    await start();
    expect((await OverlayStore.load(dir)).find("a".repeat(32))).toMatchObject({ link: { workspaceId: "elden-ring" }, state: { count: 12 } });
  },
  "game-overlays.v5.json": async () => {
    await place("game-overlays.v5.json", "game-overlays.json");
    const store = await GameOverlayStore.load(dir);
    expect([store.migrated, store.moved]).toEqual([false, false]);
    expect(store.count("poe2")).toBe(2);
  },
  ...Object.fromEntries(
    [4, 3, 2, 1].map((version) => [
      `game-overlays.v${version}.json`,
      async () => {
        await place(`game-overlays.v${version}.json`, "game-overlays.json");
        await start();
        const store = await GameOverlayStore.load(dir, (id) => (id === "local-personal" ? "all" : "game"));
        expect(store.moved).toBe(true);
        // The general items go to All games, a game's own to its setup.
        expect(store.count(ALL_GAMES)).toBeGreaterThan(0);
        expect(store.setupIds().filter((id) => !id.startsWith("$")).length).toBeGreaterThan(0);
      },
    ]),
  ),
  "module-owners.v1.json": async () => {
    await place("module-owners.v1.json", "module-owners.json");
    expect(await readOwnerRecords(dir)).toMatchObject({ "wellbrained.poe2-builds": { owner: KEY, catalog: true }, "local.notes": { owner: "local" } });
  },
  "official-updates.v1.json": async () => {
    await place("official-updates.v1.json", "official-updates.json");
    expect((await readOfficialRecords(dir))["tavora.notes"]).toMatchObject({ version: "1.4.0", highWater: "1.5.0" });
  },
  "connection.v1.json": async () => {
    await place("connection.v1.json", "connection.json");
    expect(await new ConnectionFile(path.join(dir, "connection.json")).load()).toMatchObject({ enabled: true, target: "1.1.1.1", outages: [{ kind: "no-internet" }] });
  },
  "traffic.v1.json": async () => {
    await place("traffic.v1.json", "traffic.json");
    expect(await new TrafficFile(path.join(dir, "traffic.json")).load()).toMatchObject([{ month: "2026-10", downBytes: 52_000_000_000 }]);
  },
  "ai-usage.v2.json": async () => {
    await place("ai-usage.v2.json", "ai-usage.json");
    expect((await aiUsage().accountInfos()).map((account) => account.label)).toEqual(["Work", "Codex"]);
  },
  "ai-usage.v1.json": async () => {
    await place("ai-usage.v1.json", "ai-usage.json");
    const connector = aiUsage();
    expect((await connector.accountInfos()).map((account) => account.label)).toEqual(["Work"]);
    expect(await connector.legacyPanelData()).toMatchObject({ refreshMinutes: 15, style: "used" });
  },
  ...Object.fromEntries(
    ["module-data-pending.v1.json", "module-data-pending.v0.json"].map((sample) => [
      sample,
      async () => {
        await place(sample, "module-data-pending.json");
        // Queueing more reads what waits, and keeps it.
        await queueLocalDataMove(dir, "local.other", KEY);
        const saved = JSON.parse(await readFile(path.join(dir, "module-data-pending.json"), "utf8")) as { moves: { moduleId: string }[] };
        expect(saved.moves.map((move) => move.moduleId)).toEqual(["local.notes", "local.other"]);
      },
    ]),
  ),
  "storage.v1.json": async () => {
    const file = await place("storage.v1.json", "module-data", "local", "local.notes", "poe2", "storage.json");
    const store = new ModuleStore(file);
    expect(await store.get("view")).toEqual({ tab: "builds", zoom: 1.25 });
    expect(await store.keys()).toEqual(["favorites", "view"]);
    // A write keeps every other entry as it was.
    await store.set("new", 1);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ ...(await sample("storage.v1.json")), entries: { ...(await sample("storage.v1.json")).entries, new: 1 } });
  },
  "panel-state.v1.json": async () => {
    await place("panel-state.v1.json", "panel-state", `${PANEL}.json`);
    const store = new PanelStateStore(path.join(dir, "panel-state"));
    expect(await store.get(PANEL)).toEqual({ scroll: 340, open: ["a"] });
    await store.set(PANEL, { scroll: 0 });
    expect(JSON.parse(await readFile(path.join(dir, "panel-state", `${PANEL}.json`), "utf8"))).toEqual({ ...(await sample("panel-state.v1.json")), value: { scroll: 0 } });
  },
  "document.v1.json": async () => {
    await place("document.v1.json", "documents", "build-1.json");
    const store = new DocumentStore(path.join(dir, "documents"));
    expect(await store.list()).toMatchObject([{ id: "build-1", title: "Lightning Arrow", revision: 1 }]);
    expect((await store.get("build-1"))?.data).toEqual({ class: "Ranger", level: 92, gems: ["Lightning Arrow", "Barrage"] });
  },
  ...Object.fromEntries(
    ["folders.v1.json", "folders.v0.json"].map((sample) => [
      sample,
      async () => {
        await place(sample, "folder-access", "local", "local.game", "folders.json");
        expect(await new ChosenFolders(dir, "local", "local.game").get("Documents/My Games/Path of Exile 2")).toBe(inData("Path of Exile 2"));
      },
    ]),
  ),
  ...Object.fromEntries(
    ["sources.v1.json", "sources.v0.json"].map((sample) => [
      sample,
      async () => {
        const file = await place(sample, "read-only-files", "local", "local.game", "poe2", "sources.json");
        const [id] = Object.keys(JSON.parse(await readFile(file, "utf8")) as object);
        // The linked file isn't on this PC: the link is read, and says the file is gone.
        expect(await new ReadOnlyFiles(dir, "local", "local.game", "poe2").check(id!)).toEqual({ found: false, reason: "gone" });
      },
    ]),
  ),
  "cloud-copy.v1.json": async () => {
    await place("cloud-copy.v1.json", "cloud-copy.json");
    expect(await loadCopyState(path.join(dir, "cloud-copy.json"))).toMatchObject({ version: 7, pictures: true, files: { "library.json": { size: 2048 } } });
  },
  "cloud-copy-place.v1.json": async () => {
    await place("cloud-copy-place.v1.json", "cloud-copy-place.json");
    expect(await loadPlace(path.join(dir, "cloud-copy-place.json"))).toBe(inData("OneDrive", "Tavora"));
  },
  "cloud-copy-status.v1.json": async () => {
    await place("cloud-copy-status.v1.json", "cloud-copy-status.json");
    expect(await lookSwapStatus(path.join(dir, "cloud-copy-status.json"), path.join(dir, "backups"))).toEqual({ status: "present", value: { phase: "asking", why: "lost", files: ["library.json", "workspace.json"] } });
  },
  "copy-list.v1.json": async () => {
    await place("copy-list.v1.json", "cloud-copy-staging", "copy-list.json");
    expect(await lookStagedList(path.join(dir, "cloud-copy-staging", "copy-list.json"))).toMatchObject({ status: "present", value: { version: 7, sealed: true, marked: true, listed: true, files: { "library.json": { size: 2048 } } } });
  },
  "incoming-lists.v1.json": async () => {
    const keepIn = path.join(dir, "backups", "cloud-copy-2026-11-23T10-00-00-000Z-this-pc");
    await place("incoming-lists.v1.json", "backups", path.basename(keepIn), "incoming-lists.json");
    expect(await readIncomingLists(keepIn)).toMatchObject([{ version: 7, files: { "library.json": { size: 2048 } } }]);
  },
  "cloud-copy-unused.v1.json": async () => {
    await place("cloud-copy-unused.v1.json", "cloud-copy-unused.json");
    const unused = await readUnused(path.join(dir, "cloud-copy-unused.json"), inData("OneDrive", "Tavora"));
    expect({ last: unused.last, waited: [...unused.waited] }).toEqual({ last: 1763100000000, waited: [[`ab/${"ab".repeat(16)}`, 86400000]] });
  },
};

function aiUsage(): AiUsageConnector {
  return new AiUsageConnector({
    file: path.join(dir, "ai-usage.json"),
    version: "9.9.9",
    fetch: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
    readText: async (file) => readFile(file, "utf8").catch(() => null),
    isDirectory: async () => true,
    readCodex: async () => ({ signedIn: false, apiKey: false, email: null, limits: [] }) as never,
    readClaudeEmail: async () => null,
    detect: async () => [],
    now: () => 0,
    onChange: () => undefined,
  });
}

describe("the sample files", () => {
  it.each(Object.keys(SAMPLE_TESTS))("%s opens with what it holds, and nothing is set aside", async (sample) => {
    const kept = unreadableFilesKept();
    await SAMPLE_TESTS[sample]!();
    expect(unreadableFilesKept()).toBe(kept);
    const aside = (await listAll(dir)).filter((name) => /\.(corrupt|from-version|unopened)/.test(name));
    expect(aside).toEqual([]);
  });

  it("every sample has its test, and every test its sample", async () => {
    const files = (await readdir(SAMPLES)).filter((name) => name.endsWith(".json")).sort();
    expect(Object.keys(SAMPLE_TESTS).sort()).toEqual(files);
  });

  it("every file of the user's has a sample of the version this Tavora writes", async () => {
    const files = await readdir(SAMPLES);
    const sampleOf: Record<keyof typeof STORE_VERSIONS, string[]> = {
      moduleSettings: ["storage"],
      panelState: ["panel-state"],
      document: ["document"],
      chosenFolders: ["folders"],
      readOnlyFiles: ["sources"],
      cloudCopy: ["cloud-copy"],
      copyPlace: ["cloud-copy-place"],
      copyStatus: ["cloud-copy-status"],
      copyList: ["copy-list"],
      incomingLists: ["incoming-lists"],
      copyUnused: ["cloud-copy-unused"],
      // Sealed by the system of the PC that wrote them, so no sample can open elsewhere; saved-files.test.ts covers them.
      sealed: [],
    };
    const wanted = [
      ...Object.entries(SUPPORTED_VERSIONS).map(([name, version]) => `${name.slice(0, -".json".length)}.v${version}.json`),
      ...Object.entries(sampleOf).flatMap(([key, names]) => names.map((name) => `${name}.v${STORE_VERSIONS[key as keyof typeof STORE_VERSIONS]}.json`)),
    ];
    expect(wanted.filter((name) => !files.includes(name))).toEqual([]);
  });
});

async function listAll(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}
