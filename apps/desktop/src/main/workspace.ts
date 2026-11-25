import { randomUUID } from "node:crypto";
import { isPanelTypeId } from "@tavora/module-schema";
import { INSTANCE_ID } from "./ids";
import { unknownFields } from "./json";
import { UserError } from "./messages";
import { gridTemplate, type LayoutTemplate } from "../shared/layout-templates";
import { LAYOUT_LIMITS, layoutPanels, parseSavedLayout, pruneLayout, templateLayout, vacateLayout, type SavedLayout } from "./layout";
import { checkPanelContent, type PanelContent } from "./panel-content";
import { SAVED_FILES, SavedFile } from "./saved-file";
import { isRecord } from "../shared/is-record";

export { INSTANCE_ID } from "./ids";

export interface InstanceRecord {
  instanceId: string;
  moduleId: string;
  /** Which of the module's panel types this panel is; left out for a module without types. */
  panelType?: string;
  /** What the panel last said it shows (panel.setContent); kept across workspace switches and restarts. */
  content?: PanelContent;
  /**
   * The owner (publisher) the panel's page last ran as, whose its content and panel state are: when the module id loads
   * for another owner, the panel starts without them (host.ts settleOwner). Missing in a file from before it was noted.
   */
  owner?: string;
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
  /**
   * Entries of the file for workspaces the library doesn't list (it may have been lost), exactly as read. Nothing uses
   * them; they are written back into `workspaces`, so a library brought back finds its layouts. In memory only.
   */
  unlisted?: Record<string, unknown>;
}

/** A problem with the workspace that the user can fix; its message is shown as-is. */
export class WorkspaceError extends UserError {}

export const MAX_SNAPSHOTS = 50;
export const MAX_SNAPSHOT_NAME = 80;

/** A deleted snapshot with where it was, kept for Undo. */
export interface RemovedSnapshot {
  workspaceId: string;
  index: number;
  snapshot: Snapshot;
}

