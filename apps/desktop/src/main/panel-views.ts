import { dialogPictureKey } from "../shared/dialog-picture";
import type { InstanceStatus, PanelPicture, PanelPlacement } from "../shared/host-api";
import type { OverlayPanel } from "./game-overlay-window";
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

/**
 * How long to wait for a still image of a panel. A panel with none by then stays in sight under a menu or hint (an empty
 * slot would flash); for a dialog or a drag it steps aside all the same, or it would draw over them.
 */
export const FREEZE_TIMEOUT_MS = 600;
/** How long a picture stays under its panel after the panel drew and its background turned solid: a few frames, for both to reach the screen. */
export const FROZEN_GONE_MS = 50;
/** How old a picture taken ahead (prepareFreeze) may be when a menu opens: an older one would show the panel back in time. */
export const PREPARED_FRESH_MS = 200;
/** How far from where a menu is opened (its button, a hint's element) a panel may be and still have its picture taken ahead. */
export const PREPARE_REACH_PX = 360;
/** How many panels keep their last picture for when they come back to their slot; the oldest goes first. */
export const STAND_INS_KEPT = 8;

type Picture = PanelPicture;

/** Whether `rect` comes within `reach` of `other`. */
function reaches(rect: PanelRect, other: PanelRect, reach: number): boolean {
  return rect.x - reach < other.x + other.width && other.x < rect.x + rect.width + reach && rect.y - reach < other.y + other.height && other.y < rect.y + rect.height + reach;
}

