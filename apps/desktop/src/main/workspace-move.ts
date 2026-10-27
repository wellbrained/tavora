import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { backupsDir } from "./backup";
import { writeFileAtomic } from "./fsutil";
import { GAME_OVERLAYS_FILE } from "./game-overlays";
import { HOTKEYS_FILE } from "./hotkeys";
import { OVERLAYS_FILE } from "./overlays";
import { LIBRARY_FILE, WORKSPACE_FILE } from "./saved-data";

// The Game → Workspace rename (decided 2026-10-27): an item on the rail is a workspace, a game workspace (linked to
// a game) or a personal one. What Tavora saved before used the old names for it; this moves them to the new ones,
// once, at start, before anything reads the files. It is the only code that knows the old names. Each file says by
// its version whether it was moved, so a start that stopped half way finishes the rest the next time. The files are
// copied to backups/before-workspaces first. An older Tavora can't read moved files: it sets them aside, because
// their version is newer than it knows.

/** The folder in backups/ that keeps the files as they were before the move. Backups never prune it. */
export const BEFORE_WORKSPACES_DIR = "before-workspaces";

/** The first version of each file with the new names. */
export const MOVED_VERSIONS = { [LIBRARY_FILE]: 2, [WORKSPACE_FILE]: 3, [GAME_OVERLAYS_FILE]: 4, [OVERLAYS_FILE]: 2, [HOTKEYS_FILE]: 2 } as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** A copy of `value` with some keys renamed, in their old places. */
function renameKeys(value: Json, names: Record<string, string>): Json {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [names[key] ?? key, item]));
}

function mapValues(value: Json, map: (item: unknown) => unknown): Json {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, map(item)]));
}

/** Renames `gameId` to `workspaceId` in each record of a list. */
function renameInList(list: unknown): unknown {
  return Array.isArray(list) ? list.map((item) => (isObject(item) ? renameKeys(item, { gameId: "workspaceId" }) : item)) : list;
}

/** Whether a file of this version still has the old names; a newer file is left alone. */
const isOld = (version: unknown, moved: number): boolean => typeof version !== "number" || version < moved;

/**
 * library.json: `games` (each with its `kind` and `lastPlayedAt`), the folders' `games`, the rail, `startup`, `lastGameId`,
 * `gameEndWorkspace` and the icon dialog's folder (`dialogFolders["game-image"]`).
 */
export function moveLibrary(saved: Json): Json | null {
  if (!isOld(saved.version, MOVED_VERSIONS[LIBRARY_FILE])) return null;
  const moved = renameKeys(saved, { games: "workspaces", lastGameId: "lastWorkspaceId", gameEndWorkspace: "gameEndWorkspaceId" });
  moved.version = MOVED_VERSIONS[LIBRARY_FILE];
  if (isObject(moved.workspaces)) {
    moved.workspaces = mapValues(moved.workspaces, (entry) => {
      if (!isObject(entry)) return entry;
      const workspace = renameKeys(entry, { lastPlayedAt: "lastOpenedAt" });
      if (workspace.kind === "workspace") workspace.kind = "personal";
      return workspace;
    });
  }
  if (isObject(moved.folders)) moved.folders = mapValues(moved.folders, (folder) => (isObject(folder) ? renameKeys(folder, { games: "workspaces" }) : folder));
  if (Array.isArray(moved.root)) moved.root = moved.root.map((item) => (isObject(item) && item.kind === "game" ? { ...item, kind: "workspace" } : item));
  if (moved.startup === "last-game") moved.startup = "last-workspace";
  // The folder the icon dialog last opened in.
  if (isObject(moved.dialogFolders)) moved.dialogFolders = renameKeys(moved.dialogFolders, { "game-image": "workspace-image" });
  return moved;
}

/** workspace.json: `games`. Version 1 and 2 hold the same names. */
export function moveWorkspace(saved: Json): Json | null {
  if (!isOld(saved.version, MOVED_VERSIONS[WORKSPACE_FILE])) return null;
  return { ...renameKeys(saved, { games: "workspaces" }), version: MOVED_VERSIONS[WORKSPACE_FILE] };
}

