import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InstanceRecord {
  instanceId: string;
  moduleId: string;
}

/** Saved per-game layout. Panel instances only; module data lives in storage. */
export interface WorkspaceState {
  version: 1;
  currentGameId: string;
  games: Record<string, { instances: InstanceRecord[] }>;
}

export const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function emptyWorkspace(gameIds: readonly string[]): WorkspaceState {
  return {
    version: 1,
    currentGameId: gameIds[0] ?? "",
    games: Object.fromEntries(gameIds.map((id) => [id, { instances: [] }])),
  };
}

/**
 * Reads the saved workspace, keeping only games and modules that still
 * exist. A missing or unreadable file gives an empty workspace.
 */
export async function loadWorkspace(
  file: string,
  gameIds: readonly string[],
  isInstalled: (moduleId: string) => boolean,
): Promise<WorkspaceState> {
  const state = emptyWorkspace(gameIds);
  let saved: Partial<WorkspaceState>;
  try {
    saved = JSON.parse(await readFile(file, "utf8")) as Partial<WorkspaceState>;
  } catch {
    return state;
  }
  if (typeof saved.currentGameId === "string" && gameIds.includes(saved.currentGameId)) {
    state.currentGameId = saved.currentGameId;
  }
  for (const gameId of gameIds) {
    const instances = saved.games?.[gameId]?.instances;
    if (!Array.isArray(instances)) continue;
    state.games[gameId] = {
      instances: instances.filter(
        (record): record is InstanceRecord =>
          typeof record?.instanceId === "string" &&
          INSTANCE_ID.test(record.instanceId) &&
          typeof record.moduleId === "string" &&
          isInstalled(record.moduleId),
      ),
    };
  }
  return state;
}

export async function saveWorkspace(file: string, state: WorkspaceState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await rename(temp, file);
}

/**
 * Splits the area into equal columns. This is a stand-in for the nested
 * docking layout planned for the player MVP.
 */
export function layoutColumns(count: number, area: Rect): Rect[] {
  if (count <= 0) return [];
  const base = Math.floor(area.width / count);
  return Array.from({ length: count }, (_, index) => ({
    x: area.x + base * index,
    y: area.y,
    width: index === count - 1 ? area.width - base * (count - 1) : base,
    height: area.height,
  }));
}

/** Whether every panel would still meet its module's minimum size. */
export function fitsMinimums(area: Rect, minimums: { minWidth: number; minHeight: number }[]): boolean {
  if (minimums.length === 0) return true;
  const columns = layoutColumns(minimums.length, area);
  return minimums.every(
    (min, index) => columns[index]!.width >= min.minWidth && columns[index]!.height >= min.minHeight,
  );
}
