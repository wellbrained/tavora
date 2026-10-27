import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GameOverlayStore } from "./game-overlays";
import { HotkeyStore } from "./hotkeys";
import { sanitizeLibrary } from "./library";
import { OverlayStore } from "./overlays";
import { SavedData } from "./saved-data";
import { BEFORE_WORKSPACES_DIR, MOVED_VERSIONS, moveToWorkspaces } from "./workspace-move";

// A folder a dialog last opened in: absolute on the system the tests run on, as Tavora only keeps absolute ones.
const PICTURES = process.platform === "win32" ? "C:\\Users\\User\\Pictures" : "/home/user/Pictures";

// What Tavora 0.21.42 (the last before the Game → Workspace rename) wrote, field for field.
const NOTES = "aaaaaaaa-0000-4000-8000-000000000001";
const PLANNER = "aaaaaaaa-0000-4000-8000-000000000002";
const BOARD = "aaaaaaaa-0000-4000-8000-000000000003";
const FOLDER = "bbbbbbbb-0000-4000-8000-000000000001";
const SNAPSHOT = "cccccccc-0000-4000-8000-000000000001";

const OLD_LIBRARY = {
  version: 1,
  games: {
    "elden-ring": {
      id: "elden-ring",
      kind: "game",
      catalogId: "elden-ring",
      name: "Elden Ring",
      icon: { kind: "monogram", text: "ER" },
      useOriginalIcon: true,
      steamAppId: 1245620,
      iconFile: "1245620.ico",
      iconCheckedAt: null,
      iconSharedAt: null,
      showNews: true,
      addedAt: "2026-10-01T10:00:00.000Z",
      lastPlayedAt: "2026-10-26T20:00:00.000Z",
      trashedAt: null,
    },
    "local-my-mod": {
      id: "local-my-mod",
      kind: "game",
      catalogId: null,
      name: "My Mod",
      icon: { kind: "image", file: "local-my-mod-1a2b3c4d.png" },
      useOriginalIcon: true,
      steamAppId: null,
      iconFile: null,
      iconCheckedAt: "2026-10-20T10:00:00.000Z",
      iconSharedAt: null,
      showNews: true,
      addedAt: "2026-10-02T10:00:00.000Z",
      lastPlayedAt: null,
      trashedAt: null,
    },
    "local-personal": {
      id: "local-personal",
      kind: "workspace",
      catalogId: null,
      name: "Personal",
      icon: { kind: "monogram", text: "P" },
      useOriginalIcon: false,
      steamAppId: null,
      iconFile: null,
      iconCheckedAt: null,
      iconSharedAt: null,
      showNews: false,
      addedAt: "2026-10-03T10:00:00.000Z",
      lastPlayedAt: "2026-10-27T08:00:00.000Z",
      trashedAt: null,
    },
    satisfactory: {
      id: "satisfactory",
      kind: "game",
      catalogId: "satisfactory",
      name: "Satisfactory",
      icon: { kind: "monogram", text: "S" },
      useOriginalIcon: true,
      steamAppId: 526870,
      iconFile: null,
      iconCheckedAt: null,
      iconSharedAt: null,
      showNews: true,
      addedAt: "2026-10-04T10:00:00.000Z",
      lastPlayedAt: null,
      trashedAt: "2026-10-25T10:00:00.000Z",
    },
  },
  folders: { [FOLDER]: { id: FOLDER, name: "Souls", label: null, games: ["elden-ring"] } },
  root: [
    { kind: "folder", id: FOLDER },
    { kind: "game", id: "local-my-mod" },
    { kind: "game", id: "local-personal" },
  ],
  favorites: ["local-personal"],
  sort: "manual",
  rail: { expanded: true, width: 280 },
  startup: "last-game",
  gameStart: "ask",
  gameEndWorkspace: "local-personal",
  grayscaleText: false,
  onlineSearch: true,
  autoUpdate: true,
  autoUpdateModules: false,
  steamIcons: true,
  moduleIcons: true,
  streamOverlays: true,
  overlayPort: 47820,
  gameOverlays: true,
  overlaysStay: true,
  moduleFilesFolder: null,
  developmentFolders: [],
  dialogFolders: { "game-image": PICTURES, "save-picture": path.join(PICTURES, "Tavora") },
  moduleFolders: {},
  moduleNotesSeen: { "official:tavora.notes": "1.4.0" },
  steamProfile: null,
  iconsOffered: ["hades"],
  language: "system",
  theme: { id: "tavora.default", variation: "dark" },
  followSystem: true,
  onboarded: true,
  browser: { sharedSites: ["youtube.com"], adblockOff: [] },
  lastGameId: "local-personal",
};

