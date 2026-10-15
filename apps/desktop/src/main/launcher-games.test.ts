import { describe, expect, it } from "vitest";
import {
  findInstalledGames,
  gamesFromEpic,
  gamesFromGog,
  gamesFromUninstall,
  matchInstalled,
  normalizeName,
  parseDisplayIcon,
  parseRegistry,
  type InstalledGame,
} from "./launcher-games";

/** What `reg query <key> /s` prints (taken from a real Battle.net PC): four spaces before names and between columns. */
const row = (name: string, value: string, type = "REG_SZ") => `    ${name}    ${type}    ${value}`;
const key = (name: string, ...rows: string[]) => [`HKEY_LOCAL_MACHINE\\SOFTWARE\\X\\Uninstall\\${name}`, ...rows, ""].join("\r\n");

const UNINSTALL = [
  key(
    "Diablo IV",
    row("DisplayName", "Diablo IV"),
    row("UninstallString", '"C:\\ProgramData\\Battle.net\\Agent\\Blizzard Uninstaller.exe" --lang=enUS --uid=fenris --displayname="Diablo IV"'),
    row("Publisher", "Blizzard Entertainment"),
    row("DisplayIcon", "G:\\Blizzard Games\\Diablo IV\\Diablo IV.exe"),
    row("InstallLocation", "G:\\Blizzard Games\\Diablo IV"),
  ),
  key("DirectDrawEx"),
  key(
    "StarCraft II",
    row("DisplayName", "StarCraft II"),
    row("Publisher", "Blizzard Entertainment"),
    row("DisplayIcon", "G:\\Blizzard Games\\StarCraft II\\Support\\SC2Switcher.exe"),
  ),
  key(
    "Apex",
    row("DisplayName", "Apex Legends"),
    row("Publisher", "Electronic Arts"),
    row("DisplayIcon", '"D:\\EA Games\\Apex\\r5apex.exe",1'),
  ),
  key("NoIcon", row("DisplayName", "Some Tool"), row("InstallLocation", "C:\\Tools")),
  key("Installer", row("DisplayName", "Some Installer"), row("DisplayIcon", "C:\\Windows\\Installer\\{ABC}\\icon.msi,0")),
  key("Relative", row("DisplayName", "Relative"), row("DisplayIcon", "..\\..\\evil.exe")),
].join("\r\n");

describe("parseRegistry", () => {
  it("reads each key's values by lower-case name, including empty ones", () => {
    const blocks = parseRegistry(
      `HKEY_A\\one\r\n    Name    REG_SZ    Some Game\r\n    Empty    REG_SZ    \r\n    Count    REG_DWORD    0x1\r\n\r\nHKEY_A\\two\r\n    Other    REG_SZ    x\r\n`,
    );
    expect(blocks).toEqual([{ name: "Some Game", empty: "", count: "0x1" }, { other: "x" }]);
  });

  it("ignores lines outside a key and lines that are not values", () => {
    expect(parseRegistry("    Orphan    REG_SZ    x\r\nsome text\r\n")).toEqual([]);
    expect(parseRegistry("")).toEqual([]);
  });
});

describe("parseDisplayIcon", () => {
  it.each([
    ["G:\\Games\\a.exe", "G:\\Games\\a.exe", 0],
    ['"G:\\Games\\a b.exe"', "G:\\Games\\a b.exe", 0],
    ['"G:\\Games\\a.exe",0', "G:\\Games\\a.exe", 0],
    ["G:\\Games\\a.exe,2", "G:\\Games\\a.exe", 2],
    ["G:\\Games\\a.exe,-101", "G:\\Games\\a.exe", -101],
    ['"G:\\Games\\a.exe", 3', "G:\\Games\\a.exe", 3],
    ["C:\\Program Files\\x\\icon.ICO", "C:\\Program Files\\x\\icon.ICO", 0],
  ])("reads %s", (value, file, index) => expect(parseDisplayIcon(value)).toEqual({ file, index }));

  it.each([undefined, "", "a.exe", "\\\\server\\share\\a.exe", "G:\\a.msi", "G:\\a.dll,0", "G:\\..\\a.exe", "G:\\Games\\a.exe\\..\\b.exe", "http://x/a.exe"])(
    "refuses %j",
    (value) => expect(parseDisplayIcon(value)).toBeNull(),
  );
});

describe("gamesFromUninstall", () => {
  const games = gamesFromUninstall(UNINSTALL);

  it("lists programs that have a name and an icon file, and marks Blizzard's as Battle.net", () => {
    expect(games).toEqual([
      { source: "battlenet", name: "Diablo IV", file: "G:\\Blizzard Games\\Diablo IV\\Diablo IV.exe", index: 0 },
      { source: "battlenet", name: "StarCraft II", file: "G:\\Blizzard Games\\StarCraft II\\Support\\SC2Switcher.exe", index: 0 },
      { source: "windows", name: "Apex Legends", file: "D:\\EA Games\\Apex\\r5apex.exe", index: 1 },
    ]);
  });
});