/** The name, or with " (2)", " (3)" … after it when another snapshot has it now (names are compared ignoring case). */
export function freeName(snapshots: readonly Snapshot[], name: string): string {
  const taken = new Set(snapshots.map((snapshot) => snapshot.name.toLocaleLowerCase()));
  if (!taken.has(name.toLocaleLowerCase())) return name;
  for (let number = 2; ; number++) {
    const suffix = ` (${number})`;
    const candidate = `${name.slice(0, MAX_SNAPSHOT_NAME - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

export function emptyWorkspace(): Workspace {
  return { instances: [], layout: null, snapshots: [] };
}

// The fields this Tavora knows, per record. The rest (a newer Tavora's) are kept as they were and written back.
const STATE_FIELDS = Object.keys({ version: true, workspaces: true, unlisted: true } satisfies Record<keyof WorkspaceState, true>);
const WORKSPACE_FIELDS = Object.keys({ instances: true, layout: true, snapshots: true } satisfies Record<keyof Workspace, true>);
const INSTANCE_FIELDS = Object.keys({ instanceId: true, moduleId: true, panelType: true, content: true, owner: true } satisfies Record<keyof InstanceRecord, true>);

/** An owner as a panel's record notes it (a publisher key's fingerprint, local, official). */
const isOwner = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 200;
const SNAPSHOT_FIELDS = Object.keys({ id: true, name: true, savedAt: true, layout: true, modules: true, panelTypes: true } satisfies Record<keyof Snapshot, true>);

export function emptyWorkspaces(workspaceIds: readonly string[]): WorkspaceState {
  return { version: 3, workspaces: Object.fromEntries(workspaceIds.map((id) => [id, emptyWorkspace()])) };
}


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
  const layout = pruneLayout(parseSavedLayout(raw.layout), (slot) => slot in modules);
  if (!layout) return null;
  for (const slot of Object.keys(modules)) if (!layoutPanels(layout).includes(slot)) delete modules[slot];
  const panelTypes: Record<string, string> = {};
  if (isRecord(raw.panelTypes)) {
    for (const [slot, type] of Object.entries(raw.panelTypes)) if (slot in modules && isPanelTypeId(type)) panelTypes[slot] = type;
  }
  return { ...unknownFields(raw, SNAPSHOT_FIELDS), id, name, savedAt, layout, modules, ...(Object.keys(panelTypes).length ? { panelTypes } : {}) };
}

/** One saved workspace, with only panels of modules that are still installed. */
function parseWorkspace(workspace: Partial<Record<keyof Workspace, unknown>>, isInstalled: (moduleId: string) => boolean): Workspace {
  const instances = (Array.isArray(workspace.instances) ? workspace.instances : [])
    .filter(
      (record): record is InstanceRecord =>
        typeof record?.instanceId === "string" &&
        INSTANCE_ID.test(record.instanceId) &&
        typeof record.moduleId === "string" &&
        isInstalled(record.moduleId),
    )
    .map((record): InstanceRecord => {
      const { instanceId, moduleId, panelType, content, owner } = record;
      const checked = checkPanelContent(content);
      return {
        ...unknownFields(record, INSTANCE_FIELDS),
        instanceId,
        moduleId,
        ...(isPanelTypeId(panelType) ? { panelType } : {}),
        ...(checked ? { content: checked } : {}),
        ...(isOwner(owner) ? { owner } : {}),
      };
    });
  const open = new Set(instances.map((record) => record.instanceId));
  const snapshots = (Array.isArray(workspace.snapshots) ? workspace.snapshots : [])
    .map((snapshot) => parseSnapshot(snapshot, isInstalled))
    .filter((snapshot): snapshot is Snapshot => snapshot !== null)
    .slice(0, MAX_SNAPSHOTS);
  return {
    ...unknownFields(workspace, WORKSPACE_FIELDS),
    instances,
    layout: pruneLayout(parseSavedLayout(workspace.layout), (id) => open.has(id)),
    snapshots,
  };
}

/**
 * Reads the saved workspace, using only workspaces in the library (Trash
 * included) and modules that are still installed. Entries of other workspaces
 * are kept as they were and written back (`unlisted`): the library may have
 * been lost, and they are the layouts it would bring back. A missing file gives
 * empty workspaces; an unreadable one is set aside first, and one a newer Tavora
 * wrote is copied aside (SavedFile). Version 1 files (panels
 * without a layout) are read as they are; the host UI places their panels.
 * Fields this Tavora doesn't know, at the top, on a workspace, a panel or a
 * snapshot, are kept as they were and saved again (a newer Tavora's).
 */
export async function loadWorkspace(
  file: string | SavedFile,
  workspaceIds: readonly string[],
  isInstalled: (moduleId: string) => boolean,
): Promise<WorkspaceState> {
  const state = emptyWorkspaces(workspaceIds);
  const saved = (await workspaceFile(file).read()) as { workspaces?: Record<string, Partial<Record<keyof Workspace, unknown>>> } | null;
  if (!saved) return state;
  for (const workspaceId of workspaceIds) {
    const workspace = saved.workspaces?.[workspaceId];
    if (isRecord(workspace)) state.workspaces[workspaceId] = parseWorkspace(workspace, isInstalled);
  }
  const listed = new Set(workspaceIds);
  const unlisted = Object.fromEntries(Object.entries(isRecord(saved.workspaces) ? saved.workspaces : {}).filter(([id]) => !listed.has(id)));
  return { ...unknownFields(saved, STATE_FIELDS), ...state, ...(Object.keys(unlisted).length ? { unlisted } : {}) };
}

/**
 * The panels the workspace file holds for workspaces the library lists: those loaded, and those of a workspace kept
 * aside (`unlisted`) that the library lists again, as one whose time in Trash ran out at this start but whose files
 * couldn't be deleted, so it went back to Trash (hunt 2026-11-25 A3). Their saved state stays.
 */
export function listedPanelIds(state: WorkspaceState, listed: (workspaceId: string) => boolean): string[] {
  const ids = Object.values(state.workspaces).flatMap((workspace) => workspace.instances.map((record) => record.instanceId));
  for (const [workspaceId, kept] of Object.entries(state.unlisted ?? {})) {
    if (!listed(workspaceId) || !isRecord(kept) || !Array.isArray(kept.instances)) continue;
    for (const record of kept.instances) if (isRecord(record) && typeof record.instanceId === "string") ids.push(record.instanceId);
  }
  return ids;
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

/**
 * Notes an owner on every panel from before owners were noted: the one its panel state names (`stampOf`, what its page
 * saved last), else the owner its module is loaded for now (`ownerOf`), as what it left counts as that owner's. A panel
 * whose state names another owner than its module's now starts without what that owner left (host.ts settleOwner).
 * True when one was noted.
 */
export function noteOwners(state: WorkspaceState, ownerOf: (moduleId: string) => string | undefined, stampOf?: (instanceId: string) => string | undefined): boolean {
  let noted = false;
  for (const workspace of Object.values(state.workspaces)) {
    for (const record of workspace.instances) {
      const owner = record.owner === undefined ? (stampOf?.(record.instanceId) ?? ownerOf(record.moduleId)) : undefined;
      if (owner === undefined) continue;
      record.owner = owner;
      noted = true;
    }
  }
  return noted;
}

/** workspace.json, kept by the save rules (SavedFile); SavedData keeps one open, so what it read decides what it writes. */
export function workspaceFile(file: string | SavedFile): SavedFile {
  return typeof file === "string" ? new SavedFile(file, SAVED_FILES["workspace.json"]) : file;
}

/** Writes the workspace file whole or not at all, like the other data files. */
export async function saveWorkspace(file: string | SavedFile, state: WorkspaceState): Promise<void> {
  const { unlisted, ...saved } = state;
  await workspaceFile(file).write(unlisted ? { ...saved, workspaces: { ...unlisted, ...saved.workspaces } } : saved);
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

/** How long saveSoon holds a change back. */
export const SAVE_SOON_MS = 250;

export interface WorkspacesOptions {
  /** Writes the workspace; called after every change with a copy the caller may keep. */
  save(state: WorkspaceState): void;
  /** Ids for new panels and snapshots; random by default. */
  newId?(): string;
  now?(): Date;
  /** Which modules a workspace added back may keep its panels of, as when a start reads them. All by default. */
  isInstalled?(moduleId: string): boolean;
}

/**
 * Every workspace's open panels, layout and snapshots, and the rules for changing them. Each change saves
 * itself; one that replaces a layout the host UI has docked bumps `epoch`, so the host UI takes the new
 * one. Panels a change closes or opens are handed back, and the host starts or stops their views.
 */
export class Workspaces {
  private layoutEpoch = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
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
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.options.save(structuredClone(this.state));
  }

  /**
   * Saves a change that may come in a burst, such as a page that keeps changing what its panel shows: at most once
   * every SAVE_SOON_MS, however often it is called.
   */
  saveSoon(): void {
    this.saveTimer ??= setTimeout(() => this.save(), SAVE_SOON_MS);
  }

  /** Saves now what saveSoon still holds back, before the saved data is flushed. */
  flush(): void {
    if (this.saveTimer !== undefined) this.save();
  }

  /** The host UI is to take the saved layout again, as when a workspace opens. */
  relayout(): void {
    this.layoutEpoch++;
  }

  settlePanelTypes(typesOf: (moduleId: string) => PanelTypesOf | undefined): void {
    settlePanelTypes(this.state, typesOf);
  }

  /** See noteOwners; saved when one was noted. */
  noteOwners(ownerOf: (moduleId: string) => string | undefined): void {
    if (noteOwners(this.state, ownerOf)) this.saveSoon();
  }

  /** Workspaces new to the library: empty, or with the panels and layout the file still holds for them (`unlisted`). */
  addWorkspaces(workspaceIds: readonly string[]): void {
    if (workspaceIds.length === 0) return;
    const isInstalled = (moduleId: string) => this.options.isInstalled?.(moduleId) ?? true;
    for (const id of workspaceIds) {
      const kept = this.state.unlisted?.[id];
      this.state.workspaces[id] = isRecord(kept) ? parseWorkspace(kept, isInstalled) : emptyWorkspace();
      delete this.state.unlisted?.[id];
    }
    this.save();
  }

  /**
   * Gives a workspace that has no panels yet its starter: these panels side by side, one slot each. The host
   * UI docks them when the workspace opens. Nothing happens for a workspace that already has a panel.
   */
  start(workspaceId: string, records: readonly InstanceRecord[]): void {
    const workspace = this.workspace(workspaceId);
    if (records.length === 0 || workspace.instances.length > 0) return;
    workspace.instances = [...records];
    workspace.layout = templateLayout(gridTemplate(records.length, 1), records.map((record) => record.instanceId));
    this.save();
  }

  /** Forgets a workspace that left the library for good; answers with the panels it had. */
  forgetWorkspace(workspaceId: string): InstanceRecord[] {
    const records = this.state.workspaces[workspaceId]?.instances ?? [];
    delete this.state.workspaces[workspaceId];
    // Trash emptied at start: the library no longer lists it, and this is the delete.
    delete this.state.unlisted?.[workspaceId];
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

  /** Deletes a snapshot; answers with it and where it was, so the delete can be undone (restoreSnapshot). */
  deleteSnapshot(workspaceId: string, snapshotId: string): RemovedSnapshot {
    const workspace = this.workspace(workspaceId);
    const snapshot = this.snapshot(workspace, snapshotId);
    const index = workspace.snapshots.indexOf(snapshot);
    workspace.snapshots = workspace.snapshots.filter((other) => other.id !== snapshot.id);
    this.save();
    return { workspaceId, index, snapshot: structuredClone(snapshot) };
  }

  /**
   * Undo of deleteSnapshot: the snapshot comes back into its workspace (wherever the user is now) at the place it had,
   * with its id, name and panels. A layout saved under its name since keeps that name; the one coming back gets a
   * number after it. False when it can't come back: its workspace was deleted for good, it is back already, or the
   * workspace has as many layouts as it can hold.
   */
  restoreSnapshot(removed: RemovedSnapshot): boolean {
    const workspace = this.state.workspaces[removed.workspaceId];
    if (!workspace || workspace.snapshots.length >= MAX_SNAPSHOTS || workspace.snapshots.some((other) => other.id === removed.snapshot.id)) return false;
    const snapshot = { ...structuredClone(removed.snapshot), name: freeName(workspace.snapshots, removed.snapshot.name) };
    workspace.snapshots.splice(Math.min(removed.index, workspace.snapshots.length), 0, snapshot);
    this.save();
    return true;
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
