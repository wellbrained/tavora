import { describe, expect, it, vi } from "vitest";
import { gameFolderKey, GameWatcher, POLL_SECONDS, runningGames } from "./game-watch";
import type { InstalledGame } from "./launcher-games";
import { addGame, emptyLibrary, liveGames, markPlayed, trashGame } from "./library";
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
    addGame(library, { catalogId: "diablo-4" }, day(1));
    addGame(library, { name: "Fortnite" }, day(1));
    const running = runningGames(liveGames(library), [DIABLO, FORTNITE], ["C:\\Windows\\explorer.exe", "D:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe"], null);
    expect([...running]).toEqual(["local-fortnite"]);
  });

  it("ignores installers, crash reporters and launchers in the folder", () => {
    const library = emptyLibrary();
    addGame(library, { name: "Fortnite" }, day(1));
    const programs = ["D:\\Epic\\Fortnite\\CrashReportClient.exe", "D:\\Epic\\Fortnite\\FortniteLauncher.exe", "D:\\Epic\\Fortnite\\unins000.exe"];
    expect(runningGames(liveGames(library), [FORTNITE], programs, null).size).toBe(0);
  });

  it("finds a Steam game by the id Steam runs, without its folder", () => {
    const library = emptyLibrary();
    addGame(library, { name: "Some Game", steamAppId: 570 }, day(1));
    expect([...runningGames(liveGames(library), [], [], 570)]).toEqual(["local-some-game"]);
    expect(runningGames(liveGames(library), [], [], 730).size).toBe(0);
  });

  it("counts a game in the library twice once, as the one opened last", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "diablo-4" }, day(1));
    addGame(library, { name: "Diablo 4" }, day(2));
    const programs = ["G:\\Blizzard\\Diablo IV\\Diablo IV.exe"];
    // Never opened: the one added last.
    expect([...runningGames(liveGames(library), [DIABLO], programs, null)]).toEqual(["local-diablo-4"]);
    markPlayed(library, "diablo-4", day(3));
    expect([...runningGames(liveGames(library), [DIABLO], programs, null)]).toEqual(["diablo-4"]);
  });

  it("counts a game installed by two launchers when either copy runs", () => {
    const library = emptyLibrary();
    addGame(library, { name: "Diablo IV" }, day(1));
    const steamCopy: InstalledGame = { source: "steam", name: "Diablo® IV", file: "E:\\Steam\\steamapps\\common\\Diablo IV\\Diablo IV.exe", index: 0, folder: "E:\\Steam\\steamapps\\common\\Diablo IV" };
    expect([...runningGames(liveGames(library), [DIABLO, steamCopy], ["E:\\Steam\\steamapps\\common\\Diablo IV\\Diablo IV.exe"], null)]).toEqual(["local-diablo-iv"]);
    expect([...runningGames(liveGames(library), [DIABLO, steamCopy], ["G:\\Blizzard\\Diablo IV\\Diablo IV.exe"], null)]).toEqual(["local-diablo-iv"]);
  });

  it("ignores a folder two games claim, workspaces and games in Trash", () => {
    const library = emptyLibrary();
    addGame(library, { name: "Alpha" }, day(1));
    addGame(library, { name: "Beta" }, day(1));
    addGame(library, { workspace: "Fortnite" }, day(1));
    addGame(library, { name: "Gamma" }, day(1));
    trashGame(library, "local-gamma", day(2));
    const shared = (name: string): InstalledGame => ({ source: "windows", name, file: "C:\\Tools\\Hub\\hub.exe", index: 0 });
    const gamma: InstalledGame = { source: "windows", name: "Gamma", file: "C:\\Gamma\\gamma.exe", index: 0 };
    const programs = ["C:\\Tools\\Hub\\hub.exe", "D:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient.exe", "C:\\Gamma\\gamma.exe"];
    expect(runningGames(Object.values(library.games), [shared("Alpha"), shared("Beta"), FORTNITE, gamma], programs, null).size).toBe(0);
  });
});

describe("GameWatcher", () => {
  const FORTNITE_EXE = FORTNITE.file;
  const look = (programs: [number, string][], steamAppId: number | null = null): ProgramLook => ({ programs: new Map(programs), steamAppId });

  it("reports games already running as initial, and later changes as starts and closes", async () => {
    vi.useFakeTimers();
    try {
      const library = emptyLibrary();
      addGame(library, { name: "Fortnite" }, day(1));
      addGame(library, { name: "Some Game", steamAppId: 570 }, day(1));
      let now = look([[1, FORTNITE_EXE]]);
      const probe = vi.fn(() => now);
      const changes: [string[], boolean][] = [];
      const watcher = new GameWatcher({
        entries: () => liveGames(library),
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

  it("says which games a program belongs to once the installed games are known, for the window in front", async () => {
    const library = emptyLibrary();
    addGame(library, { name: "Fortnite" }, day(1));
    const watcher = new GameWatcher({ entries: () => liveGames(library), findInstalled: async () => [FORTNITE], onChange: () => undefined, probe: () => look([]), platform: "win32" });
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
});
