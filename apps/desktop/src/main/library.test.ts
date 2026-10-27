import { describe, expect, it } from "vitest";
import {
  addGame,
  iconFileShared,
  createFolder,
  deleteFolder,
  deleteTrashedGame,
  emptyLibrary,
  markIconOffered,
  gamesNeedingIcon,
  LibraryError,
  markIconShared,
  markPlayed,
  playedTimes,
  monogram,
  moveFolder,
  moveGame,
  placeFavorite,
  purgeExpired,
  RAIL,
  recentGames,
  recordIcon,
  removeFavorite,
  renameGame,
  restoreGame,
  sanitizeLibrary,
  searchCatalog,
  setGameLabel,
  setRail,
  sortedRoot,
  trashGame,
  useOriginalGameIcon,
  setGameImage,
  type Library,
  MAX_SITES,
  setSiteListed,
} from "./library";

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 12));

function libraryWith(...names: string[]): Library {
  const library = emptyLibrary();
  names.forEach((name, index) => addGame(library, { name }, day(1 + index)));
  return library;
}

const rootIds = (library: Library) => library.root.map((item) => `${item.kind}:${item.id}`);

describe("adding games", () => {
  it("adds a built-in game under its canonical id with an empty placement at the end", () => {
    const library = libraryWith("Custom One");
    expect(addGame(library, { catalogId: "poe2" }, day(3))).toBe("poe2");
    expect(library.games.poe2).toMatchObject({
      id: "poe2",
      catalogId: "poe2",
      name: "Path of Exile 2",
      icon: { kind: "monogram", text: "PE2" },
      trashedAt: null,
      lastPlayedAt: null,
    });
    expect(rootIds(library)).toEqual(["game:local-custom-one", "game:poe2"]);
  });

  it("gives custom games a path-safe local- id that never collides", () => {
    const library = emptyLibrary();
    expect(addGame(library, { name: "  My  Game!! " }, day(1))).toBe("local-my-game");
    expect(addGame(library, { name: "my game" }, day(1))).toBe("local-my-game-2");
    expect(addGame(library, { name: "日本語" }, day(1))).toBe("local-game");
    expect(addGame(library, { name: "x".repeat(80) }, day(1))).toMatch(/^local-x{48}$/);
    expect(library.games["local-my-game"]!.name).toBe("My Game!!");
  });

  it("refuses a built-in game that is already there, pointing at Trash when it is trashed", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "elden-ring" }, day(1));
    expect(() => addGame(library, { catalogId: "elden-ring" }, day(2))).toThrow("already in your library");
    trashGame(library, "elden-ring", day(2));
    expect(() => addGame(library, { catalogId: "elden-ring" }, day(3))).toThrow("is in Trash");
    expect(() => addGame(library, { catalogId: "not-a-game" }, day(3))).toThrow(LibraryError);
  });

  it.each([[""], ["   "], ["x".repeat(81)], [42]])("refuses the name %j", (name) => {
    expect(() => addGame(emptyLibrary(), { name } as { name: string }, day(1))).toThrow(LibraryError);
  });

  it("adds an online game under the service's id", () => {
    const library = emptyLibrary();
    const online = { id: "hades", name: " Hades  Remastered " };
    expect(addGame(library, { online }, day(1))).toBe("hades");
    expect(library.games.hades).toMatchObject({
      id: "hades",
      catalogId: null,
      name: "Hades Remastered",
      icon: { kind: "monogram", text: "HR" },
    });
    expect(rootIds(library)).toEqual(["game:hades"]);
  });

  it("treats a built-in game found online as that built-in game", () => {
    const library = emptyLibrary();
    addGame(library, { online: { id: "elden-ring", name: "ELDEN RING" } }, day(1));
    expect(library.games["elden-ring"]).toMatchObject({ catalogId: "elden-ring", name: "Elden Ring" });
  });

  it("refuses an online game that is already there, an unsafe id and a local- id", () => {
    const library = emptyLibrary();
    const online = { id: "doom-2016", name: "Doom" };
    addGame(library, { online }, day(1));
    expect(() => addGame(library, { online }, day(2))).toThrow("already in your library");
    trashGame(library, "doom-2016", day(2));
    expect(() => addGame(library, { online }, day(3))).toThrow("is in Trash");
    expect(() => addGame(library, { online: { ...online, id: "../x" } }, day(3))).toThrow(LibraryError);
    expect(() => addGame(library, { online: { id: "local-doom", name: "Doom" } }, day(3))).toThrow(LibraryError);
  });

  it("has automatic updates on by default and keeps only a real setting", () => {
    expect(emptyLibrary().autoUpdate).toBe(true);
    expect(emptyLibrary().autoUpdateModules).toBe(false);
    expect(sanitizeLibrary({ autoUpdateModules: true }).autoUpdateModules).toBe(true);
    expect(sanitizeLibrary({ autoUpdateModules: "yes" }).autoUpdateModules).toBe(false);
    expect(sanitizeLibrary({ autoUpdate: false }).autoUpdate).toBe(false);
    expect(sanitizeLibrary({ autoUpdate: "no" }).autoUpdate).toBe(true);
  });

  it("marks running games by default and keeps only a real choice", () => {
    expect(emptyLibrary().gameStart).toBe("show");
    expect(sanitizeLibrary({ gameStart: "ask" }).gameStart).toBe("ask");
    expect(sanitizeLibrary({ gameStart: "always" }).gameStart).toBe("show");
  });

  it("keeps the workspace to go back to only while it is a live personal workspace", () => {
    const library = emptyLibrary();
    const notes = addGame(library, { workspace: "Notes" }, day(1));
    addGame(library, { catalogId: "poe2" }, day(1));
    const saved = JSON.parse(JSON.stringify(library)) as Record<string, unknown>;
    expect(sanitizeLibrary({ ...saved, gameEndWorkspace: notes }).gameEndWorkspace).toBe(notes);
    expect(sanitizeLibrary({ ...saved, gameEndWorkspace: "poe2" }).gameEndWorkspace).toBeNull();
    expect(sanitizeLibrary({ ...saved, gameEndWorkspace: "gone" }).gameEndWorkspace).toBeNull();
    trashGame(library, notes, day(2));
    expect(sanitizeLibrary({ ...JSON.parse(JSON.stringify(library)), gameEndWorkspace: notes }).gameEndWorkspace).toBeNull();
  });

  it("has online search on by default and keeps only a real setting", () => {
    expect(emptyLibrary().onlineSearch).toBe(true);
    expect(sanitizeLibrary({ onlineSearch: false }).onlineSearch).toBe(false);
    expect(sanitizeLibrary({ onlineSearch: "no" }).onlineSearch).toBe(true);
  });
});
describe("personal workspaces", () => {
  it("adds a workspace by name, never linked to a built-in game", () => {
    const library = emptyLibrary();
    expect(addGame(library, { workspace: "Path of Exile 2" }, day(1))).toBe("local-path-of-exile-2");
    expect(library.games["local-path-of-exile-2"]).toMatchObject({
      kind: "workspace",
      catalogId: null,
      steamAppId: null,
      useOriginalIcon: false,
      showNews: false,
      icon: { kind: "monogram" },
    });
    expect(rootIds(library)).toEqual(["game:local-path-of-exile-2"]);
  });

  it("looks up no icon for a workspace and keeps it on letters", () => {
    const library = emptyLibrary();
    const id = addGame(library, { workspace: "Notes" }, day(1));
    addGame(library, { name: "Notes" }, day(1));
    expect(gamesNeedingIcon(library, day(2)).map((game) => game.id)).toEqual(["local-notes-2"]);
    useOriginalGameIcon(library, id);
    expect(library.games[id]!.useOriginalIcon).toBe(false);
  });

  it("keeps a workspace through saving, and never makes a built-in game one", () => {
    const library = emptyLibrary();
    const id = addGame(library, { workspace: "Personal" }, day(1));
    addGame(library, { catalogId: "poe2" }, day(1));
    const saved = JSON.parse(JSON.stringify(library));
    saved.games.poe2.kind = "workspace";
    saved.games[id].steamAppId = 570;
    const loaded = sanitizeLibrary(saved);
    expect(loaded.games[id]).toMatchObject({ kind: "workspace", steamAppId: null, catalogId: null });
    expect(loaded.games.poe2).toMatchObject({ kind: "game", catalogId: "poe2" });
  });
});

