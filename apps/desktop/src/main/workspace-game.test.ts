import { describe, expect, it } from "vitest";
import { addOrRestoreWorkspace } from "./game-copy";
import { addWorkspace, emptyLibrary, sanitizeLibrary, type Library } from "./library";
import { isForWorkspaceGame, learnGameIds, workspaceGameIds, type ListedGame } from "./workspace-game";

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));
/** A module for 9 Kings, as the catalog lists its game. */
const MODULE_GAMES = ["9-kings"];
const LISTED: ListedGame[] = [{ id: "9-kings", name: "9 Kings", steamAppId: 2784470 }];
const fits = (library: Library, id: string) => isForWorkspaceGame(MODULE_GAMES, library.workspaces[id]!);
/** The library as the next start reads it back. */
const reloaded = (library: Library) => sanitizeLibrary(JSON.parse(JSON.stringify(library)));

describe("which game a workspace is, whichever way it was added", () => {
  // Every way the app adds a game workspace, as add-workspace receives it.
  const ways = {
    "picked online (Add a game, Ctrl+K, the welcome)": { online: { id: "9-kings", name: "9 Kings", steamAppId: 2784470 } },
    "the running game's Add button": { name: "9 Kings", steamAppId: 2784470 },
    "a Steam import the service didn't know": { name: "Nine Kings", steamAppId: 2784470 },
    "the search's own typed name, with the game on this PC": { name: "9 Kings®", steamAppId: 2784470 },
  } as const;

  for (const [way, input] of Object.entries(ways)) {
    it(`takes modules made for its game once the catalog was read: ${way}`, () => {
      const library = emptyLibrary();
      const { id } = addOrRestoreWorkspace(library, input, day(1));
      learnGameIds(library, LISTED);
      expect(fits(library, id)).toBe(true);
      // And still after a restart, before the catalog is read again: installed modules stay in their workspace.
      expect(fits(reloaded(library), id)).toBe(true);
    });
  }

  it("is the built-in game it was picked as", () => {
    const library = emptyLibrary();
    const id = addWorkspace(library, { catalogId: "elden-ring" }, day(1));
    expect(workspaceGameIds(library.workspaces[id]!)).toEqual(["elden-ring"]);
    expect(isForWorkspaceGame(["elden-ring"], library.workspaces[id]!)).toBe(true);
  });

  it("learns the game when the same game is added again online, without a catalog listing", () => {
    const library = emptyLibrary();
    const id = addWorkspace(library, { name: "9 Kings", steamAppId: 2784470 }, day(1));
    expect(fits(library, id)).toBe(false);
    expect(addOrRestoreWorkspace(library, { online: { id: "9-kings", name: "9 Kings", steamAppId: 2784470 } }, day(2))).toEqual({ id, existing: true, learned: true });
    expect(library.workspaces[id]!.gameId).toBe("9-kings");
    expect(fits(library, id)).toBe(true);
    // Found by the id it learned from then on, whatever its name.
    library.workspaces[id]!.name = "My kingdom";
    library.workspaces[id]!.steamAppId = null;
    expect(addOrRestoreWorkspace(library, { online: { id: "9-kings", name: "9 Kings" } }, day(3))).toEqual({ id, existing: true });
  });

  it("learns only from one listed game per Steam id, and never a made-up or PC id", () => {
    const library = emptyLibrary();
    const id = addWorkspace(library, { name: "9 Kings", steamAppId: 2784470 }, day(1));
    expect(learnGameIds(library, [...LISTED, { id: "nine-kings", name: "Nine Kings", steamAppId: 2784470 }])).toEqual([]);
    expect(learnGameIds(library, [{ id: "local-9-kings", name: "9 Kings", steamAppId: 2784470 }])).toEqual([]);
    expect(learnGameIds(library, [{ id: "9-kings", name: "9 Kings", steamAppId: 1 }])).toEqual([]);
    // The same game listed by two modules is one game.
    expect(learnGameIds(library, [...LISTED, ...LISTED])).toEqual([id]);
    // Known already: nothing changes.
    expect(learnGameIds(library, LISTED)).toEqual([]);
    // The service's game list is where ids come from: a listing that says otherwise corrects it.
    expect(learnGameIds(library, [{ id: "nine-kings", name: "Nine Kings", steamAppId: 2784470 }])).toEqual([id]);
    expect(library.workspaces[id]!.gameId).toBe("nine-kings");
  });

  it("leaves a game without a Steam id, a game picked online and a personal workspace as they are", () => {
    const library = emptyLibrary();
    const byName = addWorkspace(library, { name: "9 Kings" }, day(1));
    const online = addWorkspace(library, { online: { id: "hades", name: "Hades", steamAppId: 1145360 } }, day(1));
    const personal = addWorkspace(library, { personal: "Notes" }, day(1));
    library.workspaces[personal]!.steamAppId = 2784470;
    expect(learnGameIds(library, [...LISTED, { id: "hades-2", name: "Hades II", steamAppId: 1145360 }])).toEqual([]);
    expect(fits(library, byName)).toBe(false);
    expect(workspaceGameIds(library.workspaces[online]!)).toEqual(["hades"]);
    expect(workspaceGameIds(library.workspaces[personal]!)).toEqual([]);
  });

  it("reads a learned id back only on a game added by name, and only one from Tavora's game list", () => {
    const library = emptyLibrary();
    const byName = addWorkspace(library, { name: "9 Kings", steamAppId: 2784470 }, day(1));
    const online = addWorkspace(library, { online: { id: "hades", name: "Hades" } }, day(1));
    const saved = JSON.parse(JSON.stringify(library)) as { workspaces: Record<string, { gameId: unknown }> };
    saved.workspaces[online]!.gameId = "9-kings";
    saved.workspaces[byName]!.gameId = "local-other";
    const read = sanitizeLibrary(saved);
    expect(read.workspaces[online]!.gameId).toBeNull();
    expect(read.workspaces[byName]!.gameId).toBeNull();
    saved.workspaces[byName]!.gameId = "9-kings";
    expect(sanitizeLibrary(saved).workspaces[byName]!.gameId).toBe("9-kings");
    // A library saved before the field reads as not known yet.
    delete (saved.workspaces[byName] as { gameId?: unknown }).gameId;
    expect(sanitizeLibrary(saved).workspaces[byName]!.gameId).toBeNull();
  });
});