function isRectLike(raw: unknown): raw is Record<keyof PanelRect, number> {
  const item = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<Record<keyof PanelRect, unknown>>;
  return [item.x, item.y, item.width, item.height].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

/**
 * A place on the window from the host UI, clamped to the window; null when it is none (negative, not a number, or
 * nothing left). With display scaling the place has fractions: its edges are rounded inwards, so the view never covers
 * the panel's 1px border next to it.
 */
export function clampRect(raw: unknown, size: { width: number; height: number }): PanelRect | null {
  if (!isRectLike(raw)) return null;
  const item = raw;
  // A hair of slack, so 99.9999 from the layout still counts as 100.
  const inwardStart = (n: number) => Math.ceil(n - 0.01);
  const inwardEnd = (n: number) => Math.floor(n + 0.01);
  const x = Math.min(inwardStart(item.x as number), size.width);
  const y = Math.min(inwardStart(item.y as number), size.height);
  const right = Math.min(inwardEnd((item.x as number) + (item.width as number)), size.width);
  const bottom = Math.min(inwardEnd((item.y as number) + (item.height as number)), size.height);
  const rect = { x, y, width: right - x, height: bottom - y };
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

/**
 * What Panel views needs from a panel's native view. ModuleView and BrowserPanel are the real ones; tests use a
 * fake that only counts calls.
 */
/** How far left of its place a panel's page waits while its dialog's frame is not shown yet. */
const OFFSCREEN_PX = 20000;
/** The longest the page waits out of sight for the host UI to show the frame. */
export const SHOW_DIALOG_CAP_MS = 1500;

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
  /** Resolves once the panel has drawn since it was last shown and nothing under it shows through any more. */
  readonly settled: Promise<void>;
  /** Whether a still image can stand in for the panel while a menu is open. */
  readonly capturable: boolean;
  /** The panel as a window of the in-game layer holds it, or null when it can't go there (a Browser panel, a page that is gone). */
  inGame(): OverlayPanel | null;
  setBounds(rect: PanelRect): void;
  setVisible(visible: boolean): void;
  suspend(): void;
  resume(): void;
  setInDialog(open: boolean): void;
  /** Gives the page the keyboard focus (a panel dialog's page, once placed). */
  focus(): void;
  setMaximized(maximized: boolean): void;
  /** A still image of the page as a data: URL, or null when there is none. */
  capture(): Promise<string | null>;
  /**
   * Closes the page for good. A module page may save for a moment first (at most CLOSE_CAP_MS); resolves once it is
   * closed. `now` closes it without waiting, for a panel whose data is being deleted.
   */
  dispose(now?: boolean): Promise<void>;
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
  /** The last view of a module went (closed or released): nothing of it is on screen or running now. */
  moduleGone?(moduleId: string): void;
  /** Whether the panel belongs to the workspace shown (a panel back from the in-game layer to another workspace is let go of). */
  shownHere(instanceId: string): boolean;
  /** Makes the view of a panel whose workspace isn't shown, for the in-game layer (`lend`); a panel that can't have one is left without. */
  openForGame?(instanceId: string, workspaceId: string): void;
  /** A panel's view is about to leave the window for the in-game layer: its tooltips and menus go. */
  lending?(instanceId: string): void;
  /** A panel is back in its slot from the in-game layer (the host UI shows it, a waiting dialog may open). */
  returned?(instanceId: string): void;
  /** The panel dialog closed (the host UI takes its frame away). */
  dialogClosed(instanceId: string): void;
  /** The panel's page in its dialog has drawn (or will not: it is hidden), so the host UI may show the frame. */
  dialogDrawn?(instanceId: string): void;
  /** The wait for a workspace's panels ended; `show`: the panels are placed now. */
  openingEnded(ended: { show: boolean; startedAt: number; tag: string }): void;
  /** Called first in every placement of the panels. */
  placing?(): void;
  /** A host menu, dialog or drag opens: tooltips and the opening cover go. */
  overlayOpening(): void;
  /**
   * The still images to show in the panels' slots under their views changed: while a host menu or dialog is over them,
   * and while a panel that comes back to its slot has not drawn yet. Only changes are sent (null: none any more).
   * `awaited`: the new ones Panel views waits on (frozenOnScreen).
   */
  frozen(changes: Record<string, Picture | null>, awaited: string[]): void;
  /** Resolves once the host UI shows the awaited images. */
  frozenOnScreen(): Promise<void>;
  /**
   * The panels asked for by the host UI's request `seq` are hidden and their pictures stand in for them: a host menu or
   * dialog can be drawn there without a view covering half of it.
   */
  overlayReady?(seq: number): void;
  windowGone(): boolean;
  /** The panels were shown again after a host menu or dialog (for timing logs). */
  shownAgain?(views: PanelViewAdapter[]): void;
  log?(line: string): void;
  now?(): number;
}

/** What holds a lent panel's view: a window of the in-game layer, which lets go of the view when it is destroyed. */
export interface PanelHolder {
  destroy(): void;
}

/**
 * A panel's view lent to the in-game layer (`lend`), held by `window` until it comes back to its slot. Each step happens
 * once: a step after the panel closed for good, or after it came back, does nothing more (a later lend is never touched).
 */
export interface PanelInGame<W extends PanelHolder> {
  readonly window: W;
  /** The window goes (destroyed first, so it lets go of the view), then the view is back in its slot. */
  end(): void;
  /** Only the view goes back to its slot: its window ended on its own, and is destroyed later with `end`. */
  giveBack(): void;
}

/** Why a panel runs out of sight: an overlay or panel item of the in-game overlays, or its game running (a `withGame` type). */
export type KeepReason = "overlay" | "game";

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
  /** Panels added by the same click as a later one (Add all, a layout): no welcome of their own. */
  private readonly noWelcome = new Set<string>();
  private readonly opened = new Map<string, OpenedFrom>();
  private readonly placements = new Map<string, PanelPlacement>();
  /** Panels that run out of sight, from any workspace, and why: for the overlays, or with their game (KeepReason). */
  private readonly keep = new Map<string, Set<KeepReason>>();
  /** Panels lent to the in-game layer: each lend, with what to tell the layer when the panel closes for good. */
  private readonly lent = new Map<string, { revoked: () => void }>();
  private openingState: { startedAt: number; timer: ReturnType<typeof setTimeout>; tag: string } | null = null;
  private overlayOpen = false;
  /** Counts host overlays opened and closed, so the work of one that ended never touches the next. */
  private overlaySession = 0;
  /** What the host UI asked to step aside while the overlay is open: every panel (a dialog, a drag) or only these (under a menu or hint). */
  private wanted: "all" | Set<string> = new Set();
  /** Panels hidden behind their pictures now. */
  private readonly out = new Set<string>();
  /** Panels whose pictures are being taken: they stay in sight until their picture is on screen. */
  private readonly picturing = new Set<string>();
  /** An overlay's steps run one after another, so each answer (overlayReady) comes after the one before. */
  private freezing: Promise<void> = Promise.resolve();
  /** Pictures standing in for panels hidden for a host menu, dialog or drag. */
  private readonly overlayPictures = new Map<string, Picture>();
  /**
   * The last picture of each panel that left its slot (another tab in front, its column collapsed, another group
   * maximized). It lies under the panel when it comes back, until the page has drawn: the slot never shows empty.
   */
  private readonly standIns = new Map<string, Picture>();
  private pictureGen = 0;
  /** What the host UI has been sent: each panel's picture number. */
  private sentPictures = new Map<string, number>();
  /** Panels shown in their slot now, to tell when one leaves it or comes back. */
  private readonly inSight = new Set<string>();
  /** Pictures taken ahead of a menu or dialog (prepareFreeze), by panel: what they must still match, when asked, and the picture with when it was taken. */
  private readonly prepared = new Map<string, { key: string; asked: number; taken: Promise<{ image: string | null; at: number }> }>();
  /**
   * A page dialog is open above the panel dialog (the host UI says so), so the panel's view stays out of sight. It follows
   * the host UI alone and is not reset when a dialog closes: one panel's dialog can give way to another's with a page
   * dialog still on top, and the host UI only reports a change.
   */
  private dialogCovered = false;
  /**
   * A menu of the panel in its dialog is open. The menu is drawn by the host page, under the panel's native view, so the
   * view steps aside: `picturing` while its picture goes into the dialog's frame, `out` once it is hidden behind it.
   */
  private dialogMenu: { step: "picturing" | "out" } | null = null;
  /** The picture standing in for the panel in its dialog while a menu is open, until the page has drawn again. */
  private dialogPicture: { instanceId: string; picture: Picture } | null = null;
  private dialogState: { instanceId: string; width: number; height: number; bounds: PanelRect | null; shown: boolean; still: Promise<string | null> } | null = null;

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

  /** Where the host UI docks a panel panels.openMany opened, with the others of that call. */
  setPlacement(instanceId: string, placement: PanelPlacement): void {
    this.placements.set(instanceId, placement);
  }

  placement(instanceId: string): PanelPlacement | undefined {
    return this.placements.get(instanceId);
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

  /** One click, one welcome: this panel came with another one from the same click, so it may not open its dialog on its own. */
  withholdWelcome(instanceId: string): void {
    this.noWelcome.add(instanceId);
  }

  /** Whether a panel just added may open its dialog once without a click (asked once, when its page starts). */
  takeWelcome(instanceId: string): boolean {
    return !this.noWelcome.delete(instanceId);
  }

  /**
   * The panel runs out of sight, from any workspace, and stays when its workspace is left: for the in-game overlays
   * (`overlay`), or while its game runs (`game`, host.ts syncWithGame). Each reason is let go of on its own.
   */
  keepRunning(instanceId: string, why: KeepReason = "overlay"): void {
    const reasons = this.keep.get(instanceId);
    if (reasons) reasons.add(why);
    else this.keep.set(instanceId, new Set([why]));
  }

  stopKeeping(instanceId: string, why: KeepReason = "overlay"): void {
    const reasons = this.keep.get(instanceId);
    if (!reasons) return;
    reasons.delete(why);
    if (reasons.size === 0) this.keep.delete(instanceId);
  }

  /**
   * Lets go of one reason the panel runs out of sight (`stopKeeping`); with none left, its view goes too (`release`),
   * unless its workspace is shown or it is lent to the in-game layer. It comes back with its workspace.
   */
  letGo(instanceId: string, why: KeepReason = "overlay"): void {
    this.stopKeeping(instanceId, why);
    if (!this.deps.shownHere(instanceId) && !this.lent.has(instanceId) && !this.keep.has(instanceId)) this.release(instanceId);
  }

  /** Kept for that reason, or for any when left out. */
  isKept(instanceId: string, why?: KeepReason): boolean {
    const reasons = this.keep.get(instanceId);
    return reasons !== undefined && (why === undefined || reasons.has(why));
  }

  /** The panels kept for that reason. */
  keptIds(why: KeepReason = "overlay"): string[] {
    return [...this.keep].filter(([, reasons]) => reasons.has(why)).map(([instanceId]) => instanceId);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  /**
   * The panel closes for good: its view, place, waiting, launch and keep state go. Settings and documents are not Panel
   * views'. `discard`: its data is being deleted, so its page doesn't get the moment to save, nor does a page of it
   * still saving from an earlier close.
   */
  close(instanceId: string, discard = false): void {
    this.remove(instanceId, "forget", discard);
    if (discard) for (const page of this.closing) if (page.instanceId === instanceId) void page.adapter.dispose(true);
  }

  /**
   * The panel is closed for good: its view goes now, and `forget` (deleting what it saved) runs only after its page has
   * closed, so the page's last save can't bring the saved file back.
   */
  closeForGood(instanceId: string, forget: () => Promise<void>): Promise<void> {
    this.close(instanceId);
    return this.closed(instanceId).then(forget);
  }

  /**
   * Resolves once every page of this panel that went has closed: until then it may still save what was typed just before
   * (up to CLOSE_CAP_MS), so what it saved is only safe to delete after this.
   */
  closed(instanceId: string): Promise<void> {
    return Promise.allSettled([...this.closing].filter((page) => page.instanceId === instanceId).map((page) => page.done)).then(() => undefined);
  }

  /** Pages of panels that went and may still be saving (at most CLOSE_CAP_MS): quitting waits for them too. */
  private readonly closing = new Set<{ instanceId: string; adapter: PanelViewAdapter; done: Promise<void> }>();

  /** Disposes a view that has left `entries`, keeping its page in `closing` until it has closed. */
  private disposeView(instanceId: string, adapter: PanelViewAdapter, now: boolean): Promise<void> {
    let done: Promise<void>;
    try {
      done = adapter.dispose(now);
    } catch (error) {
      // One page that fails to close must not keep the window open.
      console.error("[tavora] closing a panel failed", error);
      done = Promise.resolve();
    }
    const page = { instanceId, adapter, done };
    this.closing.add(page);
    void done.finally(() => this.closing.delete(page));
    return done;
  }

  /** Only the view goes (its workspace is left, or the overlays let it go); it comes back with its workspace. */
  release(instanceId: string): void {
    this.remove(instanceId, "release");
  }

  /**
   * The panel starts anew from another copy of its module (its id now loads for another owner): its view goes, and
   * what its page ran ends as on a close (questions, live state, a lend to the in-game layer), but it keeps its place,
   * where it was opened from and whether it runs for the overlays, so the view made next shows where it was.
   */
  restart(instanceId: string): void {
    this.remove(instanceId, "restart");
  }

  /** A workspace is left or Home shown: every view goes except those running in the in-game layer or kept for the overlays. */
  closeAll(): void {
    this.closeDialog();
    this.endOpening(false);
    for (const instanceId of this.entries.keys()) if (!this.lent.has(instanceId) && !this.keep.has(instanceId)) this.remove(instanceId, "release");
    this.bounds.clear();
  }

  /** The window goes or Tavora quits: every view is disposed. Resolves once their pages saved and closed (at most CLOSE_CAP_MS). */
  disposeAll(): Promise<void> {
    const entries = [...this.entries];
    this.entries.clear();
    this.byContents.clear();
    this.lent.clear();
    for (const [instanceId, { adapter }] of entries) void this.disposeView(instanceId, adapter, false);
    // Pages closed a moment ago and still saving are waited for too.
    return Promise.all([...this.closing].map((page) => page.done)).then(() => undefined);
  }

  /** `forget`: closed for good; `release`: only the view goes; `restart`: the page ends for good, the place stays. */
  private remove(instanceId: string, how: "forget" | "release" | "restart", discard = false): void {
    const forget = how === "forget";
    const ends = how !== "release";
    this.deps.releasing(instanceId, ends);
    if (forget) {
      this.keep.delete(instanceId);
      this.opened.delete(instanceId);
      this.placements.delete(instanceId);
    }
    if (ends) {
      this.waiting.delete(instanceId);
      this.launches.delete(instanceId);
      this.noWelcome.delete(instanceId);
    }
    const entry = this.entries.get(instanceId);
    // An Add is for the view made for it: a view made again later (its workspace opened again) starts as a restore, so
    // the Add's pass for a dialog without a click can't be kept for later.
    if (entry && this.launches.get(instanceId)?.reason === "add") {
      this.launches.delete(instanceId);
      this.noWelcome.delete(instanceId);
    }
    const adapter = entry?.adapter;
    if (entry && adapter) {
      this.entries.delete(instanceId);
      this.byContents.delete(adapter.webContentsId);
      if (this.dialogState?.instanceId === instanceId) this.closeDialog();
      // A panel in the layer is let go of by its window first (the window never closes the page, this does).
      if (ends) {
        const loan = this.lent.get(instanceId);
        this.lent.delete(instanceId);
        loan?.revoked();
      }
      this.deps.unmount(adapter);
      void this.disposeView(instanceId, adapter, discard);
      const { moduleId } = entry.record;
      if (![...this.entries.values()].some((other) => other.record.moduleId === moduleId)) this.deps.moduleGone?.(moduleId);
    }
    if (forget) this.bounds.delete(instanceId);
    this.inSight.delete(instanceId);
    this.out.delete(instanceId);
    this.picturing.delete(instanceId);
    this.prepared.delete(instanceId);
    this.standIns.delete(instanceId);
    this.overlayPictures.delete(instanceId);
    this.sendPictures();
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
    // Until the host UI shows the frame, the page is laid out of sight (far outside the window) so it can draw but not show bare.
    const inFrame = this.dialogState?.instanceId === instanceId && !this.dialogState.shown;
    if (rect) adapter.setBounds(dialog && inFrame ? { ...dialog, x: dialog.x - OFFSCREEN_PX } : rect);
    // Its panel shows a question in its place: the page waits, hidden, until it is answered.
    if (this.deps.asking(instanceId)) {
      this.followSight(instanceId, adapter, rect !== undefined, false);
      adapter.setVisible(false);
      adapter.suspend();
      return;
    }
    // A module page stays hidden until it has its data, so switching workspaces does not show it building itself;
    // while a workspace opens, every panel waits for the others.
    // (A page dialog above the panel's dialog hides the panel's view: it is a native view and would draw over it.)
    const visible = rect !== undefined && ((dialog !== undefined && !this.dialogCovered && this.dialogMenu?.step !== "out") || (dialog === undefined && !this.steppedAside(instanceId) && !this.openingState)) && adapter.revealed;
    const back = visible && dialog === undefined && !this.inSight.has(instanceId);
    this.followSight(instanceId, adapter, rect !== undefined, visible && dialog === undefined);
    adapter.setVisible(visible);
    if (back && this.standIns.has(instanceId)) this.liftStandIn(instanceId, adapter);
    // A panel kept running for the overlays isn't paused for being out of sight: its overlay goes on being fed. One
    // running with its game isn't paused at all, also while Tavora's window is minimized: the user is playing.
    if (this.isKept(instanceId, "game") || ((rect || this.keep.has(instanceId)) && !this.deps.windowHidden())) adapter.resume();
    else adapter.suspend();
  }

  /** Whether a panel's page may show a tooltip's source now (revealed, in its slot or its own dialog, nothing over it). */
  isShowing(instanceId: string): boolean {
    const adapter = this.get(instanceId);
    if (!adapter || this.deps.windowHidden() || !adapter.revealed || this.lent.has(instanceId)) return false;
    if (this.showsInDialog(instanceId)) return this.dialogMenu === null;
    return this.bounds.has(instanceId) && !this.overlayOpen && !this.openingState;
  }

  /** Whether a menu of this panel can be drawn over it now: in its slot with nothing over it, or in its own dialog. */
  mayShowMenu(instanceId: string): boolean {
    if (this.lent.has(instanceId)) return false;
    return this.showsInDialog(instanceId) || (this.bounds.has(instanceId) && !this.overlayOpen);
  }

  /** Where the panel's page is on the window now: in its dialog while it shows there, else its slot. */
  placeOf(instanceId: string): PanelRect | undefined {
    return this.showsInDialog(instanceId) ? this.dialogState!.bounds! : this.bounds.get(instanceId);
  }

  /** The panel is in its dialog, the frame is on screen, and no page dialog lies over it. */
  private showsInDialog(instanceId: string): boolean {
    const open = this.dialogState;
    return open?.instanceId === instanceId && open.bounds !== null && open.shown && !this.dialogCovered;
  }

  // ── The in-game layer ───────────────────────────────────────────────

  /**
   * Lends the panel's view to the in-game layer, in one step: the view leaves the window (its tooltips and menus go), and
   * `open` makes the window that holds it, which places, shows and pauses it there (`layOut` and the pictures skip a lent
   * panel) until `end` or `giveBack`. A panel whose workspace isn't shown gets a view made for the layer
   * (`openForGame`). `revoked` is called when the panel closes for good while lent. When `open` throws, the view is back
   * in its slot before the error goes on. Null when Tavora's window is gone, the panel can't go in the game (a Browser
   * panel, no view, a page that is gone) or it is lent already.
   */
  lend<W extends PanelHolder>(instanceId: string, workspaceId: string, open: (panel: OverlayPanel) => W, revoked: () => void): PanelInGame<W> | null {
    if (this.deps.windowGone()) return null;
    const existing = this.get(instanceId);
    if (existing && existing.kind !== "module") return null;
    if (!existing) this.deps.openForGame?.(instanceId, workspaceId);
    const adapter = this.get(instanceId);
    const panel = adapter?.inGame() ?? null;
    if (!adapter || !panel) return null;
    this.deps.lending?.(instanceId);
    if (this.lent.has(instanceId)) return null;
    const loan = { revoked };
    this.lent.set(instanceId, loan);
    this.inSight.delete(instanceId);
    this.dropStandIn(instanceId);
    this.deps.unmount(adapter);
    const giveBack = () => this.takeBack(instanceId, loan);
    let window: W;
    try {
      window = open(panel);
    } catch (error) {
      giveBack();
      throw error;
    }
    return {
      window,
      end: () => {
        window.destroy();
        giveBack();
      },
      giveBack,
    };
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

  /**
   * Back in the window and laid out at once; a panel whose workspace is not shown and that nothing keeps running is let
   * go of instead (as `letGo` does). Only this lend's, once.
   */
  private takeBack(instanceId: string, loan: { revoked: () => void }): void {
    if (this.lent.get(instanceId) !== loan) return;
    this.lent.delete(instanceId);
    const adapter = this.get(instanceId);
    // Not here any more: the panel itself is closing, or Tavora is.
    if (!adapter || this.deps.windowGone()) return;
    // The slot it comes back to is not on screen: the panel closes like any panel of a workspace that is left, and opens
    // again with its workspace. One kept for the overlays or with its game goes on running, hidden, as after closeAll.
    if (!this.deps.shownHere(instanceId) && !this.keep.has(instanceId)) return this.remove(instanceId, "release");
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
   * While a menu, dialog or drag is over the workspace, the module views under it (drawn above the host page) step aside.
   * Each first gets a still image in its slot, so the workspace looks the same underneath; only then is it hidden. `only`:
   * just these panels (the ones a menu or hint lies over), added to those already out; without it, every panel (a dialog,
   * a drag). Every request is answered with overlayReady(`seq`) once its panels are out, in the order asked.
   */
  freeze(open: boolean, only?: readonly string[], seq = 0): Promise<void> {
    if (!open) {
      if (!this.overlayOpen) return Promise.resolve();
      this.overlayOpen = false;
      this.overlaySession++;
      return this.thaw();
    }
    if (!this.overlayOpen) {
      this.deps.overlayOpening();
      this.overlayOpen = true;
      this.overlaySession++;
      this.wanted = new Set();
      this.freezing = Promise.resolve();
    }
    const session = this.overlaySession;
    const askedAt = this.now();
    const step = this.freezing.then(() => this.stepAside(session, only, seq, askedAt));
    this.freezing = step.catch(() => undefined);
    return step;
  }

  /** Whether the panel is out of the way of a host overlay: hidden behind its picture, or (under a dialog or drag) waiting for none. */
  private steppedAside(instanceId: string): boolean {
    return this.out.has(instanceId) || (this.overlayOpen && this.wanted === "all" && !this.picturing.has(instanceId));
  }

  private async stepAside(session: number, only: readonly string[] | undefined, seq: number, askedAt: number): Promise<void> {
    if (session !== this.overlaySession || this.deps.windowGone()) return;
    if (!only) this.wanted = "all";
    else if (this.wanted !== "all") for (const instanceId of only) this.wanted.add(instanceId);
    const wanted = this.wanted;
    const targets = [...this.entries].filter(([instanceId]) => !this.lent.has(instanceId) && !this.inDialog(instanceId) && !this.out.has(instanceId) && (wanted === "all" || wanted.has(instanceId)));
    const pictured = targets.filter(([instanceId, { adapter }]) => this.canBePictured(instanceId, adapter));
    const picturedIds = new Set(pictured.map(([instanceId]) => instanceId));
    for (const instanceId of picturedIds) this.picturing.add(instanceId);
    const images = new Map<string, string>();
    let ahead = 0;
    await Promise.all(
      pictured.map(async ([instanceId, { adapter }]) => {
        // A panel going into its dialog has already told its module, which may have changed the page: its picture is the one taken before.
        const taken = this.dialogState?.instanceId === instanceId ? { image: await this.dialogState.still, ahead: false } : await this.pictureAhead(instanceId, adapter);
        if (taken.ahead) ahead++;
        if (taken.image) images.set(instanceId, taken.image);
      }),
    );
    if (session !== this.overlaySession || this.deps.windowGone()) return;
    // A panel closed or restarted while its picture was taken is not this view any more: nothing of it is kept.
    for (const [instanceId, { adapter }] of pictured) if (this.get(instanceId) !== adapter) images.delete(instanceId);
    for (const [instanceId, image] of images) this.overlayPictures.set(instanceId, this.picture(image));
    this.sendPictures([...images.keys()]);
    // Hidden before their pictures are on screen, the panels' slots would show empty for a frame.
    if (images.size) await this.deps.frozenOnScreen();
    if (session !== this.overlaySession || this.deps.windowGone()) return;
    for (const [instanceId, { adapter }] of targets) {
      const now = this.get(instanceId);
      if (now !== adapter) {
        // Restarted while its picture was taken: the new view has no picture yet, and in sight it would draw over the menu.
        if (now && !this.lent.has(instanceId) && !this.inDialog(instanceId)) {
          this.out.add(instanceId);
          this.inSight.delete(instanceId);
          now.setVisible(false);
        }
        continue;
      }
      this.picturing.delete(instanceId);
      // A picture that came to nothing leaves the panel in sight under a menu, since its slot would show empty. Under a
      // dialog or drag it steps aside all the same: it would draw over them.
      if (!images.has(instanceId) && wanted !== "all" && picturedIds.has(instanceId)) continue;
      this.out.add(instanceId);
      this.inSight.delete(instanceId);
      adapter.setVisible(false);
    }
    this.deps.log?.(`overlay ${seq}: ${targets.length} panels out ${Math.round(this.now() - askedAt)} ms after asking (${ahead} pictures taken ahead, ${pictured.length - ahead} new)`);
    this.deps.overlayReady?.(seq);
  }

  /**
   * Starts taking the panels' pictures before a menu or dialog opens (the host UI calls it on a right-click, a press on a
   * menu button or entry, a hover that will show a hint), so it finds them ready and the panels step aside at once.
   * `near`: only panels a menu opened there could reach (a hint, a menu button); without it every panel (a dialog may
   * come). A panel whose picture was asked for a moment ago, or that is out already, is left alone.
   */
  prepareFreeze(near?: PanelRect): void {
    if (this.deps.windowGone()) return;
    const now = this.now();
    for (const [instanceId, { adapter }] of this.entries) {
      if (!this.canBePictured(instanceId, adapter) || this.out.has(instanceId) || this.picturing.has(instanceId)) continue;
      const bounds = this.bounds.get(instanceId)!;
      if (near && !reaches(near, bounds, PREPARE_REACH_PX)) continue;
      const key = this.pictureKey(instanceId, adapter);
      const before = this.prepared.get(instanceId);
      if (before && before.key === key && now - before.asked < PREPARED_FRESH_MS / 2) continue;
      this.prepared.set(instanceId, { key, asked: now, taken: this.pictureOf(adapter).then((image) => ({ image, at: this.now() })) });
    }
  }

  /** What a picture taken ahead must still match: where the panel is and what state it is in. */
  private pictureKey(instanceId: string, adapter: PanelViewAdapter): string {
    return JSON.stringify([this.bounds.get(instanceId) ?? null, adapter.status, adapter.revealed, this.dialogState?.instanceId === instanceId, this.openingState !== null]);
  }

  /** A panel in its slot, ready and drawn: a still image can stand in for it. */
  private canBePictured(instanceId: string, adapter: PanelViewAdapter): boolean {
    return !this.lent.has(instanceId) && this.bounds.has(instanceId) && adapter.status === "ready" && adapter.revealed && adapter.capturable;
  }

  /**
   * The picture taken ahead of the panel if it still matches and is fresh (it is used once), or a new one at once when
   * there is none, it came to nothing or it is too old by now.
   */
  private async pictureAhead(instanceId: string, adapter: PanelViewAdapter): Promise<{ image: string | null; ahead: boolean }> {
    const prepared = this.prepared.get(instanceId);
    if (prepared && prepared.key === this.pictureKey(instanceId, adapter)) {
      const taken = await prepared.taken;
      if (this.prepared.get(instanceId) === prepared) this.prepared.delete(instanceId);
      if (taken.image && this.now() - taken.at < PREPARED_FRESH_MS) return { image: taken.image, ahead: true };
    }
    return { image: await this.pictureOf(adapter), ahead: false };
  }

  /** A still image of the panel, or null when it takes longer than FREEZE_TIMEOUT_MS. */
  private pictureOf(adapter: PanelViewAdapter): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), FREEZE_TIMEOUT_MS)));
    return Promise.race([adapter.capture().catch(() => null), late]).finally(() => clearTimeout(timer));
  }

  /**
   * The overlay closed: the panels are shown again. Each stays see-through until it has drawn, and its picture stays in
   * the host UI under it until its background is solid again, so a slow one does not show empty for a moment. Each
   * picture goes as its own panel settles, and only the one this close left: a menu opened since put a newer one there.
   */
  private thaw(): Promise<void> {
    this.out.clear();
    this.picturing.clear();
    this.wanted = new Set();
    this.applyBounds();
    this.deps.shownAgain?.(this.inSlots());
    return Promise.all(
      [...this.overlayPictures].map(async ([instanceId, picture]) => {
        await this.settledThenGone(instanceId);
        if (this.overlayPictures.get(instanceId) !== picture || this.out.has(instanceId) || this.picturing.has(instanceId) || this.deps.windowGone()) return;
        this.overlayPictures.delete(instanceId);
        // One that left its slot meanwhile (another tab in front) keeps it to lie on when it comes back.
        const adapter = this.get(instanceId);
        if (adapter?.status === "ready" && !this.bounds.has(instanceId) && !this.lent.has(instanceId)) this.keepStandIn(instanceId, picture);
        this.sendPictures();
      }),
    ).then(() => undefined);
  }

  /** Resolves once the panel has drawn and turned solid (and FROZEN_GONE_MS more), so what lies under it may go. */
  private async settledThenGone(instanceId: string): Promise<void> {
    await this.get(instanceId)?.settled;
    await new Promise((resolve) => setTimeout(resolve, FROZEN_GONE_MS));
  }

  // ── Pictures under panels that come back to their slot ──────────────

  /**
   * Notes whether the panel is shown in its slot. A panel that leaves its slot while shown has its picture taken (asked
   * before the view is hidden, so it still has its last frame), to lie under it when it comes back.
   */
  private followSight(instanceId: string, adapter: PanelViewAdapter, placed: boolean, shown: boolean): void {
    const was = this.inSight.has(instanceId);
    if (shown) this.inSight.add(instanceId);
    else this.inSight.delete(instanceId);
    // Placed but kept hidden (no data yet, a question): its slot shows the loader or the question, never an old picture.
    if (!shown && placed && (!adapter.revealed || this.deps.asking(instanceId))) this.dropStandIn(instanceId);
    if (!was || shown || placed || adapter.status !== "ready" || !adapter.revealed || !adapter.capturable || this.lent.has(instanceId)) return;
    // No timer: a page that gives nothing (or gives it late) just has no picture to lie on.
    void adapter
      .capture()
      .catch(() => null)
      .then((image) => {
        if (!image || this.get(instanceId) !== adapter || this.inSight.has(instanceId) || this.bounds.has(instanceId) || this.deps.windowGone()) return;
        this.keepStandIn(instanceId, this.picture(image));
        this.sendPictures();
      });
  }

  /** Keeps a panel's last picture, newest last; only the last STAND_INS_KEPT panels keep one. */
  private keepStandIn(instanceId: string, picture: Picture): void {
    this.standIns.delete(instanceId);
    this.standIns.set(instanceId, picture);
    for (const oldest of this.standIns.keys()) {
      if (this.standIns.size <= STAND_INS_KEPT) break;
      this.standIns.delete(oldest);
    }
  }

  /** The panel is back in its slot: its last picture lies under it until it has drawn and turned solid; one that is not ready has none. */
  private liftStandIn(instanceId: string, adapter: PanelViewAdapter): void {
    const picture = this.standIns.get(instanceId);
    if (adapter.status !== "ready") return this.dropStandIn(instanceId);
    void this.settledThenGone(instanceId).then(() => {
      if (this.standIns.get(instanceId) === picture && this.inSight.has(instanceId)) this.dropStandIn(instanceId);
    });
  }

  private dropStandIn(instanceId: string): void {
    if (this.standIns.delete(instanceId)) this.sendPictures();
  }

  /** The theme changed: pictures taken before show the old colours, so none is kept. */
  forgetStandIns(): void {
    if (!this.standIns.size) return;
    this.standIns.clear();
    this.sendPictures();
  }

  private picture(url: string): Picture {
    return { url, gen: ++this.pictureGen };
  }

  /**
   * Tells the host UI which pictures to show under the views changed since last time (the overlay's, else a panel's
   * last one; null: none any more). `awaited`: new ones Panel views waits on (frozenOnScreen).
   */
  private sendPictures(awaited: string[] = []): void {
    if (this.deps.windowGone()) return;
    const shown = new Map([...this.standIns, ...this.overlayPictures]);
    if (this.dialogPicture) shown.set(dialogPictureKey(this.dialogPicture.instanceId), this.dialogPicture.picture);
    const changes: Record<string, Picture | null> = {};
    for (const [instanceId, picture] of shown) if (this.sentPictures.get(instanceId) !== picture.gen) changes[instanceId] = picture;
    for (const instanceId of this.sentPictures.keys()) if (!shown.has(instanceId)) changes[instanceId] = null;
    if (!Object.keys(changes).length) return;
    this.sentPictures = new Map([...shown].map(([instanceId, picture]) => [instanceId, picture.gen]));
    this.deps.frozen(changes, awaited);
  }

  private now(): number {
    return (this.deps.now ?? performance.now.bind(performance))();
  }

  // ── Panel dialog ────────────────────────────────────────────────────

  /** The panel shown big in a dialog over the workspace, how big it asked to be, and where the host UI put it. */
  get dialog(): { instanceId: string; width: number; height: number; bounds: PanelRect | null } | null {
    return this.dialogState;
  }

  /** Whether the panel is in its dialog, placed. */
  inDialog(instanceId: string): boolean {
    return this.dialogState?.instanceId === instanceId && this.dialogState.bounds !== null;
  }

  /**
   * The panel may go in a dialog: it is in sight in the workspace, or (`unplaced`, for the Overlay page) it runs in the
   * background with no slot, and its dialog is over that page. Opens it (a dialog already open closes) unless the panel has it.
   * The panel's module hears of the dialog only once its still image is taken (a panel with no slot has none), so the image
   * shows the page as it was before the module switched it to what the dialog shows.
   */
  openDialog(instanceId: string, size: { width: number; height: number }, unplaced = false): boolean {
    const adapter = this.get(instanceId);
    if (!adapter || adapter.kind !== "module" || (!unplaced && !this.bounds.has(instanceId)) || this.lent.has(instanceId)) return false;
    if (this.dialogState?.instanceId === instanceId) return false;
    this.closeDialog();
    const still = this.canBePictured(instanceId, adapter) ? this.pictureOf(adapter) : Promise.resolve(null);
    const state = { instanceId, ...size, bounds: null, shown: false, still };
    this.dialogState = state;
    void still.then(() => {
      if (this.dialogState === state) adapter.setInDialog(true);
    });
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
    const first = open.bounds === null;
    if (first) this.deps.mount(adapter);
    open.bounds = rect;
    this.layOut(open.instanceId, adapter);
    // The frame's own focus trap took the keys when it opened; the page, once in the frame, takes them over.
    if (first) void adapter.drawn.then(() => this.dialogState === open && this.deps.dialogDrawn?.(open.instanceId));
    // Only for this opening: a dialog closed and opened again meanwhile waits for its own frame.
    if (first) setTimeout(() => this.dialogState === open && this.showDialog(open.instanceId), SHOW_DIALOG_CAP_MS);
  }

  /** The host UI's frame is on screen (or took too long): the page moves into it, in the same step, and takes the keys. */
  showDialog(instanceId: string): void {
    const open = this.dialogState;
    const adapter = open && this.get(open.instanceId);
    if (!open || !adapter || open.instanceId !== instanceId || open.shown || open.bounds === null) return;
    open.shown = true;
    this.layOut(open.instanceId, adapter);
    // The frame's own focus trap took the keys when it opened; the page, once in the frame, takes them over.
    if (adapter.revealed && !this.dialogCovered && !this.deps.asking(open.instanceId)) adapter.focus();
  }

  /** A page dialog opened above the panel dialog, or the last one closed: the panel's view steps aside or comes back. */
  coverDialog(covered: boolean): void {
    if (covered === this.dialogCovered) return;
    this.dialogCovered = covered;
    // A tooltip of the panel floats above every view: it goes when the page dialog comes over the panel.
    if (covered) this.deps.placing?.();
    const open = this.dialogState;
    if (open?.bounds) this.layOut(open.instanceId);
  }

  /**
   * A menu of the panel in its dialog opens: its picture goes into the frame, then its view steps aside, so the menu the
   * host page draws lies above it. Resolves once the menu may be drawn. With no picture the view steps aside all the same.
   */
  async openDialogMenu(instanceId: string): Promise<void> {
    const open = this.dialogState;
    const adapter = this.get(instanceId);
    if (!open || !adapter || !this.showsInDialog(instanceId)) return;
    const menu: { step: "picturing" | "out" } = { step: "picturing" };
    this.dialogMenu = menu;
    const image = adapter.status === "ready" && adapter.revealed && adapter.capturable ? await this.pictureOf(adapter) : null;
    if (this.dialogMenu !== menu || this.dialogState !== open || this.deps.windowGone()) return;
    if (image) {
      this.dialogPicture = { instanceId, picture: this.picture(image) };
      this.sendPictures([dialogPictureKey(instanceId)]);
      await this.deps.frozenOnScreen();
      if (this.dialogMenu !== menu || this.dialogState !== open || this.deps.windowGone()) return;
    }
    menu.step = "out";
    this.layOut(instanceId, adapter);
  }

  /** The menu over the panel's dialog closed: the view comes back, and its picture goes once the page has drawn. */
  closeDialogMenu(): void {
    if (!this.dialogMenu) return;
    this.dialogMenu = null;
    const open = this.dialogState;
    if (!open) return;
    this.layOut(open.instanceId);
    const shown = this.dialogPicture;
    if (!shown) return;
    void this.settledThenGone(shown.instanceId).then(() => {
      if (this.dialogPicture !== shown) return;
      this.dialogPicture = null;
      this.sendPictures();
    });
  }

  /** Puts the panel in its dialog back in its slot (only `instanceId`'s, when given). */
  closeDialog(instanceId?: string): void {
    const open = this.dialogState;
    if (!open || (instanceId !== undefined && open.instanceId !== instanceId)) return;
    this.dialogState = null;
    this.dialogMenu = null;
    if (this.dialogPicture) {
      this.dialogPicture = null;
      this.sendPictures();
    }
    this.deps.dialogClosed(open.instanceId);
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