describe("Steam icons", () => {
  it("takes a game's Steam id from the built-in list, the service, or leaves it empty", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "elden-ring" }, day(1));
    addGame(library, { online: { id: "hades", name: "Hades", steamAppId: 1145360 } }, day(1));
    // The service had no appid for a built-in game: the built-in list's is used.
    addGame(library, { online: { id: "factorio", name: "Factorio", steamAppId: null } }, day(1));
    addGame(library, { online: { id: "obscure-game", name: "Obscure Game" } }, day(1));
    addGame(library, { name: "My Own Game" }, day(1));
    addGame(library, { catalogId: "fortnite" }, day(1));
    expect(Object.fromEntries(Object.values(library.games).map((game) => [game.id, game.steamAppId]))).toEqual({
      "elden-ring": 1245620,
      hades: 1145360,
      factorio: 427520,
      "obscure-game": null,
      "local-my-own-game": null,
      fortnite: null,
    });
    expect(library.games.hades).toMatchObject({ iconFile: null, iconCheckedAt: null });
  });

  it("ignores a service appid that is not a real Steam id", () => {
    const library = emptyLibrary();
    addGame(library, { online: { id: "odd-game", name: "Odd Game", steamAppId: -4 } }, day(1));
    expect(library.games["odd-game"]!.steamAppId).toBeNull();
  });

  it("starts on the default theme and keeps a saved theme even if it is not installed", () => {
    expect(emptyLibrary().theme).toEqual({ id: "tavora.default", variation: "dark" });
    expect(sanitizeLibrary({ theme: { id: "community.ash", variation: "dusk" } }).theme).toEqual({ id: "community.ash", variation: "dusk" });
    expect(sanitizeLibrary({ theme: { id: "../ash", variation: "dusk" } }).theme).toEqual({ id: "tavora.default", variation: "dark" });
    expect(sanitizeLibrary({ theme: "ash" }).theme).toEqual({ id: "tavora.default", variation: "dark" });
  });

  it("corrects the Steam id Diablo IV was once saved with, and looks for its icon again", () => {
    const saved = (steamAppId: number) => ({
      games: { "diablo-4": { id: "diablo-4", catalogId: "diablo-4", name: "Diablo IV", addedAt: "2026-10-14T23:17:34.035Z", steamAppId, iconFile: null, iconCheckedAt: "2026-10-15T12:14:18.118Z" } },
    });
    expect(sanitizeLibrary(saved(358090)).games["diablo-4"]).toMatchObject({ steamAppId: 2344520, iconCheckedAt: null });
    expect(sanitizeLibrary(saved(2344520)).games["diablo-4"]).toMatchObject({ steamAppId: 2344520, iconCheckedAt: "2026-10-15T12:14:18.118Z" });
  });

  it("has fetching on by default and keeps only a real setting", () => {
    expect(emptyLibrary().steamIcons).toBe(true);
    expect(sanitizeLibrary({ steamIcons: false }).steamIcons).toBe(false);
    expect(sanitizeLibrary({ steamIcons: "no" }).steamIcons).toBe(true);
    expect(emptyLibrary().moduleIcons).toBe(true);
    expect(sanitizeLibrary({ moduleIcons: false }).moduleIcons).toBe(false);
    expect(sanitizeLibrary({ moduleIcons: "no" }).moduleIcons).toBe(true);
    expect(emptyLibrary().moduleFilesFolder).toBeNull();
    const folder = process.platform === "win32" ? "D:\\Pictures\\Tavora module files" : "/mnt/pictures/Tavora module files";
    expect(sanitizeLibrary({ moduleFilesFolder: folder }).moduleFilesFolder).toBe(folder);
    for (const bad of ["relative/folder", "", 4, null, "x".repeat(501)]) expect(sanitizeLibrary({ moduleFilesFolder: bad }).moduleFilesFolder).toBeNull();
    // The folders file dialogs open in: absolute paths, for the dialogs Tavora has.
    expect(emptyLibrary().dialogFolders).toEqual({});
    expect(sanitizeLibrary({ dialogFolders: { "install-module": folder, "game-image": "relative/x", other: folder, "module-files": 4 } }).dialogFolders).toEqual({ "install-module": folder });
    // The folder each module's file dialogs open in (files.saveJson, files.openJson): per owner:module id, absolute paths.
    expect(emptyLibrary().moduleFolders).toEqual({});
    expect(sanitizeLibrary({ moduleFolders: { "wellbrained:planner": folder, "wellbrained:other": "relative/x", "no-owner": folder, "a:b": 4 } }).moduleFolders).toEqual({ "wellbrained:planner": folder });
    // Development folders: absolute paths, each once, at most 20.
    expect(emptyLibrary().developmentFolders).toEqual([]);
    const project = process.platform === "win32" ? "D:\\Code\\my-tracker" : "/home/dev/my-tracker";
    expect(sanitizeLibrary({ developmentFolders: [project, project, "relative/x", 7, "", "x".repeat(501)] }).developmentFolders).toEqual([project]);
    const many = Array.from({ length: 25 }, (_, i) => (process.platform === "win32" ? `D:\\Code\\m${i}` : `/code/m${i}`));
    expect(sanitizeLibrary({ developmentFolders: many }).developmentFolders).toHaveLength(20);
    expect(sanitizeLibrary({ developmentFolders: "nope" }).developmentFolders).toEqual([]);
    expect(emptyLibrary().steamProfile).toBeNull();
    expect(sanitizeLibrary({ steamProfile: "  https://steamcommunity.com/id/me " }).steamProfile).toBe("https://steamcommunity.com/id/me");
    for (const bad of ["", "   ", 5, "x".repeat(201)]) expect(sanitizeLibrary({ steamProfile: bad }).steamProfile).toBeNull();
    // Icons offered for games not in the library: known ids, each once.
    expect(emptyLibrary().iconsOffered).toEqual([]);
    expect(sanitizeLibrary({ iconsOffered: ["elden-ring", "elden-ring", "local-x", "../x", 5] }).iconsOffered).toEqual(["elden-ring"]);
    const offered = emptyLibrary();
    markIconOffered(offered, "a");
    markIconOffered(offered, "b");
    markIconOffered(offered, "a");
    expect(offered.iconsOffered).toEqual(["b", "a"]);
  });

  it("asks for every game that has no icon, and not again soon after a miss", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "elden-ring" }, day(1));
    addGame(library, { catalogId: "fortnite" }, day(1));
    addGame(library, { name: "My Own Game" }, day(1));
    expect(gamesNeedingIcon(library, day(2)).map((game) => game.id)).toEqual(["elden-ring", "fortnite", "local-my-own-game"]);

    recordIcon(library, "elden-ring", { none: day(2) });
    recordIcon(library, "local-my-own-game", { none: day(2) });
    expect(gamesNeedingIcon(library, day(3)).map((game) => game.id)).toEqual(["fortnite"]);
    expect(gamesNeedingIcon(library, new Date(Date.UTC(2026, 11, 1))).map((game) => game.id)).toEqual([
      "elden-ring",
      "fortnite",
      "local-my-own-game",
    ]);
  });

  it("does not ask for games in Trash", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "elden-ring" }, day(1));
    trashGame(library, "elden-ring", day(2));
    expect(gamesNeedingIcon(library, day(3))).toEqual([]);
  });

  it("records a saved icon, and refuses a file that does not belong to the game", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "elden-ring" }, day(1));
    recordIcon(library, "elden-ring", { file: "999.ico" });
    expect(library.games["elden-ring"]!.iconFile).toBeNull();
    recordIcon(library, "elden-ring", { file: "1245620.ico" });
    expect(library.games["elden-ring"]).toMatchObject({ iconFile: "1245620.ico", iconCheckedAt: null });
    expect(gamesNeedingIcon(library, day(2))).toEqual([]);
    recordIcon(library, "no-such-game", { file: "1.ico" });
  });

  it("records an icon read from the installed game, and the small Steam icon, but only under the game's own names", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "elden-ring" }, day(1));
    addGame(library, { name: "My Own Game" }, day(1));
    recordIcon(library, "elden-ring", { file: "exe-someone-else.ico" });
    recordIcon(library, "local-my-own-game", { file: "1245620.ico" });
    expect(library.games["elden-ring"]!.iconFile).toBeNull();
    expect(library.games["local-my-own-game"]!.iconFile).toBeNull();

    recordIcon(library, "elden-ring", { file: "1245620.jpg" });
    expect(library.games["elden-ring"]!.iconFile).toBe("1245620.jpg");
    recordIcon(library, "local-my-own-game", { file: "exe-local-my-own-game.ico" });
    expect(library.games["local-my-own-game"]).toMatchObject({ iconFile: "exe-local-my-own-game.ico", iconCheckedAt: null });
    recordIcon(library, "local-my-own-game", { file: "hosted-elden-ring.png" });
    expect(library.games["local-my-own-game"]!.iconFile).toBe("exe-local-my-own-game.ico");
    recordIcon(library, "elden-ring", { file: "hosted-elden-ring.png" });
    expect(library.games["elden-ring"]!.iconFile).toBe("hosted-elden-ring.png");
  });

  it("knows when another game shares an icon file", () => {
    const library = emptyLibrary();
    addGame(library, { catalogId: "elden-ring" }, day(1));
    addGame(library, { online: { id: "elden-ring-again", name: "Elden Ring Again", steamAppId: 1245620 } }, day(1));
    recordIcon(library, "elden-ring", { file: "1245620.ico" });
    recordIcon(library, "elden-ring-again", { file: "1245620.ico" });
    expect(iconFileShared(library, "1245620.ico", "elden-ring")).toBe(true);
    deleteTrashedGame(trashed(library, "elden-ring-again"), "elden-ring-again");
    expect(iconFileShared(library, "1245620.ico", "elden-ring")).toBe(false);
  });

  it("loads icons from a saved library, gives old games their Steam id and drops a forged file name", () => {
    const saved = (extra: Record<string, unknown>) => ({
      games: {
        "elden-ring": {
          id: "elden-ring",
          catalogId: "elden-ring",
          name: "Elden Ring",
          icon: { kind: "monogram", text: "ER" },
          showNews: true,
          addedAt: "2026-10-01T10:00:00.000Z",
          lastPlayedAt: null,
          trashedAt: null,
          ...extra,
        },
      },
    });
    // Saved before Steam icons existed: the built-in list supplies the Steam id.
    expect(sanitizeLibrary(saved({})).games["elden-ring"]).toMatchObject({ steamAppId: 1245620, iconFile: null, iconCheckedAt: null });
    expect(sanitizeLibrary(saved({ steamAppId: 1245620, iconFile: "1245620.ico" })).games["elden-ring"]!.iconFile).toBe("1245620.ico");
    expect(sanitizeLibrary(saved({ steamAppId: 1245620, iconFile: "1245620.jpg" })).games["elden-ring"]!.iconFile).toBe("1245620.jpg");
    expect(sanitizeLibrary(saved({ iconFile: "exe-elden-ring.ico" })).games["elden-ring"]!.iconFile).toBe("exe-elden-ring.ico");
    expect(sanitizeLibrary(saved({ iconFile: "hosted-elden-ring.png" })).games["elden-ring"]!.iconFile).toBe("hosted-elden-ring.png");
    for (const iconFile of ["../1245620.ico", "999.ico", "1245620.png", "exe-other.ico", "hosted-other.png", "hosted-../elden-ring.png", "exe-../elden-ring.ico", 7, null]) {
      expect(sanitizeLibrary(saved({ steamAppId: 1245620, iconFile })).games["elden-ring"]!.iconFile).toBeNull();
    }
    expect(sanitizeLibrary(saved({ steamAppId: "5" })).games["elden-ring"]!.steamAppId).toBe(1245620);
    expect(sanitizeLibrary(saved({ iconCheckedAt: "yesterday" })).games["elden-ring"]!.iconCheckedAt).toBeNull();
    expect(sanitizeLibrary(saved({ iconCheckedAt: "2026-10-02T10:00:00.000Z" })).games["elden-ring"]!.iconCheckedAt).toBe("2026-10-02T10:00:00.000Z");
  });
});

