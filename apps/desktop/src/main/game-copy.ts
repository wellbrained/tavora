// Whether the user already has a game, Trash included, so adding it again brings that copy back instead of making a
// second one. Host only: the name matching comes from the launcher scan.
import { catalogGame } from "./catalog";
import { normalizeName } from "./launcher-games";
import { addWorkspace, restoreWorkspace, type Library, type NewWorkspace, type WorkspaceEntry } from "./library";
import { isSteamAppId } from "./steam-icons";

/** What names a game across lists: Tavora's id, Steam's app id and its name. */
export interface GameIdentity {
  id: string | null;
  steamAppId: number | null;
  name: string;
}

/**
 * Finds the user's copy of a game, Trash included: by Tavora's id, by Steam's app id, else by name ignoring case,
 * punctuation, ® and ™ (a game added by hand is the same game). A copy in use wins over one in Trash. A personal
 * workspace is never a game's copy. Made once for many games (a Steam library), it reads the library as it is now.
 */
export function gameCopyFinder(library: Library): (game: GameIdentity) => WorkspaceEntry | undefined {
  const games = Object.values(library.workspaces).flatMap((own) => (own.kind === "game" ? [{ own, name: normalizeName(own.name) }] : []));
  return (game) => {
    const name = normalizeName(game.name);
    const copies = games
      .filter((entry) => (game.id !== null && entry.own.id === game.id) || (game.steamAppId !== null && entry.own.steamAppId === game.steamAppId) || (name !== "" && entry.name === name))
      .map((entry) => entry.own);
    return copies.find((own) => own.trashedAt === null) ?? copies[0];
  };
}

/** The user's copy of one game (see gameCopyFinder). */
export function findGameCopy(library: Library, game: GameIdentity): WorkspaceEntry | undefined {
  return gameCopyFinder(library)(game);
}

/** The game a new game workspace would be, or null for a personal workspace (and a built-in id that isn't one). */
function identityOf(input: NewWorkspace): GameIdentity | null {
  if ("personal" in input) return null;
  if ("catalogId" in input) {
    const known = catalogGame(input.catalogId);
    return known ? { id: known.id, steamAppId: known.steamAppId ?? null, name: known.name } : null;
  }
  if ("online" in input) {
    const steamAppId = isSteamAppId(input.online.steamAppId) ? input.online.steamAppId : (catalogGame(input.online.id)?.steamAppId ?? null);
    return { id: input.online.id, steamAppId, name: input.online.name };
  }
  return { id: null, steamAppId: isSteamAppId(input.steamAppId) ? input.steamAppId : null, name: input.name };
}

/**
 * Adds a workspace, or, for a game whose only copy is in Trash, brings that copy back with its panels instead of making
 * another. Returns its id and whether it came back.
 */
export function addOrRestoreWorkspace(library: Library, input: NewWorkspace, now: Date): { id: string; restored: boolean } {
  const game = identityOf(input);
  const copy = game ? findGameCopy(library, game) : undefined;
  if (copy?.trashedAt) {
    restoreWorkspace(library, copy.id);
    return { id: copy.id, restored: true };
  }
  return { id: addWorkspace(library, input, now), restored: false };
}
