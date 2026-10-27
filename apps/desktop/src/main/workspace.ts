import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPanelTypeId } from "@tavora/module-schema";
import { INSTANCE_ID } from "./ids";
import { UserError } from "./messages";
import type { LayoutTemplate } from "../shared/layout-templates";
import { LAYOUT_LIMITS, layoutPanels, parseLayout, pruneLayout, templateLayout, vacateLayout, type SavedLayout } from "./layout";
import { checkPanelContent, type PanelContent } from "./panel-content";

export { INSTANCE_ID } from "./ids";

export interface InstanceRecord {
  instanceId: string;
  moduleId: string;
  /** Which of the module's panel types this panel is; left out for a module without types. */
  panelType?: string;
  /** What the panel last said it shows (panel.setContent); kept across game switches and restarts. */
  content?: PanelContent;
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
  /** The panel type of each placeholder whose module has types. */
  panelTypes?: Record<string, string>;
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

/** A problem with the workspace that the user can fix; its message is shown as-is. */
export class WorkspaceError extends UserError {}

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
  const panelTypes: Record<string, string> = {};
  if (isRecord(raw.panelTypes)) {
    for (const [slot, type] of Object.entries(raw.panelTypes)) if (slot in modules && isPanelTypeId(type)) panelTypes[slot] = type;
  }
  return { id, name, savedAt, layout, modules, ...(Object.keys(panelTypes).length ? { panelTypes } : {}) };
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
    const instances = (Array.isArray(game.instances) ? game.instances : [])
      .filter(
        (record): record is InstanceRecord =>
          typeof record?.instanceId === "string" &&
          INSTANCE_ID.test(record.instanceId) &&
          typeof record.moduleId === "string" &&
          isInstalled(record.moduleId),
      )
      .map(({ instanceId, moduleId, panelType, content }): InstanceRecord => {
        const checked = checkPanelContent(content);
        return { instanceId, moduleId, ...(isPanelTypeId(panelType) ? { panelType } : {}), ...(checked ? { content: checked } : {}) };
      });
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

/** A module's panel types as the workspace needs them: their ids, and the one older panels become. */
export interface PanelTypesOf {
  ids: readonly string[];
  continuing: string | null;
}

/**
 * Gives every panel of a module with panel types its type, and takes it from panels of a module that
 * no longer has any (the decision log, named panels round 6). A panel opened before its module had
 * types becomes the continuing type; one whose type an update removed keeps it, so its slot can say
 * the type is gone. A module Tavora can't see right now (a development build being rebuilt) leaves its
 * panels' types alone, so they come back as the same panels. Snapshots get the same treatment.
 */
export function settlePanelTypes(state: WorkspaceState, typesOf: (moduleId: string) => PanelTypesOf | undefined): void {
  const settle = (moduleId: string, panelType: string | undefined): string | undefined => {
    const types = typesOf(moduleId);
    if (!types) return panelType;
    if (types.ids.length === 0) return undefined;
    return panelType ?? types.continuing ?? undefined;
  };
  for (const game of Object.values(state.games)) {
    for (const record of game.instances) {
      const panelType = settle(record.moduleId, record.panelType);
      if (panelType === undefined) delete record.panelType;
      else record.panelType = panelType;
    }
    for (const snapshot of game.snapshots) {
      const panelTypes: Record<string, string> = {};
      for (const [slot, moduleId] of Object.entries(snapshot.modules)) {
        const panelType = settle(moduleId, snapshot.panelTypes?.[slot]);
        if (panelType !== undefined) panelTypes[slot] = panelType;
      }
      if (Object.keys(panelTypes).length) snapshot.panelTypes = panelTypes;
      else delete snapshot.panelTypes;
    }
  }
}

export async function saveWorkspace(file: string, state: WorkspaceState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await rename(temp, file);
}

/**
 * Works out which panels a snapshot needs. Each placeholder reuses an open
 * panel of the same module and panel type where there is one, so the panel
 * keeps its state; the rest get new panels. Open panels nothing reuses are returned
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
  // A panel matches a placeholder when it shows the same module and panel type.
  const matches = (record: InstanceRecord, slot: string) =>
    record.moduleId === snapshot.modules[slot] && record.panelType === snapshot.panelTypes?.[slot];
  const take = (slot: string) => {
    // The same panel the snapshot was saved from, else any of that module and type.
    let index = unused.findIndex((record) => record.instanceId === slot && matches(record, slot));
    if (index < 0) index = unused.findIndex((record) => matches(record, slot));
    const panelType = snapshot.panelTypes?.[slot];
    const record = index >= 0 ? unused.splice(index, 1)[0]! : { instanceId: newId(), moduleId: snapshot.modules[slot]!, ...(panelType ? { panelType } : {}) };
    slots.set(slot, record.instanceId);
    instances.push(record);
  };
  const order = layoutPanels(snapshot.layout);
  // Exact matches first, so a panel is not taken by an earlier placeholder of the same module.
  for (const slot of order) {
    if (unused.some((record) => record.instanceId === slot && matches(record, slot))) take(slot);
  }
  for (const slot of order) if (!slots.has(slot)) take(slot);
  const layout = pruneLayout(snapshot.layout, (slot) => slots.has(slot), (slot) => slots.get(slot)!)!;
  // Keep the order panels appear in the layout.
  const position = new Map(layoutPanels(layout).map((id, index) => [id, index]));
  instances.sort((a, b) => position.get(a.instanceId)! - position.get(b.instanceId)!);
  return { instances, layout, close: unused };
}

export interface GameWorkspacesOptions {
  /** Writes the workspace; called after every change with a copy the caller may keep. */
  save(state: WorkspaceState): void;
  /** Ids for new panels and snapshots; random by default. */
  newId?(): string;
  now?(): Date;
}