/** Puts a game in Trash so it can be deleted for good, and returns the library. */
function trashed(library: Library, id: string): Library {
  trashGame(library, id, day(5));
  return library;
}

describe("monogram", () => {
  it.each([
    ["Path of Exile 2", "PE2"],
    ["Satisfactory", "SAT"],
    ["The Witcher 3: Wild Hunt", "TW3"],
    ["Baldur's Gate 3", "BG3"],
    ["Ōkami", "OKA"],
    ["!!!", "?"],
  ])("%s → %s", (name, expected) => expect(monogram(name)).toBe(expected));
});

describe("renaming and labels", () => {
  it("changes the display name, never the id", () => {
    const library = libraryWith("Old");
    renameGame(library, "local-old", "New name");
    expect(library.games["local-old"]!.name).toBe("New name");
    expect(() => renameGame(library, "local-old", " ")).toThrow(LibraryError);
  });

  it("sets and resets the monogram", () => {
    const library = libraryWith("Hollow Knight");
    setGameLabel(library, "local-hollow-knight", "HK");
    expect(library.games["local-hollow-knight"]!.icon).toEqual({ kind: "monogram", text: "HK" });
    setGameLabel(library, "local-hollow-knight", null);
    expect(library.games["local-hollow-knight"]!.icon).toEqual({ kind: "monogram", text: "HK" });
    expect(() => setGameLabel(library, "local-hollow-knight", "LONG")).toThrow(LibraryError);
  });
});