describe("gamesFromGog", () => {
  it("reads the game name and program of each GOG game", () => {
    const output = [
      key("1207658924", row("gameName", "Witcher Test"), row("exe", "D:\\GOG\\Witcher\\witcher.exe"), row("path", "D:\\GOG\\Witcher")),
      key("broken", row("gameName", "No Exe")),
    ].join("\r\n");
    expect(gamesFromGog(output)).toEqual([{ source: "gog", name: "Witcher Test", file: "D:\\GOG\\Witcher\\witcher.exe", index: 0 }]);
  });
});

describe("gamesFromEpic", () => {
  const item = (over: Record<string, unknown>) =>
    JSON.stringify({ DisplayName: "Fortnite", InstallLocation: "D:\\Epic\\Fortnite", LaunchExecutable: "FortniteGame\\Binaries\\Win64\\FortniteClient.exe", ...over });

  it("joins the install folder and the launch program of each manifest", () => {
    expect(gamesFromEpic([item({})])).toEqual([
      { source: "epic", name: "Fortnite", file: "D:\\Epic\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient.exe", index: 0 },
    ]);
  });

  it("skips manifests that are broken, incomplete or point outside the install folder", () => {
    expect(gamesFromEpic(["not json", item({ DisplayName: 5 }), item({ LaunchExecutable: "" }), item({ LaunchExecutable: "..\\..\\x.exe" }), item({ LaunchExecutable: "a.bat" })])).toEqual([]);
  });
});

describe("names", () => {
  it.each([
    ["Diablo® IV", "diablo4"],
    ["Diablo 4", "diablo4"],
    ["diablo  iv", "diablo4"],
    ["StarCraft II", "starcraft2"],
    ["StarCraft®: Remastered", "starcraftremastered"],
    ["The Witcher 3: Wild Hunt", "thewitcher3wildhunt"],
    ["Pokémon", "pokemon"],
    ["I", "i"],
    ["X", "x"],
    ["", ""],
  ])("%j is %j", (name, expected) => expect(normalizeName(name)).toBe(expected));

  const installed: InstalledGame[] = [
    { source: "windows", name: "Diablo IV", file: "C:\\a.exe", index: 0 },
    { source: "battlenet", name: "Diablo® IV", file: "G:\\d4.exe", index: 0 },
    { source: "gog", name: "Other Game", file: "D:\\o.exe", index: 0 },
    { source: "epic", name: "Other Game", file: "E:\\o.exe", index: 0 },
  ];

  it("finds the installed game with the same name, preferring Battle.net, then Epic, GOG and the rest", () => {
    expect(matchInstalled("Diablo 4", installed)?.file).toBe("G:\\d4.exe");
    expect(matchInstalled("Other Game", installed)?.file).toBe("E:\\o.exe");
  });

  it("finds nothing for a game that is not installed or for an empty name", () => {
    expect(matchInstalled("Hades II", installed)).toBeNull();
    expect(matchInstalled("", installed)).toBeNull();
    expect(matchInstalled("!!!", installed)).toBeNull();
  });
});

describe("findInstalledGames", () => {
  const reads: string[] = [];
  const queryRegistry = async (name: string) => {
    reads.push(name);
    if (name === "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall") return UNINSTALL;
    if (name === "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games") return key("1", row("gameName", "Witcher Test"), row("exe", "D:\\w.exe"));
    return null;
  };

  it("collects the installed programs, GOG's games and Epic's manifests, and reads nothing but those", async () => {
    const games = await findInstalledGames({
      platform: "win32",
      env: { ProgramData: "D:\\PD" },
      queryRegistry,
      readManifests: async (dir) => {
        reads.push(dir);
        return [JSON.stringify({ DisplayName: "Fortnite", InstallLocation: "D:\\E", LaunchExecutable: "f.exe" })];
      },
    });
    expect(games.map((g) => `${g.source}:${g.name}`).sort()).toEqual([
      "battlenet:Diablo IV",
      "battlenet:StarCraft II",
      "epic:Fortnite",
      "gog:Witcher Test",
      "windows:Apex Legends",
    ]);
    expect(reads.sort()).toEqual([
      "D:\\PD\\Epic\\EpicGamesLauncher\\Data\\Manifests",
      "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games",
      "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ]);
  });

  it("finds nothing off Windows, and nothing when no launcher has left anything", async () => {
    expect(await findInstalledGames({ platform: "linux", queryRegistry })).toEqual([]);
    expect(await findInstalledGames({ platform: "win32", queryRegistry: async () => null, readManifests: async () => [] })).toEqual([]);
  });
});