/**
 * Every game's open panels, layout and snapshots, and the rules for changing them. Each change saves
 * itself; one that replaces a layout the host UI has docked bumps `epoch`, so the host UI takes the new
 * one. Panels a change closes or opens are handed back, and the host starts or stops their views.
 */
export class GameWorkspaces {
  private layoutEpoch = 0;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly state: WorkspaceState,
    private readonly options: GameWorkspacesOptions,
  ) {
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  /** Bumped whenever a layout is replaced rather than docked by the host UI. */
  get epoch(): number {
    return this.layoutEpoch;
  }

  /** A game's workspace; an empty one for a game that has none yet. */
  game(gameId: string): GameWorkspace {
    return (this.state.games[gameId] ??= emptyGameWorkspace());
  }

  panels(gameId: string): InstanceRecord[] {
    return this.game(gameId).instances;
  }

  /** The games, by id, with a panel of this module. */
  gamesUsing(moduleId: string): string[] {
    return Object.entries(this.state.games)
      .filter(([, game]) => game.instances.some((record) => record.moduleId === moduleId))
      .map(([gameId]) => gameId);
  }

  /** Saves a change the host made to a panel's record (its content or type). */
  save(): void {
    this.options.save(structuredClone(this.state));
  }

  /** The host UI is to take the saved layout again, as when a game opens. */
  relayout(): void {
    this.layoutEpoch++;
  }

  settlePanelTypes(typesOf: (moduleId: string) => PanelTypesOf | undefined): void {
    settlePanelTypes(this.state, typesOf);
  }

  /** Empty workspaces for games new to the library. */
  addGames(gameIds: readonly string[]): void {
    if (gameIds.length === 0) return;
    for (const id of gameIds) this.state.games[id] = emptyGameWorkspace();
    this.save();
  }

  /** Forgets a game that left the library for good; answers with the panels it had. */
  forgetGame(gameId: string): InstanceRecord[] {
    const records = this.state.games[gameId]?.instances ?? [];
    delete this.state.games[gameId];
    this.save();
    return records;
  }

  /** Adds a panel; the host UI docks it. */
  openPanel(gameId: string, record: InstanceRecord): void {
    const records = this.panels(gameId);
    if (records.length >= LAYOUT_LIMITS.panels) throw new WorkspaceError("error.panelLimit", { max: LAYOUT_LIMITS.panels });
    records.push(record);
    this.save();
  }

  /** Closes a panel, and its slot with it; false when it was not open. */
  closePanel(gameId: string, instanceId: string): boolean {
    const game = this.game(gameId);
    const index = game.instances.findIndex((record) => record.instanceId === instanceId);
    if (index < 0) return false;
    game.instances.splice(index, 1);
    game.layout = pruneLayout(game.layout, (id) => id !== instanceId);
    this.save();
    return true;
  }

  /**
   * Closes a module's panels, in one game or in every game, leaving their slots empty so the layout
   * stays. Answers with the panels it closed.
   */
  vacate(moduleId: string, gameId?: string): string[] {
    const games = gameId === undefined ? Object.values(this.state.games) : [this.game(gameId)];
    const closed: string[] = [];
    for (const game of games) {
      const gone = new Set(game.instances.filter((record) => record.moduleId === moduleId).map((record) => record.instanceId));
      if (gone.size === 0) continue;
      game.instances = game.instances.filter((record) => !gone.has(record.instanceId));
      game.layout = vacateLayout(game.layout, (id) => gone.has(id));
      closed.push(...gone);
    }
    if (closed.length) this.replaced();
    return closed;
  }

  /** Forgets every panel whose module is not installed any more, slot and all. Answers with the panels it closed. */
  dropMissingModules(isInstalled: (moduleId: string) => boolean): string[] {
    const closed: string[] = [];
    for (const game of Object.values(this.state.games)) {
      const gone = new Set(game.instances.filter((record) => !isInstalled(record.moduleId)).map((record) => record.instanceId));
      if (gone.size === 0) continue;
      game.instances = game.instances.filter((record) => !gone.has(record.instanceId));
      game.layout = pruneLayout(game.layout, (id) => !gone.has(id));
      closed.push(...gone);
    }
    if (closed.length) this.replaced();
    return closed;
  }

  /** Keeps the layout the host UI docked, without panels that are not open. */
  saveLayout(gameId: string, layout: SavedLayout | null): void {
    const game = this.game(gameId);
    const open = new Set(game.instances.map((record) => record.instanceId));
    game.layout = pruneLayout(layout, (id) => open.has(id));
    this.save();
  }

  /** Rearranges the open panels into a template's slots, in the order they are laid out now. */
  applyTemplate(gameId: string, template: LayoutTemplate | undefined): void {
    if (!template) throw new WorkspaceError("error.templateGone");
    const game = this.game(gameId);
    const laidOut = layoutPanels(game.layout);
    const rest = game.instances.map((record) => record.instanceId).filter((id) => !laidOut.includes(id));
    game.layout = templateLayout(template, [...laidOut, ...rest]);
    this.replaced();
  }

  /** Saves the current layout under a new name; answers with the snapshot's id. */
  saveSnapshot(gameId: string, name: string): string {
    const game = this.game(gameId);
    if (game.snapshots.length >= MAX_SNAPSHOTS) throw new WorkspaceError("error.layoutLimit", { max: MAX_SNAPSHOTS });
    const snapshot: Snapshot = { id: this.newId(), name: this.snapshotName(game, name), ...this.capture(game) };
    game.snapshots.push(snapshot);
    this.save();
    return snapshot.id;
  }

  /** Replaces a snapshot with the current layout; its name stays. */
  updateSnapshot(gameId: string, snapshotId: string): void {
    const game = this.game(gameId);
    Object.assign(this.snapshot(game, snapshotId), this.capture(game));
    this.save();
  }

  renameSnapshot(gameId: string, snapshotId: string, name: string): void {
    const game = this.game(gameId);
    this.snapshot(game, snapshotId).name = this.snapshotName(game, name, snapshotId);
    this.save();
  }

  deleteSnapshot(gameId: string, snapshotId: string): void {
    const game = this.game(gameId);
    const { id } = this.snapshot(game, snapshotId);
    game.snapshots = game.snapshots.filter((snapshot) => snapshot.id !== id);
    this.save();
  }

  /**
   * Replaces the open panels with the snapshot's. Panels of the same module are reused, the rest are
   * closed; module data is never touched. Answers with the panels that are new and those that closed.
   */
  applySnapshot(gameId: string, snapshotId: string): { opened: InstanceRecord[]; closed: InstanceRecord[] } {
    const game = this.game(gameId);
    const plan = planSnapshot(this.snapshot(game, snapshotId), game.instances, this.newId);
    const existing = new Set(game.instances.map((record) => record.instanceId));
    game.instances = plan.instances;
    game.layout = plan.layout;
    this.replaced();
    return { opened: plan.instances.filter((record) => !existing.has(record.instanceId)), closed: plan.close };
  }

  /** A layout was replaced: the host UI takes the new one. */
  private replaced(): void {
    this.layoutEpoch++;
    this.save();
  }

  private snapshot(game: GameWorkspace, snapshotId: string): Snapshot {
    const found = game.snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!found) throw new WorkspaceError("error.layoutGone");
    return found;
  }

  /** A snapshot's name, trimmed; no two snapshots of a game share one, whatever the case. */
  private snapshotName(game: GameWorkspace, name: string, except?: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new WorkspaceError("error.layoutNeedsName");
    const taken = game.snapshots.some((snapshot) => snapshot.id !== except && snapshot.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (taken) throw new WorkspaceError("error.layoutTaken", { name: trimmed });
    return trimmed;
  }

  /** The current layout as a snapshot body: placeholders named after the panels they came from. */
  private capture(game: GameWorkspace): Pick<Snapshot, "layout" | "modules" | "panelTypes" | "savedAt"> {
    const layout = game.layout;
    const panels = layoutPanels(layout);
    if (!layout || panels.length === 0) throw new WorkspaceError("error.layoutNeedsModule");
    const recordOf = new Map(game.instances.map((record) => [record.instanceId, record]));
    const panelTypes = Object.fromEntries(panels.flatMap((id) => (recordOf.get(id)!.panelType ? [[id, recordOf.get(id)!.panelType!]] : [])));
    return {
      layout: structuredClone(layout),
      modules: Object.fromEntries(panels.map((id) => [id, recordOf.get(id)!.moduleId])),
      panelTypes,
      savedAt: this.now().toISOString(),
    };
  }
}