describe("Trash", () => {
  it("takes a game out of the rail and favorites, and restores it at the end", () => {
    const library = libraryWith("A", "B", "C");
    placeFavorite(library, "local-a");
    markPlayed(library, "local-a", day(5));
    trashGame(library, "local-a", day(6));
    expect(rootIds(library)).toEqual(["game:local-b", "game:local-c"]);
    expect(library.favorites).toEqual([]);
    expect(library.lastGameId).toBeNull();
    expect(() => markPlayed(library, "local-a", day(7))).toThrow(LibraryError);

    restoreGame(library, "local-a");
    expect(rootIds(library)).toEqual(["game:local-b", "game:local-c", "game:local-a"]);
    expect(library.games["local-a"]!.trashedAt).toBeNull();
  });

  it("purges games after 30 days, not before", () => {
    const library = libraryWith("A", "B");
    trashGame(library, "local-a", day(1));
    trashGame(library, "local-b", day(10));
    expect(purgeExpired(library, new Date(Date.UTC(2026, 9, 31, 11)))).toEqual([]);
    expect(purgeExpired(library, new Date(Date.UTC(2026, 9, 31, 12))).map((game) => game.id)).toEqual(["local-a"]);
    expect(library.games["local-a"]).toBeUndefined();
    expect(library.games["local-b"]).toBeDefined();
  });

  it("deletes a trashed game on request, and only a trashed one", () => {
    const library = libraryWith("A");
    expect(() => deleteTrashedGame(library, "local-a")).toThrow(LibraryError);
    trashGame(library, "local-a", day(2));
    expect(deleteTrashedGame(library, "local-a").id).toBe("local-a");
    expect(library.games).toEqual({});
  });
});

