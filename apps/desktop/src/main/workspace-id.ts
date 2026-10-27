/**
 * Workspace ids look like game ids: a game workspace's id is its game's id, and a personal workspace's is made the
 * same way (`local-<name>`). They name folders in the data folder, so nothing else may pass for one.
 */
export { isGameId as isWorkspaceId } from "@tavora/module-schema";