const OLD_WORKSPACE = {
  version: 2,
  games: {
    "elden-ring": {
      instances: [{ instanceId: NOTES, moduleId: "tavora.notes" }],
      layout: { width: 1600, height: 900, direction: "row", root: { kind: "split", size: 1600, children: [{ kind: "group", size: 1600, panels: [NOTES], active: NOTES }] } },
      snapshots: [{ id: SNAPSHOT, name: "Boss", savedAt: "2026-10-20T10:00:00.000Z", layout: { width: 1600, height: 900, direction: "row", root: { kind: "split", size: 1600, children: [{ kind: "group", size: 1600, panels: [NOTES], active: NOTES }] } }, modules: { [NOTES]: "tavora.notes" } }],
    },
    "local-personal": {
      instances: [{ instanceId: BOARD, moduleId: "tavora.whiteboard" }, { instanceId: PLANNER, moduleId: "tavora.todos" }],
      layout: null,
      snapshots: [],
    },
    "local-my-mod": { instances: [], layout: null, snapshots: [] },
    satisfactory: { instances: [], layout: null, snapshots: [] },
  },
};

const anchor = { h: "left", v: "top", x: 0.05, y: 0.05, width: 0.2, height: 0.1 };
const fractions = { x: 0.05, y: 0.05, width: 0.2, height: 0.1 };
const OLD_GAME_OVERLAYS = {
  version: 3,
  exclusiveHintShown: true,
  layout: {
    grid: { size: 24, snap: true },
    seen: { "elden-ring": { width: 2560, height: 1440 } },
    games: { "elden-ring": { detached: false, positions: {} } },
  },
  overlays: [
    { owner: "official", moduleId: "tavora.clock-counter", gameId: "elden-ring", key: "deaths", scope: "game", mode: "always", opacity: 100, hideFromCapture: false, rect: fractions, anchor },
    { owner: "official", moduleId: "tavora.clock-counter", gameId: "local-personal", key: "timer", scope: "all", mode: "toggle", opacity: 75, hideFromCapture: true, rect: fractions, anchor },
  ],
  panels: [{ owner: "official", moduleId: "tavora.todos", gameId: "local-personal", scope: "all", instanceId: PLANNER, rect: fractions, anchor, mode: "always", opacity: 100, hideFromCapture: false }],
};

const OLD_OVERLAY_LINKS = {
  version: 1,
  links: [{ token: "a".repeat(32), owner: "official", moduleId: "tavora.clock-counter", gameId: "elden-ring", key: "deaths", state: { count: 12 } }],
};

const OLD_HOTKEYS = {
  version: 1,
  hotkeys: [
    { owner: "official", moduleId: "tavora.clock-counter", gameId: "elden-ring", action: "count", target: "deaths", label: "Deaths", accelerator: "Ctrl+Alt+D" },
    { owner: "tavora", moduleId: "tavora", gameId: "$all", action: "$layer", target: "layer", label: "Tavora over game", accelerator: "Ctrl+Shift+Space" },
  ],
};