describe("favorites", () => {
  it("are ordered shortcuts; the game keeps its own place", () => {
    const library = libraryWith("A", "B", "C");
    placeFavorite(library, "local-c");
    placeFavorite(library, "local-a", 0);
    expect(library.favorites).toEqual(["local-a", "local-c"]);
    placeFavorite(library, "local-a", 5);
    expect(library.favorites).toEqual(["local-c", "local-a"]);
    expect(rootIds(library)).toEqual(["game:local-a", "game:local-b", "game:local-c"]);
    removeFavorite(library, "local-c");
    expect(library.favorites).toEqual(["local-a"]);
  });

  it("stay favorites when the game moves", () => {
    const library = libraryWith("A", "B");
    placeFavorite(library, "local-b");
    placeFavorite(library, "local-a");
    const folderId = createFolder(library, "ARPGs", ["local-b"]);
    expect(library.favorites).toEqual(["local-b", "local-a"]);
    expect(library.folders[folderId]!.games).toEqual(["local-b"]);
  });
});

describe("folders and placement", () => {
  it("creates a folder where its first game was and moves games in", () => {
    const library = libraryWith("A", "B", "C");
    const id = createFolder(library, "Survival", ["local-b", "local-c"]);
    expect(rootIds(library)).toEqual(["game:local-a", `folder:${id}`]);
    expect(library.folders[id]).toMatchObject({ name: "Survival", games: ["local-b", "local-c"] });
  });

  it("keeps each game in exactly one place", () => {
    const library = libraryWith("A", "B");
    const one = createFolder(library, "One", ["local-a"]);
    const two = createFolder(library, "Two");
    moveGame(library, "local-a", { folderId: two });
    expect(library.folders[one]!.games).toEqual([]);
    expect(library.folders[two]!.games).toEqual(["local-a"]);
    moveGame(library, "local-a", { folderId: null, index: 0 });
    expect(rootIds(library)).toEqual(["game:local-a", `folder:${one}`, "game:local-b", `folder:${two}`]);
    expect(library.folders[two]!.games).toEqual([]);
  });

  it("reorders within a list", () => {
    const library = libraryWith("A", "B", "C");
    moveGame(library, "local-a", { folderId: null, index: 2 });
    expect(rootIds(library)).toEqual(["game:local-b", "game:local-c", "game:local-a"]);
    const id = createFolder(library, "F");
    moveFolder(library, id, 0);
    expect(rootIds(library)[0]).toBe(`folder:${id}`);
  });

  it("returns a deleted folder's games to its place without touching them", () => {
    const library = libraryWith("A", "B", "C");
    const id = createFolder(library, "F", ["local-b", "local-c"]);
    deleteFolder(library, id);
    expect(rootIds(library)).toEqual(["game:local-a", "game:local-b", "game:local-c"]);
    expect(Object.keys(library.games)).toHaveLength(3);
  });
});

