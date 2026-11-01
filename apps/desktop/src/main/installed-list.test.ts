import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GamesSeen } from "./games-seen";
import { activityOf, catalogIdFor, gameKey, parseTestInstalled, pickGames, sortPicked } from "./installed-list";
import { runningInstalled } from "./game-watch";
import { parseInstallDate, type InstalledGame } from "./launcher-games";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 1, 12);

const game = (name: string, extra: Partial<InstalledGame> = {}): InstalledGame => ({ source: "epic", name, file: `C:\\Games\\${name}\\a.exe`, index: 0, ...extra });
const signs = (steamPlayed: [number, number][] = [], seen: Record<string, number> = {}) => ({ steamPlayed: new Map(steamPlayed), seen });
const names = (games: { name: string }[]) => games.map((item) => item.name);

describe("activityOf", () => {
  it("prefers Steam's last play, in seconds", () => {
    const at = activityOf(game("Elden Ring", { steamAppId: 1245620, installedAt: NOW - 90 * DAY }), signs([[1245620, 1_761_000_000]]));
    expect(at).toEqual({ kind: "played", at: 1_761_000_000_000 });
  });

  it("uses the time Tavora saw the game running when Steam has none", () => {
    const item = game("Hades II");
    expect(activityOf(item, signs([], { [gameKey(item)]: NOW - DAY }))).toEqual({ kind: "played", at: NOW - DAY });
  });

  it("takes the later of Steam's play and the time Tavora saw it", () => {
    const item = game("Rust", { steamAppId: 252490 });
    expect(activityOf(item, signs([[252490, 1_700_000_000]], { [gameKey(item)]: 1_760_000_000_000 }))?.at).toBe(1_760_000_000_000);
  });

  it("falls back to the install date, and to nothing", () => {
    expect(activityOf(game("A", { installedAt: NOW - 5 * DAY }), signs())).toEqual({ kind: "installed", at: NOW - 5 * DAY });
    expect(activityOf(game("B"), signs())).toBeNull();
  });
});

describe("sort order", () => {
  it("lists plays newest first, then installs newest first, then the rest by name", () => {
    const sorted = sortPicked([
      { name: "Zeta", activity: null },
      { name: "Installed new", activity: { kind: "installed" as const, at: NOW } },
      { name: "Played long ago", activity: { kind: "played" as const, at: NOW - 400 * DAY } },
      { name: "Alpha", activity: null },
      { name: "Played yesterday", activity: { kind: "played" as const, at: NOW - DAY } },
      { name: "Installed old", activity: { kind: "installed" as const, at: NOW - 30 * DAY } },
    ]);
    expect(names(sorted)).toEqual(["Played yesterday", "Played long ago", "Installed new", "Installed old", "Alpha", "Zeta"]);
  });

  it("sorts the games of this PC with Steam's times, Tavora's sightings and install dates together", () => {
    const list = [
      game("Old install", { installedAt: NOW - 200 * DAY }),
      game("Steam played", { source: "steam", steamAppId: 100 }),
      game("Seen running", {}),
      game("Fresh install", { installedAt: NOW - DAY }),
    ];
    const picked = pickGames(list, signs([[100, Math.floor((NOW - 3 * DAY) / 1000)]], { [gameKey(list[2]!)]: NOW - DAY }));
    expect(names(picked)).toEqual(["Seen running", "Steam played", "Fresh install", "Old install"]);
  });
});

describe("pickGames", () => {
  it("leaves out Windows programs that are not a known game", () => {
    const picked = pickGames([game("Google Chrome", { source: "windows" }), game("Elden Ring", { source: "windows" }), game("Real Epic Game")], signs());
    expect(names(picked).sort()).toEqual(["Elden Ring", "Real Epic Game"]);
    expect(picked.find((item) => item.name === "Elden Ring")?.catalogId).toBe("elden-ring");
  });

  it("lists a game once when two launchers have it, keeping the earlier launcher's icon", () => {
    const picked = pickGames([game("Diablo® IV", { source: "windows" }), game("Diablo IV", { source: "battlenet" })], signs());
    expect(picked).toHaveLength(1);
    expect(picked[0]!.source.source).toBe("battlenet");
  });
});

describe("catalogIdFor", () => {
  it("finds a built-in game by Steam id, name or alias", () => {
    expect(catalogIdFor("Whatever", 1245620)).toBe("elden-ring");
    expect(catalogIdFor("Baldur's Gate 3")).toBe("baldurs-gate-3");
    expect(catalogIdFor("bg3")).toBe("baldurs-gate-3");
    expect(catalogIdFor("Unknown Indie")).toBeNull();
  });
});

describe("parseInstallDate", () => {
  it("reads Windows' YYYYMMDD", () => {
    expect(parseInstallDate("20250314")).toBe(Date.UTC(2025, 2, 14));
    expect(parseInstallDate("")).toBeUndefined();
    expect(parseInstallDate("2025-03-14")).toBeUndefined();
  });
});

describe("runningInstalled", () => {
  it("names the games running by Steam's id or by a program in their folder", () => {
    const steam = game("Rust", { source: "steam", steamAppId: 252490, folder: "C:\\Steam\\steamapps\\common\\Rust" });
    const epic = game("Fortnite", { folder: "C:\\Epic\\Fortnite" });
    const idle = game("Idle", { folder: "C:\\Epic\\Idle" });
    const running = runningInstalled([steam, epic, idle], ["c:\\epic\\fortnite\\bin\\game.exe"], 252490, gameKey);
    expect([...running].sort()).toEqual([gameKey(epic), gameKey(steam)].sort());
  });
});

describe("GamesSeen", () => {
  it("remembers sightings across restarts and writes a long run only now and then", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tavora-seen-"));
    try {
      const file = path.join(dir, "games-seen.json");
      let now = 1_000_000_000_000;
      const seen = new GamesSeen(file, () => now);
      await seen.running(["n:a"]);
      const first = await readFile(file, "utf8");
      now += 60_000;
      await seen.running(["n:a"]);
      expect(await readFile(file, "utf8")).toBe(first);
      now += 11 * 60_000;
      await seen.running(["n:a", "n:b"]);
      expect(await new GamesSeen(file).all()).toEqual({ "n:a": now, "n:b": now });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("parseTestInstalled", () => {
  it("reads a list of games and ignores bad input", () => {
    expect(parseTestInstalled(JSON.stringify([{ name: "A", steamAppId: 1 }, { nope: 1 }]))).toHaveLength(1);
    expect(parseTestInstalled("not json")).toEqual([]);
  });
});
