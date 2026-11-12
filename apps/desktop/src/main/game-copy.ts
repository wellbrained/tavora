// Whether the user already has a game, Trash included, so adding it again opens or brings back that copy instead of
// making a second one. Host only.
import { isSameGame, type GameIdentity } from "../shared/same-game";
import { catalogGame } from "./catalog";
import { addWorkspace, restoreWorkspace, type Library, type NewWorkspace, type WorkspaceEntry } from "./library";
import { isSteamAppId } from "./steam-icons";

/**
 * Finds the user's copy of a game, Trash included, by `isSameGame`. A copy in use wins over one in Trash. A personal
 * workspace is never a game's copy. Made once for many games (a Steam library), it reads the library as it is now.
 */
export function gameCopyFinder(library: Library): (game: GameIdentity) => WorkspaceEntry | undefined {
  const games = Object.values(library.workspaces).filter((own) => own.kind === "game");
  return (game) => {
    const copies = games.filter((own) => isSameGame(own, game));
    return copies.find((own) => own.trashedAt === null) ?? copies[0];
  };
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
 * Adds a workspace, unless the user has the game already: a copy in use is answered as it is (`existing`), and one whose
 * only copy is in Trash comes back with its panels (`restored`). Returns the workspace's id.
 */
export function addOrRestoreWorkspace(library: Library, input: NewWorkspace, now: Date): { id: string; restored?: true; existing?: true } {
  const game = identityOf(input);
  const copy = game ? gameCopyFinder(library)(game) : undefined;
  if (copy && copy.trashedAt === null) return { id: copy.id, existing: true };
  if (copy) {
    restoreWorkspace(library, copy.id);
    return { id: copy.id, restored: true };
  }
  return { id: addWorkspace(library, input, now) };
}
