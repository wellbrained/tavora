import { describe, expect, it, vi } from "vitest";
import { gameFolderKey, GameWatcher, POLL_SECONDS, runningGames, runningNotInLibrary, unlistedToOffer } from "./game-watch";
import type { UnlistedGame } from "../shared/host-api";
import type { InstalledGame } from "./launcher-games";
import { addWorkspace, emptyLibrary, liveWorkspaces, markOpened, restoreWorkspace, trashWorkspace } from "./library";
import type { ProgramLook } from "./program-list";

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

const DIABLO: InstalledGame = { source: "battlenet", name: "Diablo IV", file: "G:\\Blizzard\\Diablo IV\\Diablo IV.exe", index: 0, folder: "G:\\Blizzard\\Diablo IV" };
const FORTNITE: InstalledGame = { source: "epic", name: "Fortnite", file: "D:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient.exe", index: 0, folder: "D:\\Epic\\Fortnite" };

describe("gameFolderKey", () => {
  it("keeps a game's own folder, lowercased with a trailing separator", () => {
    expect(gameFolderKey("G:\\Blizzard\\Diablo IV\\")).toBe("g:\\blizzard\\diablo iv\\");
    expect(gameFolderKey("D:\\Diablo IV")).toBe("d:\\diablo iv\\");
  });

  it.each(["C:", "C:\\", "C:\\Program Files (x86)", "D:\\Games", "D:\\SteamLibrary\\steamapps\\common", "C:\\Program Files (x86)\\Battle.net", "relative\\folder"])(
    "refuses %s, which holds more than one game",
    (folder) => expect(gameFolderKey(folder)).toBeNull(),
  );
});

describe("runningGames", () => {
  it("finds a game by a program inside its install folder", () => {
    const library = emptyLibrary();
    addWorkspace(library, { catalogId: "diablo-4" }, day(1));
    addWorkspace(library, { name: "Fortnite" }, day(1));
    const running = runningGames(liveWorkspaces(library), [DIABLO, FORTNITE], ["C:\\Windows\\explorer.exe", "D:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe"], null);
    expect([...running]).toEqual(["local-fortnite"]);
  });

  it("ignores installers, crash reporters and launchers in the folder", () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "Fortnite" }, day(1));
    const programs = ["D:\\Epic\\Fortnite\\CrashReportClient.exe", "D:\\Epic\\Fortnite\\FortniteLauncher.exe", "D:\\Epic\\Fortnite\\unins000.exe"];
    expect(runningGames(liveWorkspaces(library), [FORTNITE], programs, null).size).toBe(0);
  });

  it("finds a Steam game by the id Steam runs, without its folder", () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "Some Game", steamAppId: 570 }, day(1));
    expect([...runningGames(liveWorkspaces(library), [], [], 570)]).toEqual(["local-some-game"]);
    expect(runningGames(liveWorkspaces(library), [], [], 730).size).toBe(0);
  });

  it("counts a game in the library twice once, as the one opened last", () => {
    const library = emptyLibrary();
    addWorkspace(library, { catalogId: "diablo-4" }, day(1));
    addWorkspace(library, { name: "Diablo 4" }, day(2));
    const programs = ["G:\\Blizzard\\Diablo IV\\Diablo IV.exe"];
    // Never opened: the one added last.
    expect([...runningGames(liveWorkspaces(library), [DIABLO], programs, null)]).toEqual(["local-diablo-4"]);
    markOpened(library, "diablo-4", day(3));
    expect([...runningGames(liveWorkspaces(library), [DIABLO], programs, null)]).toEqual(["diablo-4"]);
  });

  it("counts a game installed by two launchers when either copy runs", () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "Diablo IV" }, day(1));
    const steamCopy: InstalledGame = { source: "steam", name: "Diablo® IV", file: "E:\\Steam\\steamapps\\common\\Diablo IV\\Diablo IV.exe", index: 0, folder: "E:\\Steam\\steamapps\\common\\Diablo IV" };
    expect([...runningGames(liveWorkspaces(library), [DIABLO, steamCopy], ["E:\\Steam\\steamapps\\common\\Diablo IV\\Diablo IV.exe"], null)]).toEqual(["local-diablo-iv"]);
    expect([...runningGames(liveWorkspaces(library), [DIABLO, steamCopy], ["G:\\Blizzard\\Diablo IV\\Diablo IV.exe"], null)]).toEqual(["local-diablo-iv"]);
  });

  it("ignores a folder two games claim, personal workspaces and games in Trash", () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "Alpha" }, day(1));
    addWorkspace(library, { name: "Beta" }, day(1));
    addWorkspace(library, { personal: "Fortnite" }, day(1));
    addWorkspace(library, { name: "Gamma" }, day(1));
    trashWorkspace(library, "local-gamma", day(2));
    const shared = (name: string): InstalledGame => ({ source: "windows", name, file: "C:\\Tools\\Hub\\hub.exe", index: 0 });
    const gamma: InstalledGame = { source: "windows", name: "Gamma", file: "C:\\Gamma\\gamma.exe", index: 0 };
    const programs = ["C:\\Tools\\Hub\\hub.exe", "D:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient.exe", "C:\\Gamma\\gamma.exe"];
    expect(runningGames(Object.values(library.workspaces), [shared("Alpha"), shared("Beta"), FORTNITE, gamma], programs, null).size).toBe(0);
  });
});