describe("sorting", () => {
  it("sorts the top level by most recently played, folders by their latest game", () => {
    const library = libraryWith("A", "B", "C", "D");
    const folder = createFolder(library, "F", ["local-c", "local-d"]);
    markPlayed(library, "local-a", day(10));
    markPlayed(library, "local-d", day(12));
    expect(sortedRoot(library).map((item) => item.id)).toEqual([folder, "local-a", "local-b"]);
    library.sort = "manual";
    expect(sortedRoot(library).map((item) => item.id)).toEqual(["local-a", "local-b", folder]);
  });

  it("keeps the order from startup when a game is played mid-session", () => {
    const library = libraryWith("A", "B", "C");
    markPlayed(library, "local-a", day(10));
    const atStart = playedTimes(library);
    markPlayed(library, "local-c", day(11));
    expect(sortedRoot(library, atStart).map((item) => item.id)).toEqual(["local-a", "local-b", "local-c"]);
    // The next start sorts by the new times.
    expect(sortedRoot(library, playedTimes(library)).map((item) => item.id)).toEqual(["local-c", "local-a", "local-b"]);
  });

  it("lists recent games for the Welcome page", () => {
    const library = libraryWith("A", "B", "C");
    markPlayed(library, "local-b", day(10));
    expect(recentGames(library, 2).map((game) => game.id)).toEqual(["local-b", "local-c"]);
  });
});

