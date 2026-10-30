import type { InstanceStatus } from "../shared/host-api";
import { INSTANCE_ID } from "./ids";
import { LAYOUT_LIMITS } from "./layout";
import type { PanelLaunch } from "./panel-content";
import type { HotkeyListener } from "./streaming";

export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A panel that opened another one (a Browser tab), so the host UI docks the new one beside it. */
export interface OpenedFrom {
  instanceId: string;
  background: boolean;
}

/** How long to wait for a still image of a panel before hiding it anyway. */
export const FREEZE_TIMEOUT_MS = 250;
/** How long after the panels said they drew the still images stay under them. */
export const FROZEN_GONE_MS = 250;

function isRectLike(raw: unknown): raw is Record<keyof PanelRect, number> {
  const item = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof PanelRect, unknown>>;
  return [item.x, item.y, item.width, item.height].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

/** A place on the window from the host UI, clamped to the window; null when it is none (negative, not a number, or nothing left). */
export function clampRect(raw: unknown, size: { width: number; height: number }): PanelRect | null {
  if (!isRectLike(raw)) return null;
  const item = raw;
  const x = Math.min(Math.round(item.x as number), size.width);
  const y = Math.min(Math.round(item.y as number), size.height);
  const rect = { x, y, width: Math.min(Math.round(item.width as number), size.width - x), height: Math.min(Math.round(item.height as number), size.height - y) };
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * What Panel views needs from a panel's native view. ModuleView and BrowserPanel are the real ones; tests use a
 * fake that only counts calls.
 */
export interface PanelViewAdapter {
  readonly kind: "module" | "browser";
  /** The panel as a hotkey hears it, for a module panel; a Browser panel has none. */
  readonly hotkeys?: HotkeyListener;
  /** The native view, for `mount` and `unmount`; Panel views never looks inside. */
  readonly view: object;
  readonly webContentsId: number;
  readonly status: InstanceStatus;
  /** False while a module page has no data to show; a Browser panel is always revealed. */
  readonly revealed: boolean;
  /** False from a new page's start until it has drawn once. */
  readonly firstDrawn: boolean;
  /** Resolves once the panel has drawn since it was last shown. */
  readonly drawn: Promise<void>;
  /** Whether a still image can stand in for the panel while a menu is open. */
  readonly capturable: boolean;
  setBounds(rect: PanelRect): void;
  setVisible(visible: boolean): void;
  suspend(): void;
  resume(): void;
  setInDialog(open: boolean): void;
  setMaximized(maximized: boolean): void;
  /** A still image of the page as a data: URL, or null when there is none. */
  capture(): Promise<string | null>;
  dispose(): void;
}

/** What `open` builds: the adapter, and how it joins the window once it is registered. */
export interface MadePanelView {
  adapter: PanelViewAdapter;
  start(): void;
}

export interface PanelViewsDeps {
  /** Puts a panel's native view in the window, above the others. */
  mount(adapter: PanelViewAdapter): void;
  unmount(adapter: PanelViewAdapter): void;
  windowSize(): { width: number; height: number };
  windowHidden(): boolean;
  /** Whether the panel shows a question in its place: its page waits, hidden. */
  asking(instanceId: string): boolean;
  /** A panel is about to go (tooltips, menus and its live state belong to the host). `forget`: for good. */
  releasing(instanceId: string, forget: boolean): void;
  /** Whether the panel belongs to the workspace shown (a panel back from the in-game layer to another workspace is let go of). */
  shownHere(instanceId: string): boolean;
  /** A panel is back in its slot from the in-game layer (the host UI shows it, a waiting dialog may open). */
  returned?(instanceId: string): void;
  /** The panel dialog closed (the host UI takes its frame away). */
  dialogClosed(): void;
  /** The wait for a workspace's panels ended; `show`: the panels are placed now. */
  openingEnded(ended: { show: boolean; startedAt: number; tag: string }): void;
  /** Called first in every placement of the panels. */
  placing?(): void;
  /** A host menu, dialog or drag opens: tooltips and the opening cover go. */
  overlayOpening(): void;
  /** The still images of the panels, to show in their slots while the overlay is open. */
  frozen(images: Record<string, string>): void;
  /** Resolves once the host UI shows those images. */
  frozenOnScreen(): Promise<void>;
  windowGone(): boolean;
  /** The panels were shown again after a host menu or dialog (for timing logs). */
  shownAgain?(views: PanelViewAdapter[]): void;
  log?(line: string): void;
  now?(): number;
}

/** A panel's view lent to the in-game layer: it holds the view until `return` puts it back in its slot. */
export interface PanelLease {
  readonly view: PanelViewAdapter;
  /** Gives the view back, laid out where its workspace last put it; does nothing when it was given back or the panel closed. */
  return(): void;
}

export interface PanelViewState {
  kind: "module" | "browser";
  status: InstanceStatus;
  revealed: boolean;
  firstDrawn: boolean;
  /** Lent to the in-game layer. */
  lent: boolean;
  /** Has a place in its workspace slot. */
  placed: boolean;
  awaiting: boolean;
  kept: boolean;
  openedFrom: OpenedFrom | null;
}

export interface PanelViewsSnapshot {
  opening: boolean;
  overlay: boolean;
  dialog: { instanceId: string; width: number; height: number; placed: boolean } | null;
  panels: Record<string, PanelViewState>;
}

interface Entry {
  record: { instanceId: string; moduleId: string };
  adapter: PanelViewAdapter;
}

/**
 * The owner of every open panel's native lifecycle: which record has which view, where the host UI placed it, whether it
 * is shown, paused or hidden (the workspace opening, a host menu, a panel dialog, the window), and the one way a panel
 * is cleaned up. Host routes actions here and builds the host UI's state from `snapshot`.
 */
export class PanelViews {
  private readonly entries = new Map<string, Entry>();
  private readonly byContents = new Map<number, PanelViewAdapter>();
  private bounds = new Map<string, PanelRect>();
  private readonly waiting = new Set<string>();
  private readonly launches = new Map<string, PanelLaunch>();
  private readonly opened = new Map<string, OpenedFrom>();
  private readonly keep = new Set<string>();
  /** Panels lent to the in-game layer, with what to tell it when the panel closes for good. */
  private readonly lent = new Map<string, () => void>();
  private openingState: { startedAt: number; timer: ReturnType<typeof setTimeout>; tag: string } | null = null;
  private overlayOpen = false;
  private overlayChanges = 0;
  private dialogState: { instanceId: string; width: number; height: number; bounds: PanelRect | null } | null = null;

  constructor(private readonly deps: PanelViewsDeps) {}

  // ── Records and views ───────────────────────────────────────────────

  /** Makes the panel's view unless it has one (a panel lent to the in-game layer keeps its own). It starts hidden and paused. */
  open(record: { instanceId: string; moduleId: string }, make: () => MadePanelView): PanelViewAdapter | undefined {
    if (this.entries.has(record.instanceId)) return undefined;
    const { adapter, start } = make();
    this.entries.set(record.instanceId, { record, adapter });
    // Hidden and paused until the host UI says where the panel goes.
    adapter.setVisible(false);
    adapter.suspend();
    start();
    return adapter;
  }

  has(instanceId: string): boolean {
    return this.entries.has(instanceId);
  }

  get(instanceId: string): PanelViewAdapter | undefined {
    return this.entries.get(instanceId)?.adapter;
  }

  get size(): number {
    return this.entries.size;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  adapters(): PanelViewAdapter[] {
    return [...this.entries.values()].map((entry) => entry.adapter);
  }

  /** The panel whose page has these contents (what a page's own requests are judged by). */
  byWebContents(contentsId: number): PanelViewAdapter | undefined {
    return this.byContents.get(contentsId);
  }

  /** `contentsId` belongs to the panel's page now (a Browser page is replaced when its session changes). */
  bindContents(adapter: PanelViewAdapter, contentsId: number): void {
    this.byContents.set(contentsId, adapter);
  }

  /** The contents are gone; only if they still belong to `adapter`. */
  unbindContents(adapter: PanelViewAdapter, contentsId: number): void {
    if (this.byContents.get(contentsId) === adapter) this.byContents.delete(contentsId);
  }

  // ── Per-panel state that lives and dies with the panel ──────────────

  /** A panel added while its module still misses access it needs; its page starts once the user allows. */
  setAwaiting(instanceId: string): void {
    this.waiting.add(instanceId);
  }

  isAwaiting(instanceId: string): boolean {
    return this.waiting.has(instanceId);
  }

  /** True when the panel was waiting. */
  stopAwaiting(instanceId: string): boolean {
    return this.waiting.delete(instanceId);
  }

  setOpenedFrom(instanceId: string, from: OpenedFrom): void {
    this.opened.set(instanceId, from);
  }

  openedFrom(instanceId: string): OpenedFrom | undefined {
    return this.opened.get(instanceId);
  }

  /** Why the panel's page loads, kept until it first asks. */
  setLaunch(instanceId: string, launch: PanelLaunch): void {
    this.launches.set(instanceId, launch);
  }

  takeLaunch(instanceId: string): PanelLaunch | undefined {
    const launch = this.launches.get(instanceId);
    this.launches.delete(instanceId);
    return launch;
  }

  /** The panel runs for the in-game overlays, from any workspace, and stays when its workspace is left. */
  keepRunning(instanceId: string): void {
    this.keep.add(instanceId);
  }

  stopKeeping(instanceId: string): void {
    this.keep.delete(instanceId);
  }

  isKept(instanceId: string): boolean {
    return this.keep.has(instanceId);
  }

  keptIds(): string[] {
    return [...this.keep];
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  /** The panel closes for good: its view, place, waiting, launch and keep state go. Settings and documents are not Panel views'. */
  close(instanceId: string): void {
    this.remove(instanceId, true);
  }

  /** Only the view goes (its workspace is left, or the overlays let it go); it comes back with its workspace. */
  release(instanceId: string): void {
    this.remove(instanceId, false);
  }

  /** A workspace is left or Home shown: every view goes except those running in the in-game layer or kept for the overlays. */
  closeAll(): void {
    this.closeDialog();
    this.endOpening(false);
    for (const instanceId of this.entries.keys()) if (!this.lent.has(instanceId) && !this.keep.has(instanceId)) this.remove(instanceId, false);
    this.bounds.clear();
  }

  /** The window is gone: the views are disposed with it. */
  disposeAll(): void {
    for (const { adapter } of this.entries.values()) adapter.dispose();
    this.entries.clear();
    this.byContents.clear();
    this.lent.clear();
  }

  private remove(instanceId: string, forget: boolean): void {
    this.deps.releasing(instanceId, forget);
    if (forget) {
      this.keep.delete(instanceId);
      this.opened.delete(instanceId);
      this.waiting.delete(instanceId);
      this.launches.delete(instanceId);
    }
    const adapter = this.entries.get(instanceId)?.adapter;
    if (adapter) {
      this.entries.delete(instanceId);
      this.byContents.delete(adapter.webContentsId);
      if (this.dialogState?.instanceId === instanceId) this.closeDialog();
      // A panel in the layer is let go of by its window first (the window never closes the page, this does).
      if (forget) {
        const revoked = this.lent.get(instanceId);
        this.lent.delete(instanceId);
        revoked?.();
      }
      this.deps.unmount(adapter);
      adapter.dispose();
    }
    if (forget) this.bounds.delete(instanceId);
  }

  // ── Places ──────────────────────────────────────────────────────────

  /** Takes the visible panels' places from the host UI (anything may be in `raw`). Panels it leaves out are hidden. */
  place(raw: unknown): void {
    if (!Array.isArray(raw) || raw.length > LAYOUT_LIMITS.panels) return;
    const size = this.deps.windowSize();
    const bounds = new Map<string, PanelRect>();
    for (const item of raw as Partial<PanelRect & { instanceId: unknown; maximized: unknown }>[]) {
      const id = item?.instanceId;
      // A panel that waits for a permission answer has no page yet; its place is kept for when the page starts.
      if (typeof id !== "string" || !INSTANCE_ID.test(id) || (!this.entries.has(id) && !this.waiting.has(id))) continue;
      if (!isRectLike(item)) continue;
      const rect = clampRect(item, size);
      if (rect) bounds.set(id, rect);
      // Panels left out keep what they knew: a tab behind another in a maximized group still fills the workspace.
      this.entries.get(id)?.adapter.setMaximized((item as { maximized?: unknown }).maximized === true);
    }
    this.bounds = bounds;
    this.applyBounds();
  }

  boundsOf(instanceId: string): PanelRect | undefined {
    return this.bounds.get(instanceId);
  }

  /** Whether the host UI gave the panel a place. */
  isPlaced(instanceId: string): boolean {
    return this.bounds.has(instanceId);
  }

  placedCount(): number {
    return this.bounds.size;
  }

  /**
   * Places every view where the host UI showed it. Panels in a background tab are hidden and paused, as are all panels
   * while the window is. A panel over the game is placed, shown and paused by its overlay window, not by this slot.
   */
  applyBounds(): void {
    this.deps.placing?.();
    if (this.openingState && this.openingDone()) return this.endOpening(true);
    for (const [instanceId, { adapter }] of this.entries) {
      if (this.lent.has(instanceId)) continue;
      this.layOut(instanceId, adapter);
    }
  }

  /** Puts one panel's view where the workspace last said it goes, and shows, pauses or resumes it accordingly. */
  layOut(instanceId: string, adapter: PanelViewAdapter | undefined = this.get(instanceId)): void {
    if (!adapter) return;
    // A panel in its dialog is placed there and stays in sight above the dimmed app, while the others step aside.
    const dialog = this.dialogState?.instanceId === instanceId ? (this.dialogState.bounds ?? undefined) : undefined;
    const rect = dialog ?? this.bounds.get(instanceId);
    if (rect) adapter.setBounds(rect);
    // Its panel shows a question in its place: the page waits, hidden, until it is answered.
    if (this.deps.asking(instanceId)) {
      adapter.setVisible(false);
      adapter.suspend();
      return;
    }
    // A module page stays hidden until it has its data, so switching workspaces does not show it building itself;
    // while a workspace opens, every panel waits for the others.
    adapter.setVisible(rect !== undefined && (dialog !== undefined || (!this.overlayOpen && !this.openingState)) && adapter.revealed);
    // A panel kept running for the overlays isn't paused for being out of sight: its overlay goes on being fed.
    if ((rect || this.keep.has(instanceId)) && !this.deps.windowHidden()) adapter.resume();
    else adapter.suspend();
  }

  /** Whether a panel's page may show a tooltip's source now (placed, revealed, nothing over it). */
  isShowing(instanceId: string): boolean {
    const adapter = this.get(instanceId);
    return !!adapter && this.bounds.has(instanceId) && !this.overlayOpen && !this.openingState && !this.deps.windowHidden() && adapter.revealed && !this.lent.has(instanceId);
  }

  // ── The in-game layer ───────────────────────────────────────────────

  /**
   * Hands the panel's view to the in-game layer, which places, shows and pauses it in its own window until the lease is
   * returned (`layOut` and the pictures skip a lent panel). `revoked` is called when the panel closes for good while lent.
   * Nothing when the panel has no view or is lent already.
   */
  lend(instanceId: string, revoked: () => void): PanelLease | undefined {
    const adapter = this.get(instanceId);
    if (!adapter || this.lent.has(instanceId)) return undefined;
    this.lent.set(instanceId, revoked);
    this.deps.unmount(adapter);
    return { view: adapter, return: () => this.takeBack(instanceId) };
  }

  /** Whether the panel is lent to the in-game layer. */
  isLent(instanceId: string): boolean {
    return this.lent.has(instanceId);
  }

  /** Whether the panel with these contents is lent to the in-game layer. */
  isLentContents(contentsId: number): boolean {
    const adapter = this.byContents.get(contentsId);
    return !!adapter && [...this.entries].some(([instanceId, entry]) => entry.adapter === adapter && this.lent.has(instanceId));
  }

  /** Back in the window and laid out at once; a panel whose workspace is not shown is let go of instead. */
  private takeBack(instanceId: string): void {
    if (!this.lent.delete(instanceId)) return;
    const adapter = this.get(instanceId);
    // Not here any more: the panel itself is closing, or Tavora is.
    if (!adapter || this.deps.windowGone()) return;
    // The slot it comes back to is not on screen: the panel closes like any panel of a workspace that is left, and opens again with its workspace.
    if (!this.deps.shownHere(instanceId)) return this.remove(instanceId, false);
    this.deps.mount(adapter);
    adapter.setVisible(false);
    this.layOut(instanceId, adapter);
    this.applyBounds();
    this.deps.returned?.(instanceId);
  }

  // ── Opening ─────────────────────────────────────────────────────────

  /** A workspace just opened: no panel is shown until every module panel placed has its data, or `capMs` passed. */
  startOpening(capMs: number, tag: string): void {
    this.endOpening(false);
    this.openingState = { startedAt: (this.deps.now ?? performance.now.bind(performance))(), timer: setTimeout(() => this.endOpening(true), capMs), tag };
  }

  get opening(): boolean {
    return this.openingState !== null;
  }

  /** The workspace has opened once the host UI placed its panels and every placed module page has its data. */
  private openingDone(): boolean {
    if (this.bounds.size === 0) return false;
    for (const instanceId of this.bounds.keys()) {
      const adapter = this.entries.get(instanceId)?.adapter;
      if (adapter && adapter.kind === "module" && !adapter.revealed) return false;
    }
    return true;
  }

  /** Ends the wait for a workspace's panels; `show` places them (the host UI takes its loading cover away). */
  endOpening(show: boolean): void {
    if (!this.openingState) return;
    const { startedAt, timer, tag } = this.openingState;
    clearTimeout(timer);
    this.openingState = null;
    if (show) this.applyBounds();
    this.deps.openingEnded({ show, startedAt, tag });
  }

  /** The module panels placed in their workspace slots now. */
  inSlots(): PanelViewAdapter[] {
    return [...this.entries].flatMap(([instanceId, { adapter }]) => (adapter.kind === "module" && this.bounds.has(instanceId) && !this.lent.has(instanceId) ? [adapter] : []));
  }

  // ── Host menus and dialogs over the workspace ───────────────────────

  get overlay(): boolean {
    return this.overlayOpen;
  }

  /**
   * While a menu, dialog or drag is over the workspace, module views (which are drawn above the host page) are hidden. The
   * host UI first gets a still image of each, so the workspace looks the same underneath.
   */
  async freeze(open: boolean): Promise<void> {
    if (open === this.overlayOpen) return;
    if (open) this.deps.overlayOpening();
    this.overlayOpen = open;
    const change = ++this.overlayChanges;
    if (!open) return this.thaw(change);
    const images: Record<string, string> = {};
    const started = (this.deps.now ?? performance.now.bind(performance))();
    await Promise.all(
      [...this.entries].map(async ([instanceId, { adapter }]) => {
        if (this.lent.has(instanceId) || !this.bounds.has(instanceId) || adapter.status !== "ready" || !adapter.revealed || !adapter.capturable) return;
        const image = await Promise.race([adapter.capture().catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), FREEZE_TIMEOUT_MS))]);
        if (image) images[instanceId] = image;
      }),
    );
    if (change !== this.overlayChanges || this.deps.windowGone()) return;
    this.deps.frozen(images);
    const taken = (this.deps.now ?? performance.now.bind(performance))();
    // Hidden before their pictures are on screen, the panels' slots would show empty for a frame.
    if (Object.keys(images).length) await this.deps.frozenOnScreen();
    this.deps.log?.(`overlay: ${Object.keys(images).length} of ${this.inSlots().length} pictures taken in ${Math.round(taken - started)} ms`);
    if (change !== this.overlayChanges || this.deps.windowGone()) return;
    for (const [instanceId, { adapter }] of this.entries) if (!this.lent.has(instanceId) && !this.inDialog(instanceId)) adapter.setVisible(false);
  }

  /**
   * The overlay closed: the panels are shown again. Each stays see-through until it has drawn, and its picture stays in
   * the host UI under it until then, so a slow one does not show empty for a moment.
   */
  private thaw(change: number): Promise<void> {
    this.applyBounds();
    const shown = this.inSlots();
    this.deps.shownAgain?.(shown);
    return Promise.all(shown.map((view) => view.drawn))
      // Taken away as soon as the panels said they drew, the pictures could leave their slots empty for a frame.
      .then(() => new Promise((resolve) => setTimeout(resolve, FROZEN_GONE_MS)))
      .then(() => {
        if (change === this.overlayChanges && !this.deps.windowGone()) this.deps.frozen({});
      });
  }

  // ── Panel dialog ────────────────────────────────────────────────────

  /** The panel shown big in a dialog over the app, how big it asked to be, and where the host UI put it. */
  get dialog(): { instanceId: string; width: number; height: number; bounds: PanelRect | null } | null {
    return this.dialogState;
  }

  /** Whether the panel is in its dialog, placed. */
  inDialog(instanceId: string): boolean {
    return this.dialogState?.instanceId === instanceId && this.dialogState.bounds !== null;
  }

  /** The panel may go in a dialog: it is in sight in the workspace. Opens it (a dialog already open closes) unless the panel has it. */
  openDialog(instanceId: string, size: { width: number; height: number }): boolean {
    const adapter = this.get(instanceId);
    if (!adapter || adapter.kind !== "module" || !this.bounds.has(instanceId) || this.lent.has(instanceId)) return false;
    if (this.dialogState?.instanceId === instanceId) return false;
    this.closeDialog();
    this.dialogState = { instanceId, ...size, bounds: null };
    adapter.setInDialog(true);
    return true;
  }

  /** The host UI's frame is on screen: the panel's page goes into it, above every other view. */
  placeDialog(raw: unknown): void {
    const open = this.dialogState;
    const adapter = open && this.get(open.instanceId);
    if (!open || !adapter) return;
    if (!isRectLike(raw)) return;
    const rect = { x: Math.round(raw.x), y: Math.round(raw.y), width: Math.round(raw.width), height: Math.round(raw.height) };
    if (rect.width < 1 || rect.height < 1) return;
    if (open.bounds === null) this.deps.mount(adapter);
    open.bounds = rect;
    this.layOut(open.instanceId, adapter);
  }

  /** Puts the panel in its dialog back in its slot (only `instanceId`'s, when given). */
  closeDialog(instanceId?: string): void {
    const open = this.dialogState;
    if (!open || (instanceId !== undefined && open.instanceId !== instanceId)) return;
    this.dialogState = null;
    this.deps.dialogClosed();
    const adapter = this.get(open.instanceId);
    adapter?.setInDialog(false);
    this.layOut(open.instanceId, adapter);
  }

  // ── State for the host UI ───────────────────────────────────────────

  snapshot(): PanelViewsSnapshot {
    const panels: Record<string, PanelViewState> = {};
    for (const [instanceId, { adapter }] of this.entries) {
      panels[instanceId] = {
        kind: adapter.kind,
        status: adapter.status,
        revealed: adapter.revealed,
        firstDrawn: adapter.firstDrawn,
        lent: this.lent.has(instanceId),
        placed: this.bounds.has(instanceId),
        awaiting: this.waiting.has(instanceId),
        kept: this.keep.has(instanceId),
        openedFrom: this.opened.get(instanceId) ?? null,
      };
    }
    const dialog = this.dialogState;
    return {
      opening: this.openingState !== null,
      overlay: this.overlayOpen,
      dialog: dialog ? { instanceId: dialog.instanceId, width: dialog.width, height: dialog.height, placed: dialog.bounds !== null } : null,
      panels,
    };
  }
}