describe("runningNotInLibrary", () => {
  const KINGS: InstalledGame = { source: "steam", name: "9 Kings", steamAppId: 2784470, file: "E:\\Steam\\steamapps\\common\\9 Kings\\9Kings.exe", index: 0, folder: "E:\\Steam\\steamapps\\common\\9 Kings" };
  // Steam writes its games into Windows' list of programs too, without the id.
  const KINGS_LISTED: InstalledGame = { source: "windows", name: "9 Kings", file: "E:\\Steam\\steamapps\\common\\9 Kings\\9Kings.exe", index: 0, folder: "E:\\Steam\\steamapps\\common\\9 Kings" };
  const EDGE: InstalledGame = { source: "windows", name: "Microsoft Edge", file: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", index: 0, folder: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application" };
  const kings: UnlistedGame = { name: "9 Kings", steamAppId: 2784470, catalogId: null };
  /** The installed Steam apps Steam calls games. */
  const GAMES = new Set([2784470]);

  it("finds a game Steam runs that is not in the library, named as Steam installed it", () => {
    expect(runningNotInLibrary([], [KINGS, KINGS_LISTED, DIABLO], [], 2784470, GAMES)).toEqual([kings]);
  });

  it("leaves out an app Steam runs but did not install", () => {
    expect(runningNotInLibrary([], [DIABLO], [], 2784470, GAMES)).toEqual([]);
  });

  it("finds a game by a program in the folder a launcher installed it in, once, its Steam copy first", () => {
    expect(runningNotInLibrary([], [KINGS_LISTED, KINGS], ["E:\\Steam\\steamapps\\common\\9 Kings\\9Kings.exe"], null, GAMES)).toEqual([kings]);
    expect(runningNotInLibrary([], [FORTNITE], [FORTNITE.file], null, GAMES)).toEqual([{ name: "Fortnite", steamAppId: null, catalogId: "fortnite" }]);
  });

  it("never takes a program from Windows' list for a game, unless it is a built-in one", () => {
    expect(runningNotInLibrary([], [EDGE], [EDGE.file], null, GAMES)).toEqual([]);
    expect(runningNotInLibrary([], [KINGS_LISTED], [KINGS_LISTED.file], null, GAMES)).toEqual([]);
    const diablo = { ...DIABLO, source: "windows" as const };
    expect(runningNotInLibrary([], [diablo], [DIABLO.file], null, GAMES)).toEqual([{ name: "Diablo IV", steamAppId: null, catalogId: "diablo-4" }]);
  });

  it("counts a game whose copies are all in Trash as not in the library, and leaves out one that is", () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "9 Kings", steamAppId: 2784470 }, day(1));
    expect(runningNotInLibrary(Object.values(library.workspaces), [KINGS], [], 2784470, GAMES)).toEqual([]);
    trashWorkspace(library, "local-9-kings", day(2));
    expect(runningNotInLibrary(Object.values(library.workspaces), [KINGS], [], 2784470, GAMES)).toEqual([kings]);
    // By name too, for a copy added without its Steam id.
    addWorkspace(library, { name: "9 Kings" }, day(3));
    expect(runningNotInLibrary(Object.values(library.workspaces), [KINGS], [], 2784470, GAMES)).toEqual([]);
  });

  it("counts a Steam app only when Steam says it is a game, by its folder or as the app Steam runs", () => {
    // Steam installs software too, such as Wallpaper Engine, which runs all day.
    const wallpaper: InstalledGame = {
      source: "steam",
      name: "Wallpaper Engine",
      steamAppId: 431960,
      file: "E:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper32.exe",
      index: 0,
      folder: "E:\\Steam\\steamapps\\common\\wallpaper_engine",
    };
    const installed = [wallpaper, KINGS];
    expect(runningNotInLibrary([], installed, [wallpaper.file], null, GAMES)).toEqual([]);
    expect(runningNotInLibrary([], installed, [], 431960, GAMES)).toEqual([]);
    expect(runningNotInLibrary([], installed, [wallpaper.file], null, new Set([431960]))).toEqual([{ name: "Wallpaper Engine", steamAppId: 431960, catalogId: null }]);
    // Steam's note of the kind could not be read: nothing from Steam counts, the other launchers still do.
    expect(runningNotInLibrary([], [KINGS, FORTNITE], [KINGS.file, FORTNITE.file], 2784470, new Set())).toEqual([{ name: "Fortnite", steamAppId: null, catalogId: "fortnite" }]);
  });

  it("counts a game as in the library when its built-in game is, under another name", () => {
    const gta: InstalledGame = { source: "epic", name: "GTA V", file: "D:\\Epic\\GTAV\\GTA5.exe", index: 0, folder: "D:\\Epic\\GTAV" };
    const library = emptyLibrary();
    expect(runningNotInLibrary(liveWorkspaces(library), [gta], [gta.file], null, GAMES)).toEqual([{ name: "GTA V", steamAppId: null, catalogId: "grand-theft-auto-5" }]);
    const id = addWorkspace(library, { catalogId: "grand-theft-auto-5" }, day(1));
    expect(runningNotInLibrary(liveWorkspaces(library), [gta], [gta.file], null, GAMES)).toEqual([]);
    expect([...runningGames(liveWorkspaces(library), [gta], [gta.file], null)]).toEqual([id]);
  });

  it("ignores helpers in the folder and a folder two games claim", () => {
    const shared = (name: string): InstalledGame => ({ source: "epic", name, file: "C:\\Tools\\Hub\\hub.exe", index: 0 });
    expect(runningNotInLibrary([], [FORTNITE], ["D:\\Epic\\Fortnite\\CrashReportClient.exe"], null, GAMES)).toEqual([]);
    expect(runningNotInLibrary([], [shared("Alpha"), shared("Beta")], ["C:\\Tools\\Hub\\hub.exe"], null, GAMES)).toEqual([]);
  });
});

