import { describe, expect, it } from "vitest";
import {
  addGame,
  createFolder,
  deleteFolder,
  deleteTrashedGame,
  emptyLibrary,
  LibraryError,
  markPlayed,
  monogram,
  moveFolder,
  moveGame,
  placeFavorite,
  purgeExpired,
  RAIL,
  recentGames,
  removeFavorite,
  renameGame,
  restoreGame,
  sanitizeLibrary,
  searchCatalog,
  setGameLabel,
  setRail,
  sortedRoot,
  trashGame,
  type Library,
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

  it("has online search on by default and keeps only a real setting", () => {
    expect(emptyLibrary().onlineSearch).toBe(true);
    expect(sanitizeLibrary({ onlineSearch: false }).onlineSearch).toBe(false);
    expect(sanitizeLibrary({ onlineSearch: "no" }).onlineSearch).toBe(true);
  });
});
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