const OLD_FILES: Record<string, unknown> = {
  "library.json": OLD_LIBRARY,
  "workspace.json": OLD_WORKSPACE,
  "game-overlays.json": OLD_GAME_OVERLAYS,
  "overlays.json": OLD_OVERLAY_LINKS,
  "hotkeys.json": OLD_HOTKEYS,
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "tavora-workspace-move-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Writes the files as Tavora 0.21.42 did: library and workspace without a final newline, the others with one. */
async function writeOld(files: Record<string, unknown> = OLD_FILES): Promise<void> {
  for (const [name, value] of Object.entries(files)) {
    const body = JSON.stringify(value, null, 2);
    await writeFile(path.join(dir, name), name === "library.json" || name === "workspace.json" ? body : `${body}\n`);
  }
}

const read = async (name: string) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as Record<string, any>;

describe("moving saved data to the workspace names", () => {
  it("renames every key of the library and keeps every other value as it was", async () => {
    await writeOld();
    expect(await moveToWorkspaces(dir)).toEqual(["library.json", "workspace.json", "game-overlays.json", "overlays.json", "hotkeys.json"]);
    const library = await read("library.json");
    expect(library.version).toBe(2);
    expect(library).not.toHaveProperty("games");
    expect(library).not.toHaveProperty("lastGameId");
    expect(library).not.toHaveProperty("gameEndWorkspace");
    expect(library.lastWorkspaceId).toBe("local-personal");
    expect(library.gameEndWorkspaceId).toBe("local-personal");
    expect(library.startup).toBe("last-workspace");
    expect(library.root).toEqual([
      { kind: "folder", id: FOLDER },
      { kind: "workspace", id: "local-my-mod" },
      { kind: "workspace", id: "local-personal" },
    ]);
    expect(library.folders[FOLDER]).toEqual({ id: FOLDER, name: "Souls", label: null, workspaces: ["elden-ring"] });
    expect(library.dialogFolders).toEqual({ "workspace-image": PICTURES, "save-picture": path.join(PICTURES, "Tavora") });
    expect(Object.keys(library.workspaces)).toEqual(Object.keys(OLD_LIBRARY.games));
    expect(library.workspaces["local-personal"]).toMatchObject({ kind: "personal", lastOpenedAt: "2026-10-27T08:00:00.000Z" });
    expect(library.workspaces["elden-ring"]).toMatchObject({ kind: "game", lastOpenedAt: "2026-10-26T20:00:00.000Z", iconFile: "1245620.ico" });
    expect(library.workspaces["elden-ring"]).not.toHaveProperty("lastPlayedAt");
    // Settings that have nothing to do with the rename stay exactly as they were, in their places.
    const untouched = ["favorites", "sort", "rail", "gameStart", "streamOverlays", "gameOverlays", "moduleNotesSeen", "iconsOffered", "theme", "browser"] as const;
    for (const key of untouched) expect(library[key]).toEqual(OLD_LIBRARY[key]);
    expect(Object.keys(library)).toEqual(Object.keys(OLD_LIBRARY).map((key) => ({ games: "workspaces", gameEndWorkspace: "gameEndWorkspaceId", lastGameId: "lastWorkspaceId" })[key] ?? key));
  });

  it("is read back by this Tavora as the same library, workspaces, overlays, links and hotkeys", async () => {
    await writeOld();
    await moveToWorkspaces(dir);
    const saved = new SavedData(dir);
    const library = await saved.loadLibrary();
    expect(Object.keys(library.workspaces).sort()).toEqual(["elden-ring", "local-my-mod", "local-personal", "satisfactory"]);
    expect(library.workspaces.satisfactory!.trashedAt).toBe("2026-10-25T10:00:00.000Z");
    expect(library.workspaces["local-personal"]!.kind).toBe("personal");
    expect(library.root).toEqual([
      { kind: "folder", id: FOLDER },
      { kind: "workspace", id: "local-my-mod" },
      { kind: "workspace", id: "local-personal" },
    ]);
    expect(library.folders[FOLDER]!.workspaces).toEqual(["elden-ring"]);
    expect(library).toMatchObject({ startup: "last-workspace", lastWorkspaceId: "local-personal", gameEndWorkspaceId: "local-personal", favorites: ["local-personal"] });
    expect(library.dialogFolders["workspace-image"]).toBe(PICTURES);

    const workspace = await saved.loadWorkspace(Object.keys(library.workspaces), () => true);
    expect(workspace.version).toBe(3);
    expect(workspace.workspaces["elden-ring"]!.instances).toEqual([{ instanceId: NOTES, moduleId: "tavora.notes" }]);
    expect(workspace.workspaces["elden-ring"]!.snapshots.map((snapshot) => snapshot.name)).toEqual(["Boss"]);
    expect(workspace.workspaces["local-personal"]!.instances.map((record) => record.instanceId)).toEqual([BOARD, PLANNER]);

    const overlays = await GameOverlayStore.load(dir, (id) => (library.workspaces[id]?.kind === "personal" ? "all" : "game"));
    expect(overlays.migrated).toBe(false);
    expect(overlays.upgraded).toBe(false);
    expect(overlays.all().map((overlay) => [overlay.workspaceId, overlay.key, overlay.scope, overlay.mode])).toEqual([
      ["elden-ring", "deaths", "game", "always"],
      ["local-personal", "timer", "all", "toggle"],
    ]);
    expect(overlays.panels().map((panel) => [panel.workspaceId, panel.instanceId, panel.scope])).toEqual([["local-personal", PLANNER, "all"]]);
    // Positions per game window stay by game.
    expect(overlays.seenSize("elden-ring")).toEqual({ width: 2560, height: 1440 });

    const links = await OverlayStore.load(dir);
    expect(links.find("a".repeat(32))).toEqual({
      link: { token: "a".repeat(32), owner: "official", moduleId: "tavora.clock-counter", workspaceId: "elden-ring", key: "deaths" },
      state: { count: 12 },
    });
    const hotkeys = await HotkeyStore.load(dir);
    expect(hotkeys.all().map((record) => [record.workspaceId, record.action, record.accelerator])).toEqual([
      ["elden-ring", "count", "Ctrl+Alt+D"],
      ["$all", "$layer", "Ctrl+Shift+Space"],
    ]);
  });

  it("copies the files as they were to backups/before-workspaces first", async () => {
    await writeOld();
    const before = Object.fromEntries(await Promise.all(Object.keys(OLD_FILES).map(async (name) => [name, await readFile(path.join(dir, name))] as const)));
    await moveToWorkspaces(dir);
    const backup = path.join(dir, "backups", BEFORE_WORKSPACES_DIR);
    expect((await readdir(backup)).sort()).toEqual(Object.keys(OLD_FILES).sort());
    for (const [name, bytes] of Object.entries(before)) expect((await readFile(path.join(backup, name))).equals(bytes)).toBe(true);
  });

  it("moves each file only once: a second start changes nothing", async () => {
    await writeOld();
    await moveToWorkspaces(dir);
    const after = Object.fromEntries(await Promise.all(Object.keys(OLD_FILES).map(async (name) => [name, await readFile(path.join(dir, name), "utf8")] as const)));
    expect(await moveToWorkspaces(dir)).toEqual([]);
    for (const [name, text] of Object.entries(after)) expect(await readFile(path.join(dir, name), "utf8")).toBe(text);
    expect(await readdir(path.join(dir, "backups", BEFORE_WORKSPACES_DIR))).toHaveLength(Object.keys(OLD_FILES).length);
  });

  it("finishes the rest after a start that stopped half way, and keeps the first backup", async () => {
    await writeOld();
    // The crash: the library and the workspace were written, then writing the game overlays failed (a folder stands
    // where its temp file goes) and Tavora stopped.
    await mkdir(path.join(dir, "game-overlays.json.tmp"));
    await expect(moveToWorkspaces(dir)).rejects.toThrow();
    await rm(path.join(dir, "game-overlays.json.tmp"), { recursive: true });
    expect((await read("library.json")).version).toBe(2);
    expect((await read("workspace.json")).version).toBe(3);
    expect((await read("game-overlays.json")).version).toBe(3);

    expect(await moveToWorkspaces(dir)).toEqual(["game-overlays.json", "overlays.json", "hotkeys.json"]);
    expect((await read("game-overlays.json")).overlays[0].workspaceId).toBe("elden-ring");
    // The backup still has every file as the first start found it, once.
    const backup = path.join(dir, "backups", BEFORE_WORKSPACES_DIR);
    expect((await readdir(backup)).sort()).toEqual(Object.keys(OLD_FILES).sort());
    expect(JSON.parse(await readFile(path.join(backup, "library.json"), "utf8"))).toEqual(OLD_LIBRARY);
  });

  it("does not write anything when the backup can't be made", async () => {
    await writeOld();
    await mkdir(path.join(dir, "backups"), { recursive: true });
    // A file where the backup folder should be.
    await writeFile(path.join(dir, "backups", BEFORE_WORKSPACES_DIR), "in the way");
    await expect(moveToWorkspaces(dir)).rejects.toThrow();
    expect(await read("library.json")).toEqual(OLD_LIBRARY);
    expect(await read("workspace.json")).toEqual(OLD_WORKSPACE);
  });

  it("keeps an older backup when the files are moved again (an older Tavora was used in between)", async () => {
    await writeOld();
    await moveToWorkspaces(dir);
    const other = { ...OLD_LIBRARY, sort: "recent" };
    await writeOld({ "library.json": other });
    expect(await moveToWorkspaces(dir)).toEqual(["library.json"]);
    const backup = path.join(dir, "backups", BEFORE_WORKSPACES_DIR);
    expect(JSON.parse(await readFile(path.join(backup, "library.json"), "utf8"))).toEqual(OLD_LIBRARY);
    expect(JSON.parse(await readFile(path.join(backup, "library.json.2"), "utf8"))).toEqual(other);
  });

  it("leaves missing, unreadable and newer files to the code that reads them", async () => {
    await writeFile(path.join(dir, "library.json"), "{ broken");
    await writeFile(path.join(dir, "workspace.json"), JSON.stringify({ version: 9, games: {} }));
    await writeFile(path.join(dir, "hotkeys.json"), JSON.stringify([1, 2]));
    expect(await moveToWorkspaces(dir)).toEqual([]);
    expect(await readFile(path.join(dir, "library.json"), "utf8")).toBe("{ broken");
    expect(await read("workspace.json")).toEqual({ version: 9, games: {} });
    await expect(readdir(path.join(dir, "backups"))).rejects.toThrow();
  });

  it("moves a file without a version as the oldest kind, and leaves a fresh data folder empty", async () => {
    expect(await moveToWorkspaces(dir)).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
    await writeOld({ "library.json": { games: { poe2: { id: "poe2", name: "Path of Exile 2", addedAt: "2026-10-01T10:00:00.000Z" } }, root: [{ kind: "game", id: "poe2" }] } });
    await moveToWorkspaces(dir);
    const library = sanitizeLibrary(await read("library.json"));
    expect(Object.keys(library.workspaces)).toEqual(["poe2"]);
    expect(library.root).toEqual([{ kind: "workspace", id: "poe2" }]);
  });

  it("keeps what an older game overlays file still needs: version 1 and 2 say so in formerVersion until written again", async () => {
    const overlay = { owner: "official", moduleId: "tavora.clock-counter", gameId: "elden-ring", key: "deaths", mode: "always", opacity: 100, rect: fractions };
    for (const [version, migrated, upgraded] of [[1, true, true], [2, false, true], [3, false, false]] as const) {
      await writeOld({ "game-overlays.json": { version, overlays: [overlay], panels: [] } });
      await moveToWorkspaces(dir);
      const moved = await read("game-overlays.json");
      expect(moved.version).toBe(MOVED_VERSIONS["game-overlays.json"]);
      expect(moved.formerVersion).toBe(version === 3 ? undefined : version);
      const store = await GameOverlayStore.load(dir);
      expect([store.migrated, store.upgraded]).toEqual([migrated, upgraded]);
      expect(store.all().map((item) => item.workspaceId)).toEqual(["elden-ring"]);
      await store.save();
      expect(await read("game-overlays.json")).not.toHaveProperty("formerVersion");
      await rm(path.join(dir, "backups"), { recursive: true, force: true });
    }
  });
});