describe("unlistedToOffer", () => {
  const a: UnlistedGame = { name: "Alpha", steamAppId: null, catalogId: null };
  const b: UnlistedGame = { name: "Beta", steamAppId: 10, catalogId: null };

  it("offers the one started last, unless a game of the library runs", () => {
    const library = emptyLibrary();
    const fortnite = addWorkspace(library, { name: "Fortnite" }, day(1));
    expect(unlistedToOffer([a, b], liveWorkspaces(library), [], "show")).toEqual(b);
    expect(unlistedToOffer([a, b], liveWorkspaces(library), [fortnite], "show")).toBeNull();
    expect(unlistedToOffer([], liveWorkspaces(library), [], "show")).toBeNull();
    // A game of the library in Trash doesn't win.
    trashWorkspace(library, fortnite, day(2));
    expect(unlistedToOffer([a, b], liveWorkspaces(library), [fortnite], "show")).toEqual(b);
  });

  it("offers nothing while \"When a game starts\" is off", () => {
    expect(unlistedToOffer([a, b], [], [], "off")).toBeNull();
    for (const gameStart of ["show", "ask", "switch"] as const) expect(unlistedToOffer([a, b], [], [], gameStart)).toEqual(b);
  });

  it("leaves out a game added since the watcher last looked", () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "Beta", steamAppId: 10 }, day(1));
    expect(unlistedToOffer([a, b], liveWorkspaces(library), [], "show")).toEqual(a);
  });
});

