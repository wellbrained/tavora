import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findInstalledGames,
  findSteamGames,
  gamesFromEpic,
  gamesFromGog,
  gamesFromUninstall,
  matchInstalled,
  normalizeName,
  parseAppManifest,
  parseDisplayIcon,
  parseLibraryFolders,
  parseRegistry,
  pickProgram,
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

describe("Steam games", () => {
  it("ignores trademark signs in names, and finds a Steam game by its id first", () => {
    expect(normalizeName("Battlefield\u2122 6")).toBe(normalizeName("Battlefield 6"));
    const installed: InstalledGame[] = [
      { source: "windows", name: "Another Name", file: "C:/a.exe", index: 0 },
      { source: "steam", name: "Battlefield\u2122 6", file: "G:/bf6.exe", index: 0, steamAppId: 2807960 },
    ];
    expect(matchInstalled("Battlefield 6", installed)?.file).toBe("G:/bf6.exe");
    expect(matchInstalled("Something else", installed, 2807960)?.file).toBe("G:/bf6.exe");
    expect(matchInstalled("Something else", installed, 1)).toBeNull();
  });

  it("reads the library folders and an app manifest, and refuses an install folder that is a path", () => {
    // The file doubles each backslash.
    const vdf = String.raw`"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
	}
	"1"
	{
		"path"		"G:\\Steam"
	}
}`;
    expect(parseLibraryFolders(vdf)).toEqual([String.raw`C:\Program Files (x86)\Steam`, String.raw`G:\Steam`]);
    const acf = (installdir: string) => `"AppState"\n{\n\t"appid"\t\t"2807960"\n\t"name"\t\t"Battlefield\u2122 6"\n\t"installdir"\t\t"${installdir}"\n}`;
    expect(parseAppManifest(acf("Battlefield 6"))).toEqual({ appid: 2807960, name: "Battlefield\u2122 6", installdir: "Battlefield 6" });
    expect(parseAppManifest(acf("..\\Windows"))).toBeNull();
    expect(parseAppManifest(acf(".."))).toBeNull();
    expect(parseAppManifest("{}")).toBeNull();
  });

  it("picks the largest program that is not an installer, a helper or a launcher", () => {
    expect(
      pickProgram([
        { name: "EAAntiCheat.Installer.exe", size: 278 },
        { name: "EAAntiCheat.GameServiceLauncher.exe", size: 19 },
        { name: "bf6.exe", size: 198 },
        { name: "readme.txt", size: 500 },
        { name: "small.exe", size: 5 },
      ]),
    ).toBe("bf6.exe");
    expect(pickProgram([{ name: "unins000.exe", size: 5 }])).toBeNull();
  });

  it("finds installed Steam games across the libraries, and skips a game whose folder is gone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "tavora-steam-"));
    const other = await mkdtemp(path.join(tmpdir(), "tavora-steam2-"));
    try {
      await mkdir(path.join(root, "steamapps"), { recursive: true });
      await mkdir(path.join(other, "steamapps", "common", "Battlefield 6"), { recursive: true });
      await writeFile(path.join(root, "steamapps", "libraryfolders.vdf"), `"libraryfolders"\n{\n\t"1"\n\t{\n\t\t"path"\t\t"${other.replaceAll("\\", "\\\\")}"\n\t}\n}`);
      await writeFile(path.join(other, "steamapps", "appmanifest_2807960.acf"), '"AppState"\n{\n\t"appid"\t\t"2807960"\n\t"name"\t\t"Battlefield\u2122 6"\n\t"installdir"\t\t"Battlefield 6"\n}');
      await writeFile(path.join(other, "steamapps", "common", "Battlefield 6", "bf6.exe"), "x".repeat(50));
      await writeFile(path.join(other, "steamapps", "common", "Battlefield 6", "EAAntiCheat.Installer.exe"), "x".repeat(500));
      await writeFile(path.join(root, "steamapps", "appmanifest_1.acf"), '"AppState"\n{\n\t"appid"\t\t"1"\n\t"name"\t\t"Gone"\n\t"installdir"\t\t"Gone"\n}');
      const games = await findSteamGames(root);
      expect(games.map((game) => [game.name, game.steamAppId, path.basename(game.file)])).toEqual([["Battlefield\u2122 6", 2807960, "bf6.exe"]]);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(other, { recursive: true, force: true });
    }
  });

  it("adds Steam's games to the installed games when a Steam folder is given", async () => {
    const steam: InstalledGame = { source: "steam", name: "Hades II", file: "G:/h2.exe", index: 0, steamAppId: 1145350 };
    const games = await findInstalledGames({
      platform: "win32",
      queryRegistry: async () => null,
      readManifests: async () => [],
      steamDir: "G:/Steam",
      readSteamGames: async (dir) => (dir === "G:/Steam" ? [steam] : []),
    });
    expect(games).toEqual([steam]);
    expect(await findInstalledGames({ platform: "win32", queryRegistry: async () => null, readManifests: async () => [], readSteamGames: async () => [steam] })).toEqual([]);
  });
});