/**
 * game-overlays.json: each overlay's and in-game panel's `gameId`. The positions it keeps per game window (`layout.games`,
 * `layout.seen`) are by game and stay. A file of version 1 or 2 still needs what GameOverlayStore does with those once
 * it reads them, so `formerVersion` says which it was.
 */
export function moveGameOverlays(saved: Json): Json | null {
  if (!isOld(saved.version, MOVED_VERSIONS[GAME_OVERLAYS_FILE])) return null;
  const formerVersion = saved.version === 3 ? null : saved.version === 2 ? 2 : 1;
  const moved: Json = { ...saved, version: MOVED_VERSIONS[GAME_OVERLAYS_FILE], ...(formerVersion ? { formerVersion } : {}) };
  if ("overlays" in moved) moved.overlays = renameInList(moved.overlays);
  if ("panels" in moved) moved.panels = renameInList(moved.panels);
  return moved;
}

/** overlays.json (stream overlay links): each link's `gameId`. */
export function moveOverlayLinks(saved: Json): Json | null {
  if (!isOld(saved.version, MOVED_VERSIONS[OVERLAYS_FILE])) return null;
  return { ...saved, version: MOVED_VERSIONS[OVERLAYS_FILE], links: renameInList(saved.links) };
}

/** hotkeys.json: each hotkey's `gameId`. */
export function moveHotkeys(saved: Json): Json | null {
  if (!isOld(saved.version, MOVED_VERSIONS[HOTKEYS_FILE])) return null;
  return { ...saved, version: MOVED_VERSIONS[HOTKEYS_FILE], hotkeys: renameInList(saved.hotkeys) };
}

const MOVES: readonly [name: string, move: (saved: Json) => Json | null][] = [
  [LIBRARY_FILE, moveLibrary],
  [WORKSPACE_FILE, moveWorkspace],
  [GAME_OVERLAYS_FILE, moveGameOverlays],
  [OVERLAYS_FILE, moveOverlayLinks],
  [HOTKEYS_FILE, moveHotkeys],
];

/**
 * Runs at every start, before any saved file is read. Moves each file that still has the old names: all are copied
 * to backups/before-workspaces, then each is written anew. Missing and unreadable files are left to the code that
 * reads them. Throws when a file can't be copied or written, so Tavora does not start on files it can't read.
 * Answers with the files it moved.
 */
export async function moveToWorkspaces(userData: string, log: (line: string) => void = () => undefined): Promise<string[]> {
  const pending: { name: string; old: Buffer; moved: Json }[] = [];
  for (const [name, move] of MOVES) {
    let old: Buffer;
    let saved: unknown;
    try {
      old = await readFile(path.join(userData, name));
      saved = JSON.parse(old.toString("utf8"));
    } catch {
      continue;
    }
    const moved = isObject(saved) ? move(saved) : null;
    if (moved) pending.push({ name, old, moved });
  }
  if (pending.length === 0) return [];
  const backup = path.join(backupsDir(userData), BEFORE_WORKSPACES_DIR);
  for (const { name, old } of pending) await keepCopy(backup, name, old);
  for (const { name, moved } of pending) await writeFileAtomic(path.join(userData, name), `${JSON.stringify(moved, null, 2)}\n`);
  const names = pending.map(({ name }) => name);
  log(`moved ${names.join(", ")} to the workspace names; the files as they were are in backups/${BEFORE_WORKSPACES_DIR}`);
  return names;
}

/** Copies a file's old content into the backup folder. A copy an earlier start made stays; a different one gets a new name. */
async function keepCopy(dir: string, name: string, old: Buffer): Promise<void> {
  for (let n = 1; ; n++) {
    const target = path.join(dir, n === 1 ? name : `${name}.${n}`);
    const existing = await stat(target).then(
      () => readFile(target),
      () => null,
    );
    if (existing?.equals(old)) return;
    if (existing === null) return writeFileAtomic(target, old);
  }
}
