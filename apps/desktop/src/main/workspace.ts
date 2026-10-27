import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPanelTypeId } from "@tavora/module-schema";
import { INSTANCE_ID } from "./ids";
import { PlayerError } from "./messages";
import type { LayoutTemplate } from "../shared/layout-templates";
import { LAYOUT_LIMITS, layoutPanels, parseLayout, pruneLayout, templateLayout, vacateLayout, type SavedLayout } from "./layout";
import { checkPanelContent, type PanelContent } from "./panel-content";

export { INSTANCE_ID } from "./ids";

export interface InstanceRecord {
  instanceId: string;
  moduleId: string;
  /** Which of the module's panel types this panel is; left out for a module without types. */
  panelType?: string;
  /** What the panel last said it shows (panel.setContent); kept across workspace switches and restarts. */
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

export interface Workspace {
  /** Open panels, in the order they were opened. */
  instances: InstanceRecord[];
  /** How the open panels are docked; null until the host UI saves one. */
  layout: SavedLayout | null;
  snapshots: Snapshot[];
}

/** Saved per-workspace layouts. Panel instances only; module data lives in storage. */
export interface WorkspaceState {
  version: 3;
  workspaces: Record<string, Workspace>;
}

/** A problem with the workspace that the player can fix; its message is shown as-is. */
export class WorkspaceError extends PlayerError {}

export const MAX_SNAPSHOTS = 50;
export const MAX_SNAPSHOT_NAME = 80;

export function emptyWorkspace(): Workspace {
  return { instances: [], layout: null, snapshots: [] };
}

export function emptyWorkspaces(workspaceIds: readonly string[]): WorkspaceState {
  return { version: 3, workspaces: Object.fromEntries(workspaceIds.map((id) => [id, emptyWorkspace()])) };
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
 * Reads the saved workspace, keeping only workspaces in the library (Trash
 * included) and modules that are still installed. A missing or unreadable
 * file gives empty workspaces. Version 1 files (panels without a layout)
 * are read as they are; the host UI places their panels.
 */
export async function loadWorkspace(
  file: string,
  workspaceIds: readonly string[],
  isInstalled: (moduleId: string) => boolean,
): Promise<WorkspaceState> {
  const state = emptyWorkspaces(workspaceIds);
  let saved: { workspaces?: Record<string, Partial<Record<keyof Workspace, unknown>>> };
  try {
    saved = JSON.parse(await readFile(file, "utf8")) as typeof saved;
  } catch {
    return state;
  }
  for (const workspaceId of workspaceIds) {
    const workspace = saved.workspaces?.[workspaceId];
    if (!isRecord(workspace)) continue;
    const instances = (Array.isArray(workspace.instances) ? workspace.instances : [])
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
    const snapshots = (Array.isArray(workspace.snapshots) ? workspace.snapshots : [])
      .map((snapshot) => parseSnapshot(snapshot, isInstalled))
      .filter((snapshot): snapshot is Snapshot => snapshot !== null)
      .slice(0, MAX_SNAPSHOTS);
    state.workspaces[workspaceId] = {
      instances,
      layout: pruneLayout(parseLayout(workspace.layout), (id) => open.has(id)),
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
  for (const workspace of Object.values(state.workspaces)) {
    for (const record of workspace.instances) {
      const panelType = settle(record.moduleId, record.panelType);
      if (panelType === undefined) delete record.panelType;
      else record.panelType = panelType;
    }
    for (const snapshot of workspace.snapshots) {
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

export interface WorkspacesOptions {
  /** Writes the workspace; called after every change with a copy the caller may keep. */
  save(state: WorkspaceState): void;
  /** Ids for new panels and snapshots; random by default. */
  newId?(): string;
  now?(): Date;
}

/**
 * Every workspace's open panels, layout and snapshots, and the rules for changing them. Each change saves
 * itself; one that replaces a layout the host UI has docked bumps `epoch`, so the host UI takes the new
 * one. Panels a change closes or opens are handed back, and the host starts or stops their views.
 */
export class Workspaces {
  private layoutEpoch = 0;
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly state: WorkspaceState,
    private readonly options: WorkspacesOptions,
  ) {
    this.newId = options.newId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  /** Bumped whenever a layout is replaced rather than docked by the host UI. */
  get epoch(): number {
    return this.layoutEpoch;
  }

  /** A workspace's panels, layout and snapshots; empty ones for a workspace that has none yet. */
  workspace(workspaceId: string): Workspace {
    return (this.state.workspaces[workspaceId] ??= emptyWorkspace());
  }

  panels(workspaceId: string): InstanceRecord[] {
    return this.workspace(workspaceId).instances;
  }

  /** The workspaces, by id, with a panel of this module. */
  workspacesUsing(moduleId: string): string[] {
    return Object.entries(this.state.workspaces)
      .filter(([, workspace]) => workspace.instances.some((record) => record.moduleId === moduleId))
      .map(([workspaceId]) => workspaceId);
  }

  /** Saves a change the host made to a panel's record (its content or type). */
  save(): void {
    this.options.save(structuredClone(this.state));
  }

  /** The host UI is to take the saved layout again, as when a workspace opens. */
  relayout(): void {
    this.layoutEpoch++;
  }

  settlePanelTypes(typesOf: (moduleId: string) => PanelTypesOf | undefined): void {
    settlePanelTypes(this.state, typesOf);
  }

  /** Empty panels and layouts for workspaces new to the library. */
  addWorkspaces(workspaceIds: readonly string[]): void {
    if (workspaceIds.length === 0) return;
    for (const id of workspaceIds) this.state.workspaces[id] = emptyWorkspace();
    this.save();
  }

  /** Forgets a workspace that left the library for good; answers with the panels it had. */
  forgetWorkspace(workspaceId: string): InstanceRecord[] {
    const records = this.state.workspaces[workspaceId]?.instances ?? [];
    delete this.state.workspaces[workspaceId];
    this.save();
    return records;
  }

  /** Adds a panel; the host UI docks it. */
  openPanel(workspaceId: string, record: InstanceRecord): void {
    const records = this.panels(workspaceId);
    if (records.length >= LAYOUT_LIMITS.panels) throw new WorkspaceError("error.panelLimit", { max: LAYOUT_LIMITS.panels });
    records.push(record);
    this.save();
  }

  /** Closes a panel, and its slot with it; false when it was not open. */
  closePanel(workspaceId: string, instanceId: string): boolean {
    const workspace = this.workspace(workspaceId);
    const index = workspace.instances.findIndex((record) => record.instanceId === instanceId);
    if (index < 0) return false;
    workspace.instances.splice(index, 1);
    workspace.layout = pruneLayout(workspace.layout, (id) => id !== instanceId);
    this.save();
    return true;
  }

  /**
   * Closes a module's panels, in one workspace or in every workspace, leaving their slots empty so the layout
   * stays. Answers with the panels it closed.
   */
  vacate(moduleId: string, workspaceId?: string): string[] {
    const workspaces = workspaceId === undefined ? Object.values(this.state.workspaces) : [this.workspace(workspaceId)];
    const closed: string[] = [];
    for (const workspace of workspaces) {
      const gone = new Set(workspace.instances.filter((record) => record.moduleId === moduleId).map((record) => record.instanceId));
      if (gone.size === 0) continue;
      workspace.instances = workspace.instances.filter((record) => !gone.has(record.instanceId));
      workspace.layout = vacateLayout(workspace.layout, (id) => gone.has(id));
      closed.push(...gone);
    }
    if (closed.length) this.replaced();
    return closed;
  }

  /** Forgets every panel whose module is not installed any more, slot and all. Answers with the panels it closed. */
  dropMissingModules(isInstalled: (moduleId: string) => boolean): string[] {
    const closed: string[] = [];
    for (const workspace of Object.values(this.state.workspaces)) {
      const gone = new Set(workspace.instances.filter((record) => !isInstalled(record.moduleId)).map((record) => record.instanceId));
      if (gone.size === 0) continue;
      workspace.instances = workspace.instances.filter((record) => !gone.has(record.instanceId));
      workspace.layout = pruneLayout(workspace.layout, (id) => !gone.has(id));
      closed.push(...gone);
    }
    if (closed.length) this.replaced();
    return closed;
  }

  /** Keeps the layout the host UI docked, without panels that are not open. */
  saveLayout(workspaceId: string, layout: SavedLayout | null): void {
    const workspace = this.workspace(workspaceId);
    const open = new Set(workspace.instances.map((record) => record.instanceId));
    workspace.layout = pruneLayout(layout, (id) => open.has(id));
    this.save();
  }

  /** Rearranges the open panels into a template's slots, in the order they are laid out now. */
  applyTemplate(workspaceId: string, template: LayoutTemplate | undefined): void {
    if (!template) throw new WorkspaceError("error.templateGone");
    const workspace = this.workspace(workspaceId);
    const laidOut = layoutPanels(workspace.layout);
    const rest = workspace.instances.map((record) => record.instanceId).filter((id) => !laidOut.includes(id));
    workspace.layout = templateLayout(template, [...laidOut, ...rest]);
    this.replaced();
  }

  /** Saves the current layout under a new name; answers with the snapshot's id. */
  saveSnapshot(workspaceId: string, name: string): string {
    const workspace = this.workspace(workspaceId);
    if (workspace.snapshots.length >= MAX_SNAPSHOTS) throw new WorkspaceError("error.layoutLimit", { max: MAX_SNAPSHOTS });
    const snapshot: Snapshot = { id: this.newId(), name: this.snapshotName(workspace, name), ...this.capture(workspace) };
    workspace.snapshots.push(snapshot);
    this.save();
    return snapshot.id;
  }

  /** Replaces a snapshot with the current layout; its name stays. */
  updateSnapshot(workspaceId: string, snapshotId: string): void {
    const workspace = this.workspace(workspaceId);
    Object.assign(this.snapshot(workspace, snapshotId), this.capture(workspace));
    this.save();
  }

  renameSnapshot(workspaceId: string, snapshotId: string, name: string): void {
    const workspace = this.workspace(workspaceId);
    this.snapshot(workspace, snapshotId).name = this.snapshotName(workspace, name, snapshotId);
    this.save();
  }

  deleteSnapshot(workspaceId: string, snapshotId: string): void {
    const workspace = this.workspace(workspaceId);
    const { id } = this.snapshot(workspace, snapshotId);
    workspace.snapshots = workspace.snapshots.filter((snapshot) => snapshot.id !== id);
    this.save();
  }

  /**
   * Replaces the open panels with the snapshot's. Panels of the same module are reused, the rest are
   * closed; module data is never touched. Answers with the panels that are new and those that closed.
   */
  applySnapshot(workspaceId: string, snapshotId: string): { opened: InstanceRecord[]; closed: InstanceRecord[] } {
    const workspace = this.workspace(workspaceId);
    const plan = planSnapshot(this.snapshot(workspace, snapshotId), workspace.instances, this.newId);
    const existing = new Set(workspace.instances.map((record) => record.instanceId));
    workspace.instances = plan.instances;
    workspace.layout = plan.layout;
    this.replaced();
    return { opened: plan.instances.filter((record) => !existing.has(record.instanceId)), closed: plan.close };
  }

  /** A layout was replaced: the host UI takes the new one. */
  private replaced(): void {
    this.layoutEpoch++;
    this.save();
  }

  private snapshot(workspace: Workspace, snapshotId: string): Snapshot {
    const found = workspace.snapshots.find((snapshot) => snapshot.id === snapshotId);
    if (!found) throw new WorkspaceError("error.layoutGone");
    return found;
  }

  /** A snapshot's name, trimmed; no two snapshots of a workspace share one, whatever the case. */
  private snapshotName(workspace: Workspace, name: string, except?: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new WorkspaceError("error.layoutNeedsName");
    const taken = workspace.snapshots.some((snapshot) => snapshot.id !== except && snapshot.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    if (taken) throw new WorkspaceError("error.layoutTaken", { name: trimmed });
    return trimmed;
  }

  /** The current layout as a snapshot body: placeholders named after the panels they came from. */
  private capture(workspace: Workspace): Pick<Snapshot, "layout" | "modules" | "panelTypes" | "savedAt"> {
    const layout = workspace.layout;
    const panels = layoutPanels(layout);
    if (!layout || panels.length === 0) throw new WorkspaceError("error.layoutNeedsModule");
    const recordOf = new Map(workspace.instances.map((record) => [record.instanceId, record]));
    const panelTypes = Object.fromEntries(panels.flatMap((id) => (recordOf.get(id)!.panelType ? [[id, recordOf.get(id)!.panelType!]] : [])));
    return {
      layout: structuredClone(layout),
      modules: Object.fromEntries(panels.map((id) => [id, recordOf.get(id)!.moduleId])),
      panelTypes,
      savedAt: this.now().toISOString(),
    };
  }
}