describe("GameWatcher", () => {
  const FORTNITE_EXE = FORTNITE.file;
  const look = (programs: [number, string][], steamAppId: number | null = null): ProgramLook => ({ programs: new Map(programs), steamAppId });

  it("reports games already running as initial, and later changes as starts and closes", async () => {
    vi.useFakeTimers();
    try {
      const library = emptyLibrary();
      addWorkspace(library, { name: "Fortnite" }, day(1));
      addWorkspace(library, { name: "Some Game", steamAppId: 570 }, day(1));
      let now = look([[1, FORTNITE_EXE]]);
      const probe = vi.fn(() => now);
      const changes: [string[], boolean][] = [];
      const watcher = new GameWatcher({
        entries: () => liveWorkspaces(library),
        findInstalled: async () => [FORTNITE],
        onChange: (running, initial) => changes.push([[...running], initial]),
        probe,
        platform: "win32",
      });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(changes).toEqual([[["local-fortnite"], true]]);
      now = look([[1, FORTNITE_EXE]], 570);
      await vi.advanceTimersByTimeAsync(POLL_SECONDS * 1000);
      now = look([], 570);
      await vi.advanceTimersByTimeAsync(POLL_SECONDS * 1000);
      expect(changes.slice(1)).toEqual([
        [["local-some-game", "local-fortnite"], false],
        [["local-some-game"], false],
      ]);
      watcher.stop();
      expect(changes.at(-1)).toEqual([[], false]);
      const looks = probe.mock.calls.length;
      await vi.advanceTimersByTimeAsync(POLL_SECONDS * 1000 * 3);
      expect(probe).toHaveBeenCalledTimes(looks);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports running games not in the library in the order they started, and counts one added meanwhile as running", async () => {
    vi.useFakeTimers();
    try {
      const library = emptyLibrary();
      const kings: InstalledGame = { source: "steam", name: "9 Kings", steamAppId: 2784470, file: "E:\\Steam\\steamapps\\common\\9 Kings\\9Kings.exe", index: 0, folder: "E:\\Steam\\steamapps\\common\\9 Kings" };
      let now = look([], 2784470);
      const unlisted: string[][] = [];
      const changes: [string[], boolean][] = [];
      const steamKinds = vi.fn(async (appIds: ReadonlySet<number>) => {
        expect([...appIds]).toEqual([2784470]);
        return new Map([[2784470, true]]);
      });
      const watcher = new GameWatcher({
        entries: () => liveWorkspaces(library),
        findInstalled: async () => [FORTNITE, kings],
        steamKinds,
        onChange: (running, initial) => changes.push([[...running], initial]),
        onUnlisted: (games) => unlisted.push(games.map((game) => game.name)),
        probe: () => now,
        platform: "win32",
      });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      now = look([[1, FORTNITE_EXE]], 2784470);
      await vi.advanceTimersByTimeAsync(POLL_SECONDS * 1000);
      expect(unlisted).toEqual([["9 Kings"], ["9 Kings", "Fortnite"]]);
      // Added while it runs: running at once, not just started.
      const id = addWorkspace(library, { name: "Fortnite" }, day(1));
      const refreshed = watcher.libraryChanged(id);
      expect(unlisted.at(-1)).toEqual(["9 Kings"]);
      expect(changes.at(-1)).toEqual([["local-fortnite"], true]);
      await refreshed;
      expect(changes.at(-1)).toEqual([["local-fortnite"], true]);
      // An app's kind doesn't change: Steam's file was read once, not again for the second look.
      expect(steamKinds).toHaveBeenCalledTimes(1);
      watcher.stop();
      expect(unlisted.at(-1)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts only the game just added as running all along; one restored from Trash meanwhile starts, one trashed closes", async () => {
    vi.useFakeTimers();
    try {
      const library = emptyLibrary();
      const closing = addWorkspace(library, { name: "Some Game", steamAppId: 570 }, day(1));
      const diablo = addWorkspace(library, { catalogId: "diablo-4" }, day(1));
      trashWorkspace(library, diablo, day(2));
      const changes: [string[], boolean][] = [];
      const watcher = new GameWatcher({
        entries: () => liveWorkspaces(library),
        findInstalled: async () => [FORTNITE, DIABLO],
        onChange: (running, initial) => changes.push([[...running], initial]),
        probe: () =>
          look(
            [
              [1, FORTNITE_EXE],
              [2, DIABLO.file],
            ],
            570,
          ),
        platform: "win32",
      });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(changes).toEqual([[[closing], true]]);
      // Before the next look: Diablo IV comes back from Trash and Some Game goes there, and Fortnite, running, is added.
      restoreWorkspace(library, diablo);
      trashWorkspace(library, closing, day(3));
      const fortnite = addWorkspace(library, { name: "Fortnite" }, day(3));
      await watcher.libraryChanged(fortnite);
      expect(changes.slice(1)).toEqual([
        [[closing, fortnite], true],
        [[fortnite, diablo], false],
      ]);
      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts no Steam app for games not in the library when Steam's note of the kinds can't be read", async () => {
    vi.useFakeTimers();
    try {
      const kings: InstalledGame = { source: "steam", name: "9 Kings", steamAppId: 2784470, file: "E:\\Steam\\steamapps\\common\\9 Kings\\9Kings.exe", index: 0, folder: "E:\\Steam\\steamapps\\common\\9 Kings" };
      const unlisted: string[][] = [];
      const log = vi.fn();
      const watcher = new GameWatcher({
        entries: () => [],
        findInstalled: async () => [FORTNITE, kings],
        steamKinds: async () => {
          throw new Error("no appinfo");
        },
        onChange: () => undefined,
        onUnlisted: (games) => unlisted.push(games.map((game) => game.name)),
        probe: () => look([[1, FORTNITE_EXE]], 2784470),
        platform: "win32",
        log,
      });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(unlisted).toEqual([["Fortnite"]]);
      expect(log).toHaveBeenCalledWith("reading which Steam apps are games failed: Error: no appinfo");
      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps both running lists current while it watches for game overlays only, for \"When a game starts\" turned on", async () => {
    vi.useFakeTimers();
    try {
      const library = emptyLibrary();
      const fortnite = addWorkspace(library, { name: "Fortnite" }, day(1));
      let unlisted: readonly UnlistedGame[] = [];
      // The host while "When a game starts" is off: it keeps no running games (off means off).
      const watcher = new GameWatcher({
        entries: () => liveWorkspaces(library),
        findInstalled: async () => [FORTNITE, DIABLO],
        onChange: () => undefined,
        onUnlisted: (games) => (unlisted = games),
        probe: () =>
          look([
            [1, DIABLO.file],
            [2, FORTNITE_EXE],
          ]),
        platform: "win32",
      });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(unlistedToOffer(unlisted, liveWorkspaces(library), [], "off")).toBeNull();
      // Turned on: the host takes the games running now (runningNow), so the library game wins over Diablo IV.
      expect([...watcher.runningNow]).toEqual([fortnite]);
      expect(unlistedToOffer(unlisted, liveWorkspaces(library), [...watcher.runningNow], "show")).toBeNull();
      expect(unlisted.map((game) => game.name)).toEqual(["Diablo IV"]);
      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("says which games a program belongs to once the installed games are known, for the window in front", async () => {
    const library = emptyLibrary();
    addWorkspace(library, { name: "Fortnite" }, day(1));
    const watcher = new GameWatcher({ entries: () => liveWorkspaces(library), findInstalled: async () => [FORTNITE], onChange: () => undefined, probe: () => look([]), platform: "win32" });
    expect(watcher.gamesOf(FORTNITE_EXE).size).toBe(0);
    watcher.start();
    await watcher.refreshInstalled();
    expect([...watcher.gamesOf(FORTNITE_EXE)]).toEqual(["local-fortnite"]);
    expect(watcher.gamesOf("C:\Windows\explorer.exe").size).toBe(0);
    watcher.stop();
  });

  it("stops looking when Windows can't be asked", async () => {
    vi.useFakeTimers();
    try {
      const probe = vi.fn((): ProgramLook => {
        throw new Error("no koffi");
      });
      const log = vi.fn();
      const watcher = new GameWatcher({ entries: () => [], findInstalled: async () => [], onChange: () => undefined, probe, platform: "win32", log });
      watcher.start();
      await vi.advanceTimersByTimeAsync(POLL_SECONDS * 1000 * 3);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("the game watcher stopped: no koffi");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing away from Windows", () => {
    const probe = vi.fn();
    const watcher = new GameWatcher({ entries: () => [], findInstalled: async () => [], onChange: () => undefined, probe, platform: "linux" });
    watcher.start();
    expect(watcher.active).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
  it("takes a test's Steam game as running, on any platform", async () => {
    vi.useFakeTimers();
    try {
      const library = emptyLibrary();
      const id = addWorkspace(library, { name: "Some Game", steamAppId: 570 }, day(1));
      const changes: [string[], boolean][] = [];
      const watcher = new GameWatcher({
        entries: () => liveWorkspaces(library),
        findInstalled: async () => [],
        onChange: (running, initial) => changes.push([[...running], initial]),
        platform: "linux",
        testSteamAppId: () => 570,
      });
      watcher.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(changes).toEqual([[[id], true]]);
      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