describe("catalog search", () => {
  it("matches names and aliases and hides games already in the library", () => {
    const library = emptyLibrary();
    expect(searchCatalog(library, "poe").map((game) => game.id)).toEqual(["path-of-exile", "poe2"]);
    addGame(library, { catalogId: "poe2" }, day(1));
    expect(searchCatalog(library, "path").map((game) => game.id)).toEqual(["path-of-exile"]);
    expect(searchCatalog(library, "witcher").map((game) => game.id)).toEqual(["the-witcher-3"]);
    expect(searchCatalog(library, "zzzz")).toEqual([]);
  });
});

describe("rail", () => {
  it("clamps the width to the allowed range", () => {
    const library = emptyLibrary();
    setRail(library, { width: 10, expanded: true });
    expect(library.rail).toEqual({ expanded: true, width: RAIL.minWidth });
    setRail(library, { width: 9999 });
    expect(library.rail.width).toBe(RAIL.maxWidth);
    setRail(library, { width: Number.NaN, expanded: "yes" });
    expect(library.rail).toEqual({ expanded: true, width: RAIL.maxWidth });
  });
});

describe("sanitizeLibrary", () => {
  it("round-trips a valid library", () => {
    const library = libraryWith("A", "B", "C");
    createFolder(library, "F", ["local-c"]);
    placeFavorite(library, "local-b");
    trashGame(library, "local-a", day(9));
    expect(sanitizeLibrary(JSON.parse(JSON.stringify(library)))).toEqual(library);
  });

  it("drops broken entries and places every live game exactly once", () => {
    const library = sanitizeLibrary({
      games: {
        a: { id: "a", name: "A", addedAt: "2026-10-01T00:00:00.000Z", icon: { kind: "image", file: "../x.png" } },
        b: { id: "b", name: "B", addedAt: "2026-10-02T00:00:00.000Z" },
        bad: { id: "../bad", name: "Bad", addedAt: "2026-10-01T00:00:00.000Z" },
        noname: { id: "noname", name: " ", addedAt: "2026-10-01T00:00:00.000Z" },
        t: { id: "t", name: "T", addedAt: "2026-10-01T00:00:00.000Z", trashedAt: "2026-10-05T00:00:00.000Z" },
      },
      folders: { f: { id: "f", name: "F", games: ["a", "a", "t", "ghost"] } },
      root: [{ kind: "folder", id: "f" }, { kind: "game", id: "a" }, { kind: "game", id: "t" }, "junk"],
      favorites: ["b", "b", "t", "ghost"],
      sort: "bogus",
      rail: { width: 5 },
      lastGameId: "t",
    });
    expect(Object.keys(library.games).sort()).toEqual(["a", "b", "t"]);
    expect(library.games.a!.icon).toEqual({ kind: "monogram", text: "A" });
    expect(library.folders.f!.games).toEqual(["a"]);
    expect(rootIds(library)).toEqual(["folder:f", "game:b"]);
    expect(library.favorites).toEqual(["b"]);
    expect(library.sort).toBe("recent");
    expect(library.rail.width).toBe(RAIL.minWidth);
    expect(library.lastGameId).toBeNull();
  });

  it("gives an empty library for anything else", () => {
    expect(sanitizeLibrary(null)).toEqual(emptyLibrary());
    expect(sanitizeLibrary("x")).toEqual(emptyLibrary());
  });
});


