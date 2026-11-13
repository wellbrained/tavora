// Which game a game workspace is: the one place that decides it. A module is for games by their id in Tavora's game
// list; a workspace can carry that id three ways, depending on how the game was added:
//   - picked online or from the built-in list: the workspace's id is the game's id (`9-kings`, `elden-ring`);
//   - from the built-in list under an older id: `catalogId`;
//   - by name (the running game's Add button, a Steam import, the search offline): the id is `local-…`, and the game's
//     id is learned later as `gameId`, from the catalog's listing of the game with the same Steam id.
// Everything that asks "is this module for this workspace" goes through `workspaceGameIds`, so no check can tell a
// workspace's game apart from another check again. Host only.
import { isGameId } from "@tavora/module-schema";
import type { Library, WorkspaceEntry } from "./library";
import { isSteamAppId } from "./steam-icons";

/** A game as the catalog lists it next to a module: its id, its name and its Steam app id when the service knows them. */
export interface ListedGame {
  id: string;
  name: string | null;
  steamAppId: number | null;
}

/** What of a workspace says which game it is. */
export type WorkspaceGameFields = Pick<WorkspaceEntry, "id" | "kind" | "catalogId" | "gameId">;

/** The ids a game workspace's game goes by, each once; none for a personal workspace, which belongs to no game. */
export function workspaceGameIds(workspace: WorkspaceGameFields): string[] {
  if (workspace.kind === "personal") return [];
  return [...new Set([workspace.id, workspace.catalogId, workspace.gameId].filter((id): id is string => id !== null))];
}

/** Whether a module made for `games` (empty: any game) goes in this game workspace. Personal workspaces are decided elsewhere. */
export function isForWorkspaceGame(games: readonly string[], workspace: WorkspaceGameFields): boolean {
  if (games.length === 0) return true;
  const ids = workspaceGameIds(workspace);
  return games.some((game) => ids.includes(game));
}

/** A game id a workspace may learn: one from Tavora's game list, never one made on this PC. */
export function isLearnableGameId(id: unknown): id is string {
  return isGameId(id) && !id.startsWith("local-");
}

/** Whether a workspace learns its game's id: only a game added by name (`local-…`), not one picked from a list. */
export function learnsGameId(workspace: Pick<WorkspaceEntry, "id" | "kind" | "catalogId">): boolean {
  return workspace.kind === "game" && workspace.catalogId === null && workspace.id.startsWith("local-");
}

/**
 * Gives each game workspace that was added by name the id of the listed game with its Steam app id, when exactly one
 * listed game has it. The service's game list is where game ids come from, so a listing that says otherwise corrects an
 * id learned before. Returns the ids of the workspaces whose id changed.
 */
export function learnGameIds(library: Library, listed: readonly ListedGame[]): string[] {
  const bySteam = new Map<number, string | null>();
  for (const game of listed) {
    if (!isSteamAppId(game.steamAppId) || !isLearnableGameId(game.id)) continue;
    const seen = bySteam.get(game.steamAppId);
    // Two ids for one Steam app: not sure which game it is, so neither.
    bySteam.set(game.steamAppId, seen === undefined || seen === game.id ? game.id : null);
  }
  const learned: string[] = [];
  for (const workspace of Object.values(library.workspaces)) {
    if (!learnsGameId(workspace) || workspace.steamAppId === null) continue;
    const id = bySteam.get(workspace.steamAppId);
    if (!id || id === workspace.gameId) continue;
    workspace.gameId = id;
    learned.push(workspace.id);
  }
  return learned;
}
