// Which game a game workspace is: the one place that decides it. A module is for games by their id in Tavora's game
// list; a workspace can carry that id three ways, depending on how the game was added:
//   - picked online or from the built-in list: the workspace's id is the game's id (`9-kings`, `elden-ring`);
//   - from the built-in list under an older id: `catalogId`;
//   - by name (the running game's Add button, a Steam import, the search offline): the id is `local-…`, and the game's
//     id is learned later as `gameId`, from the catalog's listing of the game with the same Steam id.
// Everything that asks "is this module for this workspace" goes through `workspaceGameIds`, so no check can tell a
// workspace's game apart from another check again. A game is added by name only when the online search can't name it
// (`withOnlineId`); it learns its game later by the rule every copy of a game is found by (`isSameGame`: the Steam id
// when both have one, else the name). Host only.
import { isGameId } from "@tavora/module-schema";
import type { OnlineSearchResult } from "../shared/host-api";
import { isSameGame } from "../shared/same-game";
import type { Library, NewWorkspace, WorkspaceEntry } from "./library";
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
 * Gives each game workspace that was added by name the id of the listed game it is, by `isSameGame` (the Steam id when
 * both have one, else the name), when exactly one listed game is it. The service's game list is where game ids come
 * from, so a listing that says otherwise corrects an id learned before. Returns the ids of the workspaces whose id changed.
 */
export function learnGameIds(library: Library, listed: readonly ListedGame[]): string[] {
  const games = new Map<string, { id: string; steamAppId: number | null; name: string }>();
  for (const game of listed) {
    if (!isLearnableGameId(game.id) || games.has(game.id)) continue;
    games.set(game.id, { id: game.id, steamAppId: isSteamAppId(game.steamAppId) ? game.steamAppId : null, name: game.name ?? "" });
  }
  const learned: string[] = [];
  for (const workspace of Object.values(library.workspaces)) {
    if (!learnsGameId(workspace)) continue;
    const self = { id: null, steamAppId: workspace.steamAppId, name: workspace.name };
    const matches = [...games.values()].filter((game) => isSameGame(self, game));
    // None, or two games it could be: not sure which, so neither.
    const id = matches.length === 1 ? matches[0]!.id : null;
    if (!id || id === workspace.gameId) continue;
    workspace.gameId = id;
    learned.push(workspace.id);
  }
  return learned;
}

/**
 * What a game added by name with its Steam id is added as: the game the online search lists with that Steam id, so it
 * gets the id modules are made for straight away; else as it is (the search doesn't know it, is off or can't be asked).
 * Every add path goes through add-workspace and so through this, whoever calls it (the running game's Add button,
 * Add a game, the welcome, Ctrl+K).
 */
export async function withOnlineId(input: NewWorkspace, search: ((query: string) => Promise<OnlineSearchResult>) | null): Promise<NewWorkspace> {
  if (!search || !("name" in input) || !isSteamAppId(input.steamAppId)) return input;
  const found = await search(input.name).catch(() => null);
  const game = found?.status === "ok" ? found.games.find((online) => online.steamAppId === input.steamAppId && isLearnableGameId(online.id)) : undefined;
  return game ? { online: { id: game.id, name: game.name, steamAppId: game.steamAppId } } : input;
}
