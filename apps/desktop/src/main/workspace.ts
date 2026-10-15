import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { INSTANCE_ID } from "./ids";
import { PlayerError } from "./messages";
import { layoutPanels, parseLayout, pruneLayout, type SavedLayout } from "./layout";

export { INSTANCE_ID } from "./ids";

export interface InstanceRecord {
  instanceId: string;
  moduleId: string;
}

/**
 * A named layout. Its panels are placeholders: `modules` says which module
 * each one shows, and applying the snapshot puts real panels in their place.
 */
export interface Snapshot {
  id: string;
  name: string;
  savedAt: string;
  layout: SavedLayout;
  modules: Record<string, string>;
}

export interface GameWorkspace {
  /** Open panels, in the order they were opened. */
  instances: InstanceRecord[];
  /** How the open panels are docked; null until the host UI saves one. */
  layout: SavedLayout | null;
  snapshots: Snapshot[];
}

/** Saved per-game layouts. Panel instances only; module data lives in storage. */
export interface WorkspaceState {
  version: 2;
  games: Record<string, GameWorkspace>;
}

/** A problem with the workspace that the player can fix; its message is shown as-is. */
export class WorkspaceError extends PlayerError {}

export const MAX_SNAPSHOTS = 50;
export const MAX_SNAPSHOT_NAME = 80;

export function emptyGameWorkspace(): GameWorkspace {
  return { instances: [], layout: null, snapshots: [] };
}

export function emptyWorkspace(gameIds: readonly string[]): WorkspaceState {
  return { version: 2, games: Object.fromEntries(gameIds.map((id) => [id, emptyGameWorkspace()])) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseSnapshot(raw: unknown, isInstalled: (moduleId: string) => boolean): Snapshot | null {
  if (!isRecord(raw) || !isRecord(raw.modules)) return null;
  const { id, name, savedAt } = raw;
  if (typeof id !== "string" || !INSTANCE_ID.test(id)) return null;
  if (typeof name !== "string" || name.length === 0 || name.length > MAX_SNAPSHOT_NAME) return null;
  if (typeof savedAt !== "string" || Number.isNaN(Date.parse(savedAt))) return null;
  const modules: Record<string, string> = {};
  for (const [slot, moduleId] of Object.entries(raw.modules)) {
    if (typeof moduleId === "string" && isInstalled(moduleId)) modules[slot] = moduleId;
  }
  const layout = pruneLayout(parseLayout(raw.layout), (slot) => slot in modules);
  if (!layout) return null;
  for (const slot of Object.keys(modules)) if (!layoutPanels(layout).includes(slot)) delete modules[slot];
  return { id, name, savedAt, layout, modules };
}

/**
 * Reads the saved workspace, keeping only games in the library (Trash
 * included) and modules that are still installed. A missing or unreadable
 * file gives empty workspaces. Version 1 files (panels without a layout)
 * are read as they are; the host UI places their panels.
 */
export async function loadWorkspace(
  file: string,
  gameIds: readonly string[],
  isInstalled: (moduleId: string) => boolean,
): Promise<WorkspaceState> {
  const state = emptyWorkspace(gameIds);
  let saved: { games?: Record<string, Partial<Record<keyof GameWorkspace, unknown>>> };
  try {
    saved = JSON.parse(await readFile(file, "utf8")) as typeof saved;
  } catch {
    return state;
  }
  for (const gameId of gameIds) {
    const game = saved.games?.[gameId];
    if (!isRecord(game)) continue;
    const instances = (Array.isArray(game.instances) ? game.instances : []).filter(
      (record): record is InstanceRecord =>
        typeof record?.instanceId === "string" &&
        INSTANCE_ID.test(record.instanceId) &&
        typeof record.moduleId === "string" &&
        isInstalled(record.moduleId),
    );
    const open = new Set(instances.map((record) => record.instanceId));
    const snapshots = (Array.isArray(game.snapshots) ? game.snapshots : [])
      .map((snapshot) => parseSnapshot(snapshot, isInstalled))
      .filter((snapshot): snapshot is Snapshot => snapshot !== null)
      .slice(0, MAX_SNAPSHOTS);
    state.games[gameId] = {
      instances,
      layout: pruneLayout(parseLayout(game.layout), (id) => open.has(id)),
      snapshots,
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
 * Works out which panels a snapshot needs. Each placeholder reuses an open
 * panel of the same module where there is one, so the panel keeps its
 * state; the rest get new panels. Open panels nothing reuses are returned
 * as `close`.
 */
export function planSnapshot(
  snapshot: Snapshot,
  open: readonly InstanceRecord[],
  newId: () => string,
): { instances: InstanceRecord[]; layout: SavedLayout; close: InstanceRecord[] } {
  const unused = [...open];
  const slots = new Map<string, string>();
  const instances: InstanceRecord[] = [];
  const take = (slot: string, moduleId: string) => {
    // The same panel the snapshot was saved from, else any of that module.
    let index = unused.findIndex((record) => record.instanceId === slot && record.moduleId === moduleId);
    if (index < 0) index = unused.findIndex((record) => record.moduleId === moduleId);
    const record = index >= 0 ? unused.splice(index, 1)[0]! : { instanceId: newId(), moduleId };
    slots.set(slot, record.instanceId);
    instances.push(record);
  };
  const order = layoutPanels(snapshot.layout);
  // Exact matches first, so a panel is not taken by an earlier placeholder of the same module.
  for (const slot of order) {
    const moduleId = snapshot.modules[slot]!;
    if (unused.some((record) => record.instanceId === slot && record.moduleId === moduleId)) take(slot, moduleId);
  }
  for (const slot of order) if (!slots.has(slot)) take(slot, snapshot.modules[slot]!);
  const layout = pruneLayout(snapshot.layout, (slot) => slots.has(slot), (slot) => slots.get(slot)!)!;
  // Keep the order panels appear in the layout.
  const position = new Map(layoutPanels(layout).map((id, index) => [id, index]));
  instances.sort((a, b) => position.get(a.instanceId)! - position.get(b.instanceId)!);
  return { instances, layout, close: unused };
}
