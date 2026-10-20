import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { applyProbeLine, gameFolderKey, GameWatcher, probeScript, runningGames, type ProbeState } from "./game-watch";
import type { InstalledGame } from "./launcher-games";
import { addGame, emptyLibrary, liveGames, markPlayed, trashGame } from "./library";

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

  it("counts a game in the library twice once, as the one played last", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "diablo-4" }, day(1));
    addGame(library, { name: "Diablo 4" }, day(2));
    const programs = ["G:\\Blizzard\\Diablo IV\\Diablo IV.exe"];
    // Never played: the one added last.
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

describe("applyProbeLine", () => {
  it("keeps the running programs and Steam's game, and marks the end of a look", () => {
    const state: ProbeState = { programs: new Map(), steamAppId: null };
    expect(applyProbeLine(state, "+42\tC:\\Games\\a.exe")).toBe(false);
    applyProbeLine(state, "+43\tC:\\Games\\b.exe");
    applyProbeLine(state, "+44\tnot a path");
    applyProbeLine(state, "-42");
    applyProbeLine(state, "s570");
    expect(applyProbeLine(state, ".")).toBe(true);
    expect([...state.programs]).toEqual([[43, "C:\\Games\\b.exe"]]);
    expect(state.steamAppId).toBe(570);
    applyProbeLine(state, "s0");
    expect(state.steamAppId).toBeNull();
  });
});

describe("probeScript", () => {
  it("watches Tavora's own process and waits between looks", () => {
    const script = probeScript(1234);
    expect(script).toContain("GetProcessById(1234)");
    expect(script).toContain("Start-Sleep -Seconds 3");
    expect(script).toContain("RunningAppID");
  });
});

describe("GameWatcher", () => {
  const fakeChild = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), kill: vi.fn() });
    return child as unknown as ChildProcess & { stdout: PassThrough };
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("reports games already running as initial, and later changes as starts and closes", async () => {
    const library = emptyLibrary();
    addGame(library, { name: "Fortnite" }, day(1));
    addGame(library, { name: "Some Game", steamAppId: 570 }, day(1));
    const child = fakeChild();
    const changes: [string[], boolean][] = [];
    const watcher = new GameWatcher({
      entries: () => liveGames(library),
      findInstalled: async () => [FORTNITE],
      onChange: (running, initial) => changes.push([[...running], initial]),
      spawnProbe: () => child,
      platform: "win32",
    });
    watcher.start();
    child.stdout.write("+1\tD:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient.exe\ns0\n.\n");
    await flush();
    expect(changes).toEqual([[["local-fortnite"], true]]);
    child.stdout.write("s570\n.\n");
    await flush();
    child.stdout.write("-1\n.\n");
    await flush();
    expect(changes.slice(1)).toEqual([
      [["local-some-game", "local-fortnite"], false],
      [["local-some-game"], false],
    ]);
    watcher.stop();
    expect(child.kill).toHaveBeenCalled();
    expect(changes.at(-1)).toEqual([[], false]);
  });

  it("does nothing away from Windows", () => {
    const spawnProbe = vi.fn();
    const watcher = new GameWatcher({ entries: () => [], findInstalled: async () => [], onChange: () => undefined, spawnProbe, platform: "linux" });
    watcher.start();
    expect(watcher.active).toBe(false);
    expect(spawnProbe).not.toHaveBeenCalled();
  });
});