describe("which icon a game shows", () => {
  const picked = (library: Library, id: string) => setGameImage(library, id, "pick.png");

  it("starts with the game's own icon", () => {
    const library = libraryWith("Diablo IV");
    expect(library.games["local-diablo-iv"]).toMatchObject({ useOriginalIcon: true, iconSharedAt: null });
  });

  it("stops showing the game's own icon when the user chooses letters, so their letters are what shows", () => {
    const library = libraryWith("Diablo IV");
    setGameLabel(library, "local-diablo-iv", "D4");
    expect(library.games["local-diablo-iv"]).toMatchObject({ icon: { kind: "monogram", text: "D4" }, useOriginalIcon: false });
    setGameLabel(library, "local-diablo-iv", null);
    expect(library.games["local-diablo-iv"]).toMatchObject({ icon: { kind: "monogram", text: "DI" }, useOriginalIcon: false });
  });

  it("goes back to the game's own icon from letters or from a picked image, and returns what was replaced", () => {
    const library = libraryWith("Diablo IV");
    setGameLabel(library, "local-diablo-iv", "D4");
    expect(useOriginalGameIcon(library, "local-diablo-iv")).toEqual({ kind: "monogram", text: "D4" });
    expect(library.games["local-diablo-iv"]).toMatchObject({ icon: { kind: "monogram", text: "DI" }, useOriginalIcon: true });

    picked(library, "local-diablo-iv");
    expect(useOriginalGameIcon(library, "local-diablo-iv")).toEqual({ kind: "image", file: "pick.png" });
    expect(library.games["local-diablo-iv"]).toMatchObject({ icon: { kind: "monogram", text: "DI" }, useOriginalIcon: true });
  });

  it("keeps the choice of letters when an image is picked and then dropped for letters again", () => {
    const library = libraryWith("Diablo IV");
    setGameLabel(library, "local-diablo-iv", "D4");
    picked(library, "local-diablo-iv");
    expect(library.games["local-diablo-iv"]!.icon.kind).toBe("image");
    setGameLabel(library, "local-diablo-iv", "XY");
    expect(library.games["local-diablo-iv"]).toMatchObject({ icon: { kind: "monogram", text: "XY" }, useOriginalIcon: false });
  });

  it("refuses a game that is not there", () => {
    const library = libraryWith("Diablo IV");
    expect(() => useOriginalGameIcon(library, "nope")).toThrow(LibraryError);
  });

  it("notes that an icon was offered, once per game, and ignores a game that is gone", () => {
    const library = libraryWith("Diablo IV");
    markIconShared(library, "local-diablo-iv", day(5));
    expect(library.games["local-diablo-iv"]!.iconSharedAt).toBe(day(5).toISOString());
    markIconShared(library, "nope", day(5));
  });

  it("loads the choice and the offer from a saved library, with the original icon as the default", () => {
    const saved = (extra: Record<string, unknown>) => ({
      games: {
        "elden-ring": {
          id: "elden-ring",
          catalogId: "elden-ring",
          name: "Elden Ring",
          icon: { kind: "monogram", text: "ER" },
          showNews: true,
          addedAt: "2026-10-01T10:00:00.000Z",
          lastPlayedAt: null,
          trashedAt: null,
          ...extra,
        },
      },
    });
    const game = (extra: Record<string, unknown>) => sanitizeLibrary(saved(extra)).games["elden-ring"]!;
    expect(game({})).toMatchObject({ useOriginalIcon: true, iconSharedAt: null });
    expect(game({ useOriginalIcon: false })).toMatchObject({ useOriginalIcon: false });
    expect(game({ useOriginalIcon: "no" }).useOriginalIcon).toBe(true);
    expect(game({ iconSharedAt: "2026-10-02T10:00:00.000Z" }).iconSharedAt).toBe("2026-10-02T10:00:00.000Z");
    expect(game({ iconSharedAt: "yesterday" }).iconSharedAt).toBeNull();
    expect(game({ iconSharedAt: 5 }).iconSharedAt).toBeNull();
  });
});
describe("Browser sites", () => {
  it("keeps only valid, unique sites when read back", () => {
    const library = sanitizeLibrary({
      browser: { sharedSites: ["google.com", "google.com", "accounts.google.com", "a b", 5, "localhost"], adblockOff: "fandom.com" },
    });
    expect(library.browser).toEqual({ sharedSites: ["google.com", "localhost"], adblockOff: [] });
    expect(sanitizeLibrary({}).browser).toEqual({ sharedSites: [], adblockOff: [] });
  });

  it("adds and removes sites, up to the limit", () => {
    const library = sanitizeLibrary({});
    setSiteListed(library, "sharedSites", "google.com", true);
    setSiteListed(library, "sharedSites", "google.com", true);
    expect(library.browser.sharedSites).toEqual(["google.com"]);
    setSiteListed(library, "sharedSites", "google.com", false);
    expect(library.browser.sharedSites).toEqual([]);
    library.browser.adblockOff = Array.from({ length: MAX_SITES }, (_, i) => `site${i}.com`);
    expect(() => setSiteListed(library, "adblockOff", "one-more.com", true)).toThrow(LibraryError);
  });
});
