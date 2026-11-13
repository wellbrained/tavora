import { describe, expect, it } from "vitest";
import { addOrRestoreWorkspace } from "./game-copy";
import { addWorkspace, emptyLibrary, sanitizeLibrary, type Library } from "./library";
import { isForWorkspaceGame, learnGameIds, withOnlineId, workspaceGameIds, type ListedGame } from "./workspace-game";

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
    // Listed twice by its module list, still one game:
    // The same game listed by two modules is one game, with what either knows about it.
    expect(learnGameIds(library, [{ id: "9-kings", name: null, steamAppId: null }, ...LISTED])).toEqual([id]);
    // Known already: nothing changes.
    expect(learnGameIds(library, LISTED)).toEqual([]);
    // The service's game list is where ids come from: a listing that says otherwise corrects it.
    expect(learnGameIds(library, [{ id: "nine-kings", name: "Nine Kings", steamAppId: 2784470 }])).toEqual([id]);
    expect(library.workspaces[id]!.gameId).toBe("nine-kings");
  });

  it("learns a game without a Steam id by its name, as every copy of a game is found, when one listed game has it", () => {
    const library = emptyLibrary();
    // Typed by hand, added offline, or an Epic, Battle.net or Xbox game: only its name.
    const byName = addWorkspace(library, { name: "9 Kings™" }, day(1));
    const other = addWorkspace(library, { name: "Doom" }, day(1));
    expect(learnGameIds(library, [...LISTED, { id: "doom", name: "DOOM", steamAppId: 379720 }, { id: "doom-1993", name: "Doom", steamAppId: 2280 }])).toEqual([byName]);
    expect(fits(library, byName)).toBe(true);
    // Two listed games of that name: not sure which, so neither.
    expect(library.workspaces[other]!.gameId).toBeNull();
    // With a Steam id on both sides, only the Steam id decides: a game of the same name with another id is another game.
    const demo = addWorkspace(library, { name: "9 Kings", steamAppId: 1 }, day(2));
    learnGameIds(library, LISTED);
    expect(library.workspaces[demo]!.gameId).toBeNull();
    // A game with a Steam id goes by it alone, even against a listed game the service has no Steam id for.
    const steamDoom = addWorkspace(library, { name: "Doom", steamAppId: 2280 }, day(3));
    learnGameIds(library, [{ id: "doom", name: "Doom", steamAppId: null }]);
    expect(library.workspaces[steamDoom]!.gameId).toBeNull();
  });

  it("leaves a game picked online and a personal workspace as they are", () => {
    const library = emptyLibrary();
    const online = addWorkspace(library, { online: { id: "hades", name: "Hades", steamAppId: 1145360 } }, day(1));
    const personal = addWorkspace(library, { personal: "9 Kings" }, day(1));
    expect(learnGameIds(library, [...LISTED, { id: "hades-2", name: "Hades", steamAppId: 1145360 }])).toEqual([]);
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

  it("adds a game known by its name and Steam id as the game the online search lists with that Steam id", async () => {
    const queries: string[] = [];
    const search = async (query: string) => {
      queries.push(query);
      return { status: "ok" as const, games: [{ id: "9-kings-x", name: "9 Kings X", steamAppId: 7 }, { id: "9-kings", name: "9 Kings", steamAppId: 2784470 }] };
    };
    expect(await withOnlineId({ name: "Nine Kings", steamAppId: 2784470 }, search)).toEqual({ online: { id: "9-kings", name: "9 Kings", steamAppId: 2784470 } });
    expect(queries).toEqual(["Nine Kings"]);
    // So the running game's Add button gets the id modules are made for at once.
    const library = emptyLibrary();
    const { id } = addOrRestoreWorkspace(library, await withOnlineId({ name: "9 Kings", steamAppId: 2784470 }, search), day(1));
    expect(id).toBe("9-kings");
    expect(fits(library, id)).toBe(true);
  });

  it("adds it as it is when the search doesn't know it, is off, fails, or there is nothing to look up", async () => {
    const input = { name: "9 Kings", steamAppId: 2784470 };
    const none = async () => ({ status: "ok" as const, games: [{ id: "other", name: "9 Kings", steamAppId: 5 }] });
    expect(await withOnlineId(input, none)).toBe(input);
    expect(await withOnlineId(input, null)).toBe(input);
    expect(await withOnlineId(input, () => Promise.reject(new Error("offline")))).toBe(input);
    expect(await withOnlineId(input, async () => ({ status: "unreachable" as const, games: [] }))).toBe(input);
    // A made-up id from the service is never taken.
    expect(await withOnlineId(input, async () => ({ status: "ok" as const, games: [{ id: "local-x", name: "9 Kings", steamAppId: 2784470 }] }))).toBe(input);
    let asked = false;
    const spy = async () => ((asked = true), { status: "ok" as const, games: [] });
    for (const other of [{ name: "9 Kings" }, { catalogId: "elden-ring" }, { personal: "Notes" }, { online: { id: "9-kings", name: "9 Kings" } }]) expect(await withOnlineId(other, spy)).toBe(other);
    expect(asked).toBe(false);
  });
});
