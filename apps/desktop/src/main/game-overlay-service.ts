// Game overlays as a whole (game-overlays.ts has the setups, game-overlay-window.ts the windows): looks every moment at
// which window is in front, shows the items of the setups on screen, and runs the in-game layer.
//
// Setups (docs/features/overlay-setups.md): Everywhere shows over any app, also over the desktop, except while
// Tavora's own window is in front. Over a game in front, its own setup shows next to it, or All games when it has none.
// An item is shown once: one that is in Everywhere and in the game's setup shows as the game's setup has it.
//
// Two kinds of items. Overlays are a module's overlay page, always there (or with a key of their own), click-through.
// Panels are whole panels the user chose to show; they appear only while the user holds the layer open with the one
// global key: a veil over the game window (over the screen, with no game in front), every panel on screen on top of it
// taking input, and every overlay with its frame to move, resize or close. Closing the layer puts everything back:
// panels return to their workspace slots, overlays are click-through again, and the game gets the keyboard back.
//
// Tavora only reads which window is in front (foreground.ts) and draws its own windows above it.
import type { GameOverlayResult, JsonValue } from "@tavora/sdk/protocol";
import type { GameOverlaysView } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { DEFAULT_RECT, anchorOf, contentScale, type AnchoredRect, type LegacyRect } from "../shared/overlay-anchor";
import type { GridSetting } from "../shared/layout-math";
import { HostError } from "./errors";
import type { Foreground, ForegroundProbe } from "./foreground";
import type { GameOverlayWindow } from "./game-overlay-window";
import {
  ALL_GAMES,
  EVERYWHERE,
  GameOverlayStore,
  LAYER_OWNER,
  LEGACY_ARRANGE_ACTION,
  OVERLAY_LAYER_ACTION,
  OVERLAY_TOGGLE_ACTION,
  RESERVED_KEY_PREFIX,
  gameInFront,
  isGameSetup,
  isLive,
  isRealWindow,
  itemId,
  landingSetup,
  liveWindowId,
  looksExclusive,
  overlayId,
  overlayVisible,
  startRect,
  panelWindowId,
  placeItem,
  sameOverlay,
  setupsOnScreen,
  type AddResult,
  type GameOverlay,
  type GameOverlayChange,
  type GameOverlaySubject,
  type InGamePanel,
  type InGamePanelChange,
  type ItemRef,
  type Opacity,
  type OverlayScope,
  type Rect,
  type SeenSize,
} from "./game-overlays";
import type { GameOverlaySource } from "./game-overlay-page";
import type { VeilWindow } from "./game-veil-window";
import type { HotkeyRecord, ShortcutRegistry } from "./hotkeys";
import type { OverlayPage, OverlayStore, OverlaySubject } from "./overlays";
import type { StreamingModule } from "./streaming";

/** The part of a game overlay's window the service drives (a test stands in for Electron). */
export type OverlayWindow = Pick<GameOverlayWindow, "setRect" | "setShown" | "setArranging" | "setHideFromCapture" | "setOpacity" | "destroy" | "dragging"> &
  Partial<Pick<GameOverlayWindow, "focused" | "focusPanel" | "raise" | "setZoom">>;

/** Which overlay or panel an item of the Overlay layout is. */
export type LayoutItemRef = ItemRef;

/** One overlay or panel of a setup as the Overlay layout sees it. */
export interface LayoutItemInfo {
  /** Stable text for the item (overlayId, or panelWindowId). */
  id: string;
  ref: LayoutItemRef;
  /** The module's name and the overlay's key when the module has several in this place, or the panel's name. */
  name: string;
  moduleId: string;
  /** Where it comes from: a game workspace ("game") or a personal one ("all"). */
  scope: OverlayScope;
  mode: "always" | "toggle";
  opacity: Opacity;
  hideFromCapture: boolean;
  rect: AnchoredRect;
  /** Set while the position is not converted yet (the fractions of the window): the layout places it on its canvas the old way. */
  legacy?: LegacyRect;
  hotkey: { accelerator: string; taken: boolean } | null;
  /** Toggled on by its key right now (matters for mode toggle). */
  toggledOn: boolean;
  /** Where its page is served from; null when there is no page to show (a panel whose module has no overlay page). */
  source: GameOverlaySource | null;
  /** What the key of the item is kept under (the hotkey dialog is asked with it). */
  keyTarget: GameOverlaySubject;
}

/** The part of the service the Overlay layout works with (a test stands in for it). */
export interface LayoutSource {
  items(setupId: string): LayoutItemInfo[];
  /** Every setup's id: Everywhere, All games, then the games that have one. */
  setups(): string[];
  seenSize(gameId: string): SeenSize | undefined;
  /** The window handle of the game's window, while the game is running and its window was seen in front since it started; else null. */
  handleOf(gameId: string): string | null;
  /** Whether the game watcher says the game is running. */
  gameRunning(gameId: string): boolean;
  /** Where the game's window is on screen now or was last seen (DIPs), or null. */
  gameWindow(): Rect | null;
  /** The games running now, the one in front first. */
  running(): string[];
  grid(): GridSetting;
  setGrid(grid: GridSetting): void;
  /** Add overlay: a game workspace gets a setup of its own. */
  addSetup(gameId: string): boolean;
  /** A panel goes into a setup, at the size its module prefers; "refused" when it may not go there. */
  addPanel(setupId: string, panel: { owner: string; moduleId: string; workspaceId: string; instanceId: string }): AddResult;
  /** An item of a personal workspace moves between Everywhere and All games with its place and settings. */
  move(ref: LayoutItemRef, from: string, to: string): AddResult | "missing";
  setRect(setupId: string, ref: LayoutItemRef, rect: AnchoredRect): boolean;
  /** The size a new item of this kind starts with in a window of this size (Reset size), in units of the window's height. */
  startSize(ref: LayoutItemRef, window: { width: number; height: number }): { width: number; height: number };
  setOverlay(setupId: string, subject: GameOverlaySubject, change: GameOverlayChange): void;
  setPanel(setupId: string, instanceId: string, change: InGamePanelChange): void;
  remove(setupId: string, ref: LayoutItemRef): void;
  layerOpen(): boolean;
}

/** What a window shows and tells back; the service hands it to `openWindow`. */
export interface OverlayWindowRequest {
  /** Names the overlay, for the window's sessions. */
  id: string;
  page(): OverlayPage | null;
  state(): JsonValue | null;
  /** Null when the overlay has no link to hear from, so the page's stream ends and the page asks again. */
  watch(fn: (state: JsonValue | null | undefined) => void): (() => void) | null;
  /** The area the item sits in (the game window, or the screen for Everywhere); a drag stays inside it. */
  gameBounds(): Rect | null;
  moved(rect: Rect): void;
  closeRequested(): void;
  /** The user pressed the frame's Overlay layout button. */
  layoutRequested(): void;
  ended(): void;
  frameText(): { name: string; closeLabel: string; layoutLabel: string };
}

export interface GameOverlayServiceOptions {
  userData: string;
  overlays: OverlayStore;
  /** Whether Tavora can show game overlays here (Windows). */
  supported: boolean;
  /** The Game overlays switch in Settings > Overlays. */
  enabled(): boolean;
  module(moduleId: string): StreamingModule | undefined;
  /** A workspace's name. */
  workspaceName(workspaceId: string): string | null;
  gameIds?(): string[];
  /** Whether a workspace is a game workspace (kind "game"), not a personal one. Something made in the latter may go into any setup. */
  scopeOf(workspaceId: string): OverlayScope;
  /** The library games a program belongs to (game-watch.ts). */
  gamesOf(program: string): Set<string>;
  /** Looks at the window in front; made when first needed. */
  probe(): ForegroundProbe;
  /** Physical pixels of the screen to the DIPs windows are placed in. */
  toDip(rect: Rect): Rect;
  /** Overlays stay over the game window's spot while the user is in another window (Settings > Overlays). */
  stay?(): boolean;
  /** Which side of the Overlay page the sidebar sits on (Settings > Overlays). */
  sidebar?(): "left" | "right";
  /** The main screen (DIPs): Everywhere's area, and what a new item is sized against before any game window was seen. */
  screen?(): Rect;
  /** Whether one of Tavora's windows has the keyboard (its main window, a dialog); the service tells its own overlay windows apart. Everywhere hides then. */
  tavoraInFront?(): boolean;
  openWindow(request: OverlayWindowRequest): OverlayWindow;
  /** The veil over the game window (or the screen) while the layer is open. */
  openVeil(): VeilWindow;
  /** The host's side of panels in the game; Tavora without it has none. */
  panels?: {
    /** The name of a panel's tab, or null once the panel is gone. */
    name(instanceId: string): string | null;
    /** Whether the panel still exists in its workspace. */
    exists(workspaceId: string, instanceId: string): boolean;
    /** Whether the panel's type still allows being shown in the game (`inGame`); true when that isn't known yet. */
    allowed?(workspaceId: string, instanceId: string): boolean;
    /** When the panel was used last, to give the keyboard to the newest one. */
    usedAt(instanceId: string): number;
    /** The window holding the panel (moved out of its workspace slot); null when the panel is gone. */
    openWindow(request: OverlayWindowRequest & { instanceId: string; workspaceId: string }): OverlayWindow | null;
    /** The size the panel's module prefers (its viewport, in pixels), or null; Reset size in the Overlay layout starts from it. */
    preferred?(workspaceId: string, instanceId: string): { width?: number | undefined; height?: number | undefined } | null;
  };
  shortcuts: ShortcutRegistry;
  /** Opens Settings at one of its settings. */
  openSetting(setting: string): void;
  /** Opens the Overlay page on a setup (the button on the in-game layer's frames). */
  openLayout?(setupId: string | null): void;
  /** Tells the user something (Tavora's notice and a system notification). */
  notify(message: string): void;
  /** Takes away the hotkeys matching `test`. */
  removeKeys(test: (record: HotkeyRecord) => boolean): void;
  /** Takes away the hotkeys matching `test`, but gives the layer key the key of the one set last, if the layer has none. */
  moveKey(test: (record: HotkeyRecord) => boolean, to: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "action" | "target">): void;
  /** The key set for a binding, as Streaming holds it. */
  keyOf(binding: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "action" | "target">): { accelerator: string; taken: boolean } | null;
  language(): Language;
  /** Something the Settings page or the hotkeys depend on changed. */
  changed(): void;
  /** What the Overlay layout shows of the games' windows changed (a window was seen, a game stopped): it looks again. */
  windowsChanged?(): void;
  /** How often the window in front is looked at. */
  everyMs?: number;
}

export const LOOK_MS = 400;
/** A window whose setup is not on screen is closed after this long (it is made again when the setup is back). */
export const IDLE_CLOSE_MS = 30_000;
/** A page that crashed this many times within CRASH_SPAN_MS is not made again until the user shows or toggles it. */
export const MAX_CRASHES = 3;
export const CRASH_SPAN_MS = 5 * 60_000;

/** The hotkey binding of the layer key, and of one item's toggle key (an item has one key, whichever setups it is in). */
export const layerBinding = () => ({ owner: LAYER_OWNER, moduleId: LAYER_OWNER, workspaceId: ALL_GAMES, action: OVERLAY_LAYER_ACTION, target: "layer" });
export const toggleBinding = (overlay: GameOverlaySubject) => ({ owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, action: OVERLAY_TOGGLE_ACTION, target: overlay.key });

/** Whether a hotkey is one of game overlays (they are listed in Settings > Overlays, not in Streaming). */
export const isOverlayAction = (action: string) => action === OVERLAY_TOGGLE_ACTION || action === OVERLAY_LAYER_ACTION;

interface Open {
  /** `live`: the overlay page of a panel, shown read-only in the panel's spot while the layer is closed. */
  kind: "overlay" | "panel" | "live";
  window: OverlayWindow;
  /** The setup the item is shown from now: its place and settings are that setup's. */
  setup: string;
  opacity: Opacity;
  hideFromCapture: boolean;
  arranging: boolean;
  shown: boolean;
  /** When the window was shown last, to tell which of several panel windows is the newest. */
  shownOrder: number;
  /** The content zoom the window was given (contentScale of the area's height); 1 until set. */
  zoom: number;
  /** Since when the window is hidden because its setup is not on screen; null while it is. */
  idleSince: number | null;
  instanceId?: string;
}

/** An item on screen: the setup it shows from, with its settings there. */
type Placed<T> = { setup: string; item: T };

export class GameOverlays {
  private readonly open = new Map<string, Open>();
  private readonly toggled = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private probe: ForegroundProbe | null = null;
  /** The game in front that has something to show, and where its window is (DIPs). */
  private front: string | null = null;
  private game: Rect | null = null;
  /** The last game window seen in front: a panel shown in the game while Tavora is in front is sized against it. */
  private lastGame: Rect | null = null;
  /** The game seen in front last, and its window while the user is in another one and overlays stay (`stay`). */
  private left: string | null = null;
  private away: { gameId: string; bounds: Rect } | null = null;
  /** One of Tavora's own windows (not an overlay's) is in front: Everywhere hides. */
  private tavoraFront = false;
  /** The in-game layer while it is open: over the game in front, or over the screen (`game` null) with no game in front. */
  private layer: { game: string | null } | null = null;
  /** The window handle of the game window in front (when known), and of whatever window is in front. */
  private frontWindow: string | null = null;
  private foregroundWindow: string | null = null;
  /** The window handle of each game's window as last seen in front (in memory only), to take its picture on a click. */
  private readonly handles = new Map<string, string>();
  /** The library games the game watcher says are running (game-watch.ts); a handle only counts for these. */
  private running: ReadonlySet<string> = new Set();
  /** The window the layer opened over; it ends when another one comes in front. */
  private layerWindow: string | null = null;
  private notification: number | null = null;
  private veil: VeilWindow | null = null;
  private escape = false;
  /** "Hide all for now": nothing shows until Tavora starts again or the user shows it again. */
  private suspended = false;
  /** Whether something showed at the last look: the keys are told when that changes. */
  private wasShowing = false;
  private shownCount = 0;
  /** Whether any window is shown over a game or the screen now (`GameOverlaysView.showing`). */
  private windowsShown = false;
  /** When each overlay's page crashed lately, and the overlays whose page crashed so often they are left alone. */
  private readonly crashes = new Map<string, number[]>();
  private readonly stopped = new Set<string>();
  /** What each panel passes to panel.setLive, and who listens (live view windows); kept while the panel exists, in memory only. */
  private readonly liveStates = new Map<string, { owner: string; state: JsonValue }>();
  /** The one pending look after a state appeared or went, so a page calling panel.setLive in a loop costs one look. */
  private liveTick: ReturnType<typeof setTimeout> | undefined;
  private readonly liveWatchers = new Map<string, Set<(state: JsonValue | null | undefined) => void>>();

  private constructor(
    private readonly options: GameOverlayServiceOptions,
    private readonly store: GameOverlayStore,
  ) {}

  static async create(options: GameOverlayServiceOptions): Promise<GameOverlays> {
    return new GameOverlays(options, await GameOverlayStore.load(options.userData, options.scopeOf));
  }

  /** Starts looking at the window in front; called once Tavora is up. */
  start(): void {
    // Coming from Tavora 0.21.0 or before (file version 1): its per-game arrange keys are gone (the key set last becomes
    // the layer key, if there is none), and so are the keys of panels that were over the game then.
    if (this.store.migrated) {
      this.options.moveKey((record) => record.action === LEGACY_ARRANGE_ACTION, layerBinding());
      this.options.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.target.startsWith(RESERVED_KEY_PREFIX));
    }
    // The move to setups (and the one above) is written now; a start that stopped before this does it again.
    if (this.store.migrated || this.store.moved) void this.store.save();
    if (this.timer || !this.options.supported) return;
    this.timer = setInterval(() => this.tick(), this.options.everyMs ?? LOOK_MS);
    this.timer.unref?.();
  }

  /** Whether overlays and the layer may show now: Tavora can, the switch is on, and the user didn't hide them for now. */
  private active(): boolean {
    return this.options.supported && this.options.enabled() && !this.suspended;
  }

  // ── What a module panel gets ─────────────────────────────────────────

  /**
   * overlay.showOverGame for a panel of `module` in `workspaceId`; the module view checked the key and the click. The
   * overlay lands in its game's setup (made when there is none), or in All games when it comes from a personal
   * workspace; one the user already has in some setup stays where it is.
   */
  show(module: StreamingModule, workspaceId: string, key: string): GameOverlayResult {
    if (!module.manifest.overlay) throw new HostError("INVALID_PARAMS", "this module has no overlay page in its manifest");
    if (key.startsWith(RESERVED_KEY_PREFIX)) throw new HostError("INVALID_PARAMS", "this overlay key is reserved");
    if (!this.options.supported || !this.options.enabled()) {
      if (this.options.supported) this.options.openSetting("game-overlays");
      return "off";
    }
    const subject: GameOverlaySubject = { owner: module.owner, moduleId: module.manifest.id, workspaceId, key };
    const setup = landingSetup(workspaceId, this.options.scopeOf(workspaceId));
    const made = !this.store.hasSetup(setup);
    const added = this.store.find(subject) ? "exists" : this.store.add(setup, subject, startRect(module.manifest.overlaySize ?? null, this.startArea(), DEFAULT_RECT));
    if (added === "full" || added === "refused") return "full";
    try {
      // The link holds what the module publishes for the key; making it now means the page hears it from the start.
      // When it can't be made (too many for the module) nothing of the overlay is kept, nor the setup made for it.
      this.options.overlays.link(subject);
    } catch (error) {
      if (added === "added") this.store.forget((overlay, id) => id === setup && sameOverlay(overlay, subject));
      if (made) this.store.removeSetup(setup);
      throw error;
    }
    // The user asked for it: a page that crashed too often gets another chance.
    this.revive(overlayId(subject));
    this.options.changed();
    this.tick();
    return "shown";
  }

  /** overlay.hideOverGame: takes this module's overlay for `key` out of every setup; nothing happens when there is none. */
  hide(module: StreamingModule, workspaceId: string, key: string): void {
    this.remove({ owner: module.owner, moduleId: module.manifest.id, workspaceId, key });
  }

  /** overlay.overGame: the keys of this module's game overlays in the workspace, whichever setups they are in. */
  keysOf(module: StreamingModule, workspaceId: string): string[] {
    const keys = this.store.all().filter((overlay) => overlay.owner === module.owner && overlay.moduleId === module.manifest.id && overlay.workspaceId === workspaceId).map((overlay) => overlay.key);
    return [...new Set(keys)];
  }

  /**
   * The user chose Show in game in a panel's menu (offered only for panel types the manifest marks `inGame`, checked by
   * the host). The panel lands in its game's setup, or in All games from a personal workspace, and is over the game
   * whenever the user opens the layer there. Counts toward the setup's items; "off" opens Settings > Overlays. It starts
   * at the size its module prefers (`preferred`, the panel's viewport).
   */
  showPanel(panel: { owner: string; moduleId: string; workspaceId: string; instanceId: string }, preferred: { width?: number | undefined; height?: number | undefined } | null = null): GameOverlayResult {
    if (!this.options.supported || !this.options.enabled()) {
      if (this.options.supported) this.options.openSetting("game-overlays");
      return "off";
    }
    const setup = landingSetup(panel.workspaceId, this.options.scopeOf(panel.workspaceId));
    const added = this.hasPanel(panel.instanceId) ? "exists" : this.store.addPanel(setup, panel, startRect(preferred, this.startArea()));
    if (added === "full" || added === "refused") return "full";
    // The user asked for it: a live view whose page crashed too often gets another chance.
    this.revive(liveWindowId(panel.instanceId));
    this.options.changed();
    this.tick();
    return "shown";
  }

  /** What a new overlay or panel is sized against: the game window in front, else the one seen last, else the main screen. */
  private startArea(): Rect | null {
    return this.game ?? this.lastGame ?? this.options.screen?.() ?? null;
  }

  /** Whether the panel is in some setup. */
  hasPanel(instanceId: string): boolean {
    return this.store.panelOf(instanceId) !== undefined;
  }

  /** Whether the panel is over the game right now (the layer is open): its view is in an overlay window. */
  panelOpen(instanceId: string): boolean {
    return this.open.has(panelWindowId(instanceId));
  }

  /** panel.setLive: what the panel's live view shows (already size-checked); null shows nothing. */
  setLive(instanceId: string, owner: string, state: JsonValue | null): void {
    // A panel of another publisher's module (the module was replaced) can't feed a view that belongs to the first one.
    const panel = this.store.panelOf(instanceId);
    if (panel && panel.owner !== owner) return;
    const had = this.liveStates.has(instanceId);
    if (state === null) this.liveStates.delete(instanceId);
    else this.liveStates.set(instanceId, { owner, state });
    for (const fn of this.liveWatchers.get(instanceId) ?? []) fn(state);
    // The view appears or goes when there is something to show or not; a changed state is just passed on.
    if (had !== (state !== null) && panel) this.lookSoon();
  }

  /** One look at the window in front soon, however many calls ask for it before then. */
  private lookSoon(): void {
    if (this.liveTick) return;
    this.liveTick = setTimeout(() => {
      this.liveTick = undefined;
      this.tick();
    }, 0);
    this.liveTick.unref?.();
  }

  /** The state a panel's live view shows: only what the module of the panel's publisher passed. */
  private liveStateOf(panel: Pick<InGamePanel, "instanceId" | "owner">): JsonValue | undefined {
    const entry = this.liveStates.get(panel.instanceId);
    return entry && entry.owner === panel.owner ? entry.state : undefined;
  }

  /** The state of a panel's live view goes (the panel is gone or its module was replaced); its page hears that nothing is shown. */
  private clearLive(instanceId: string): void {
    if (!this.liveStates.delete(instanceId)) return;
    for (const fn of this.liveWatchers.get(instanceId) ?? []) fn(null);
  }

  /** The panel is closing for good: its live state goes. */
  forgetLive(instanceId: string): void {
    if (!this.liveStates.has(instanceId)) return;
    this.clearLive(instanceId);
    if (this.hasPanel(instanceId)) this.lookSoon();
  }

  /** The live view's mode, opacity and Hide from capture of a panel, in one setup (or in every setup that has it). */
  updatePanelView(instanceId: string, change: InGamePanelChange, setupId?: string): void {
    if (this.store.updatePanelView(instanceId, change, setupId)) this.tick();
    this.options.changed();
  }

  /** The overlay subject a panel's toggle key is kept under (its instance id is the key), or null when no setup has the panel. */
  panelSubject(instanceId: string): GameOverlaySubject | null {
    const panel = this.store.panelOf(instanceId);
    return panel ? { owner: panel.owner, moduleId: panel.moduleId, workspaceId: panel.workspaceId, key: panel.instanceId } : null;
  }

  /** The panel a toggle key belongs to (as the first setup that has it holds it). */
  private panelOfKey(record: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "target">): InGamePanel | undefined {
    const panel = this.store.panelOf(record.target);
    return panel && panel.owner === record.owner && panel.moduleId === record.moduleId && panel.workspaceId === record.workspaceId ? panel : undefined;
  }

  /** Stop showing in game (or the panel is closing): the panel leaves one setup, or every setup; it stays in its workspace slot. */
  stopPanel(instanceId: string, setupId?: string): void {
    this.forgetPanels((panel, id) => panel.instanceId === instanceId && (setupId === undefined || id === setupId));
  }

  /** The Live badge of a panel's tab: it is in a setup, or its module has an overlay from its workspace or a personal one. */
  liveFor(instanceId: string, owner: string, moduleId: string, workspaceId: string): boolean {
    const overlays = this.store
      .all()
      .filter((overlay) => overlay.owner === owner && overlay.moduleId === moduleId && (overlay.workspaceId === workspaceId || this.options.scopeOf(overlay.workspaceId) === "all")).length;
    return isLive(this.hasPanel(instanceId), overlays);
  }

  // ── Settings ─────────────────────────────────────────────────────────

  /** Changes an overlay in one setup (or in every setup that has it). */
  update(subject: GameOverlaySubject, change: GameOverlayChange, setupId?: string): void {
    if (this.store.update(subject, change, setupId)) this.tick();
    this.options.changed();
  }

  /** The user removed an overlay from one setup (or the module took it out of every setup), or closed it in the layer. */
  remove(subject: GameOverlaySubject, setupId?: string): void {
    this.forget((overlay, id) => sameOverlay(overlay, subject) && (setupId === undefined || id === setupId));
  }

  /** The games running now (game-watch.ts): the window remembered for a game that stopped is no window to take a picture of. */
  gamesRunning(running: ReadonlySet<string>): void {
    this.running = new Set(running);
    for (const id of [...this.handles.keys()]) if (!running.has(id)) this.handles.delete(id);
    this.options.windowsChanged?.();
  }

  /** A workspace left the library for good: its items leave every setup, and a game workspace's setup and window go too. */
  forgetWorkspace(workspaceId: string): void {
    this.store.forgetSeen(workspaceId);
    this.handles.delete(workspaceId);
    this.options.windowsChanged?.();
    // Items from elsewhere leave its setup the same way, so one in no setup any more loses its key.
    this.forget((overlay, setupId) => overlay.workspaceId === workspaceId || setupId === workspaceId);
    this.forgetPanels((panel) => panel.workspaceId === workspaceId, true);
    this.forgetPanels((_panel, setupId) => setupId === workspaceId);
    if (this.store.removeSetup(workspaceId)) {
      this.tick();
      this.options.changed();
    }
  }

  /** A module's data was deleted, or the module was removed. */
  forgetModule(moduleId: string, owner?: string): void {
    this.forget((overlay) => overlay.moduleId === moduleId && (owner === undefined || overlay.owner === owner));
    this.forgetPanels((panel) => panel.moduleId === moduleId && (owner === undefined || panel.owner === owner), true);
  }

  /** "Hide all for now" in Settings > Overlays: nothing shows, and no key is taken, until Tavora starts again or this is called with false. */
  setHidden(hidden: boolean): void {
    if (this.suspended === hidden) return;
    this.suspended = hidden;
    this.tick();
    this.options.changed();
  }

  get hidden(): boolean {
    return this.suspended;
  }

  /** Forgets that an overlay's page crashed. */
  private revive(id: string): void {
    this.crashes.delete(id);
    this.stopped.delete(id);
  }

  private forget(test: (overlay: GameOverlay, setupId: string) => boolean): void {
    if (!this.drop(test)) return;
    this.tick();
    this.options.changed();
  }

  private forgetPanels(test: (panel: InGamePanel, setupId: string) => boolean, clearLive = false): void {
    if (!this.dropPanels(test, clearLive)) return;
    this.tick();
    this.options.changed();
  }

  /** Takes the panels matching `test` out of their setups; one in no setup any more loses its key (and its live state, with `clearLive`). Whether any went. */
  private dropPanels(test: (panel: InGamePanel, setupId: string) => boolean, clearLive = false): boolean {
    const before = this.store.panels().map((panel) => ({ ...panel }));
    if (!this.store.forgetPanels(test)) return false;
    const gone = new Map(before.filter((panel) => !this.hasPanel(panel.instanceId)).map((panel) => [panel.instanceId, panel]));
    for (const panel of gone.values()) {
      if (clearLive) this.clearLive(panel.instanceId);
      this.options.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.owner === panel.owner && record.moduleId === panel.moduleId && record.workspaceId === panel.workspaceId && record.target === panel.instanceId);
      this.toggled.delete(liveWindowId(panel.instanceId));
      this.revive(liveWindowId(panel.instanceId));
    }
    return true;
  }

  /** Takes the overlays matching `test` out of their setups; one in no setup any more loses its key. Whether any went. */
  private drop(test: (overlay: GameOverlay, setupId: string) => boolean): boolean {
    const before = this.store.all().map((overlay) => ({ ...overlay }));
    if (!this.store.forget(test)) return false;
    const gone = new Map(before.filter((overlay) => !this.store.find(overlay)).map((overlay) => [overlayId(overlay), overlay]));
    for (const overlay of gone.values()) {
      this.options.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.owner === overlay.owner && record.moduleId === overlay.moduleId && record.workspaceId === overlay.workspaceId && record.target === overlay.key);
      this.toggled.delete(overlayId(overlay));
      this.revive(overlayId(overlay));
    }
    return true;
  }

  /** Whether the game watcher is needed: overlays are on and a setup of games (All games, a game's) has something to show. */
  needsWatcher(): boolean {
    return this.active() && this.store.setupIds().some((id) => id !== EVERYWHERE && this.store.count(id) > 0);
  }

  // ── Which setups are on screen ───────────────────────────────────────

  /** The setups on screen now (setupsOnScreen): Everywhere unless Tavora's window is in front, and the game's or All games. */
  private onScreen(): string[] {
    // A layer over the screen holds only what the keys reach, never a game setup staying over the spot of a game left.
    if (this.layer !== null && this.layer.game === null) return this.keySetups();
    return setupsOnScreen(this.front ?? this.away?.gameId ?? null, this.tavoraFront, (id) => this.store.hasSetup(id));
  }

  /** The setups whose keys work now: as on screen, but a game's only while it is in front, not while its items stay over its spot. */
  private keySetups(): string[] {
    return setupsOnScreen(this.front, this.tavoraFront, (id) => this.store.hasSetup(id));
  }

  /** Where the items of a setup sit: Everywhere's on the main screen, the others on the game's window (the one in front, or the one they stay over). */
  private areaOf(setupId: string): Rect | null {
    if (setupId === EVERYWHERE) return this.options.screen?.() ?? null;
    return this.game ?? this.away?.bounds ?? null;
  }

  /** The overlays on screen, each once: as the game's setup (or All games) has it, else as Everywhere does. */
  private placedOverlays(setups: readonly string[]): Map<string, Placed<GameOverlay>> {
    const placed = new Map<string, Placed<GameOverlay>>();
    for (const setup of [...setups].reverse()) for (const item of this.store.overlaysIn(setup)) if (!placed.has(overlayId(item))) placed.set(overlayId(item), { setup, item });
    return placed;
  }

  /** The panels on screen, each once, the same way (by instance id). */
  private placedPanels(setups: readonly string[]): Map<string, Placed<InGamePanel>> {
    const placed = new Map<string, Placed<InGamePanel>>();
    for (const setup of [...setups].reverse()) for (const item of this.store.panelsIn(setup)) if (!placed.has(item.instanceId)) placed.set(item.instanceId, { setup, item });
    return placed;
  }

  /** Whether something shows for the keys now (keySetups have items): they work only then. */
  showing(): boolean {
    return this.active() && this.keySetups().some((id) => this.store.count(id) > 0);
  }

  /** The game in front that has something to show (its own setup, or All games), or null. */
  frontGame(): string | null {
    return this.front;
  }

  // ── Keys ─────────────────────────────────────────────────────────────

  /** The item a toggle key belongs to, as it is in the setups its keys work in now; undefined when it isn't. */
  private placedOfKey(record: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "target">): (Placed<GameOverlay | InGamePanel> & { id: string }) | undefined {
    const setups = this.keySetups();
    const overlay = this.placedOverlays(setups).get(overlayId({ owner: record.owner, moduleId: record.moduleId, workspaceId: record.workspaceId, key: record.target }));
    if (overlay) return { ...overlay, id: overlayId(overlay.item) };
    const panel = this.placedPanels(setups).get(record.target);
    if (panel && panel.item.owner === record.owner && panel.item.moduleId === record.moduleId && panel.item.workspaceId === record.workspaceId) return { ...panel, id: liveWindowId(panel.item.instanceId) };
    return undefined;
  }

  /** Whether a hotkey of game overlays should be registered now (only while something shows). */
  wants(record: HotkeyRecord): boolean {
    if (!this.showing()) return false;
    if (record.action === OVERLAY_LAYER_ACTION) return true;
    if (record.action !== OVERLAY_TOGGLE_ACTION) return false;
    return this.placedOfKey(record)?.item.mode === "toggle";
  }

  /** Whether a key works outside one game (the layer key, and the toggle key of an item in Everywhere or All games): it collides with any workspace's keys. */
  general(record: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "action" | "target">): boolean {
    if (record.action === OVERLAY_LAYER_ACTION) return true;
    if (record.action !== OVERLAY_TOGGLE_ACTION) return false;
    const overlay = this.store.find({ owner: record.owner, moduleId: record.moduleId, workspaceId: record.workspaceId, key: record.target });
    const panel = overlay ? undefined : this.panelOfKey(record);
    const ref: ItemRef | null = overlay ? { kind: "overlay", subject: overlay } : panel ? { kind: "panel", instanceId: panel.instanceId } : null;
    return ref !== null && this.store.setupsWith(ref).some((id) => !isGameSetup(id));
  }

  pressed(record: HotkeyRecord): void {
    if (!this.showing()) return;
    if (record.action === OVERLAY_LAYER_ACTION) {
      if (this.layer !== null) this.closeLayer(true);
      else if (this.front !== null && looksExclusive(this.notification)) {
        // No window can be drawn over a game that owns the screen exclusively: say so instead of opening nothing.
        this.options.notify(translate(this.options.language(), "overlays.exclusiveHint"));
      } else this.openLayer(this.front);
      return;
    }
    const placed = this.placedOfKey(record);
    if (!placed || placed.item.mode !== "toggle") return;
    if (!this.toggled.delete(placed.id)) this.toggled.add(placed.id);
    // Toggling is the user asking for it, also for a page that crashed too often.
    this.revive(placed.id);
    this.tick();
    // The Overlay layout shows it too.
    this.options.changed();
  }

  /** Whether the in-game layer is open. */
  get layerOpen(): boolean {
    return this.layer !== null;
  }

  private openLayer(gameId: string | null): void {
    this.layer = { game: gameId };
    // The layer belongs to this window: another window of the program (a restart), or another app, is not the one it opened over.
    this.layerWindow = gameId !== null ? this.frontWindow : this.foregroundWindow;
    // Esc ends it too; the key is the game's again afterwards.
    this.escape = this.options.shortcuts.register("Escape", () => this.closeLayer(true));
    this.tick();
  }

  /** Closes the layer. `refocus`: the user ended it (Esc or the key), so the game gets the keyboard back; not when it left the front. */
  private closeLayer(refocus: boolean): void {
    if (this.layer === null) return;
    this.layer = null;
    if (this.escape) this.options.shortcuts.unregister("Escape");
    this.escape = false;
    if (refocus) {
      // Only a panel takes the keyboard, but a click on an overlay's frame may have left the game without focus.
      // Before looking again, so a panel that had the keyboard isn't taken for the game being left.
      try {
        this.probe?.focus();
      } catch {
        // Best effort: the user can click the game.
      }
    }
    this.tick();
  }

  // ── Looking ──────────────────────────────────────────────────────────

  /** Looks at the window in front and shows or hides every item accordingly. */
  tick(): void {
    this.prune();
    if (!this.active() || this.store.empty) {
      this.closeAll();
      this.setFront(null, null);
      this.left = null;
      this.away = null;
      this.keysFollow();
      return;
    }
    return this.look();
  }

  /** Whether one of the service's own windows has the keyboard (a panel in the layer). */
  private ownWindowFocused(): boolean {
    return [...this.open.values()].some((entry) => entry.window.focused);
  }

  private look(): void {
    let foreground: Foreground | null = null;
    try {
      this.probe ??= this.options.probe();
      foreground = this.probe.look();
    } catch (error) {
      // Windows' functions could not be loaded; looking again won't help.
      console.warn(`[tavora] game overlays stopped: ${error instanceof Error ? error.message : String(error)}`);
      clearInterval(this.timer);
      this.timer = undefined;
      this.closeAll();
      this.setFront(null, null);
      return;
    }
    // A panel in the layer took the keyboard, so Tavora's own window is in front: the game (or the desktop) still is the one in front.
    if (foreground?.own && this.layer !== null && this.ownWindowFocused()) {
      this.apply();
      return;
    }
    this.tavoraFront = (this.options.tavoraInFront?.() ?? false) && !this.ownWindowFocused();
    const withSetups = new Set(this.store.gameSetups());
    const general = this.store.count(ALL_GAMES) > 0;
    const front = foreground?.program ? gameInFront(this.options.gamesOf(foreground.program), withSetups, general, (id) => this.options.scopeOf(id) === "game") : null;
    this.setFront(front, front && foreground ? this.options.toDip(foreground.bounds) : null);
    this.frontWindow = front && foreground?.handle ? foreground.handle : null;
    this.foregroundWindow = foreground?.handle ?? null;
    if (front && this.frontWindow && this.handles.get(front) !== this.frontWindow) {
      this.handles.set(front, this.frontWindow);
      this.options.windowsChanged?.();
    }
    this.notification = front && foreground ? foreground.notification : null;
    this.away = this.stayingAway(front);
    if (front && foreground && looksExclusive(foreground.notification) && !this.store.exclusiveHintShown) {
      this.store.markExclusiveHintShown();
      this.options.notify(translate(this.options.language(), "overlays.exclusiveHint"));
    }
    // The layer ends (and gives the keyboard to nobody) when its game window is gone, minimized, another one, or the game
    // went exclusive full screen; one over the screen ends when a game, another window or Tavora's own comes in front.
    if (this.layer !== null) {
      const window = this.layer.game !== null ? this.frontWindow : this.foregroundWindow;
      const gone = this.layer.game !== this.front || (this.layerWindow !== null && window !== this.layerWindow) || looksExclusive(this.notification);
      if (gone || (this.layer.game === null && this.tavoraFront) || !this.showing()) this.closeLayer(false);
    }
    this.apply();
  }

  /**
   * Where overlays stay while the user is in another window: over the game window seen in front last, while it is
   * still open and not minimized. Overlays only; the layer and the keys stay with the game in front.
   */
  private stayingAway(front: string | null): { gameId: string; bounds: Rect } | null {
    if (front !== null) {
      this.left = front;
      this.probe?.keep?.();
      return null;
    }
    if (this.left === null || !this.options.stay?.()) return null;
    const kept = this.probe?.kept?.() ?? null;
    if (!kept) {
      this.left = null;
      return null;
    }
    return { gameId: this.left, bounds: this.options.toDip(kept) };
  }

  private setFront(gameId: string | null, bounds: Rect | null): void {
    this.game = bounds;
    if (bounds) this.lastGame = bounds;
    // The Overlay layout's canvas takes the shape of the window last seen for the game, and the positions an older Tavora
    // saved (fractions of the window) are converted on the first real window size seen. A launcher's or splash screen's
    // window is no size to go by.
    if (gameId && bounds && isRealWindow(bounds)) {
      const seen = this.store.setSeen(gameId, bounds);
      const converted = this.store.convertLegacy(gameId, bounds);
      if (seen || converted) this.options.changed();
    }
    if (gameId === this.front) return;
    this.front = gameId;
    // The keys follow the game in front (streaming.ts sync).
    this.options.changed();
  }

  /** The keys work while something shows: when that changed since the last look (Tavora's window came in front, say), they follow. */
  private keysFollow(): void {
    const showing = this.showing();
    if (showing === this.wasShowing) return;
    this.wasShowing = showing;
    this.options.changed();
  }

  private apply(): void {
    const active = this.active();
    const now = Date.now();
    const live = new Set<string>();
    const started: Open[] = [];
    const front = this.front;
    // Over a game, the layer needs its window; over the screen, nothing but itself.
    const layerOpen = this.layer !== null && this.layer.game === front && (front === null || this.game !== null);
    const setups = this.onScreen();
    const overlays = this.placedOverlays(setups);
    const panels = this.placedPanels(setups);
    // The veil first: everything shown after it is above it.
    let veilNew = false;
    const veilArea = layerOpen ? (front !== null ? this.game : this.areaOf(EVERYWHERE)) : null;
    if (veilArea) {
      if (!this.veil) {
        this.veil = this.options.openVeil();
        veilNew = true;
      }
      this.veil.place(veilArea);
    } else if (this.veil) {
      this.veil.destroy();
      this.veil = null;
    }
    // Every overlay any setup has, once: shown from the setup on screen that has it, or hidden.
    const every = new Map(this.store.all().map((overlay) => [overlayId(overlay), overlay]));
    for (const [id, overlay] of every) {
      live.add(id);
      const placed = overlays.get(id);
      const module = this.options.module(overlay.moduleId);
      const usable = module !== undefined && module.owner === overlay.owner && !!module.manifest.overlay;
      const area = placed ? this.areaOf(placed.setup) : null;
      const settings = placed?.item ?? overlay;
      const visible = usable && !this.stopped.has(id) && area !== null && overlayVisible({ enabled: active, gameInFront: placed !== undefined, mode: settings.mode, toggledOn: this.toggled.has(id), layerOpen });
      let entry = this.open.get(id);
      if (!visible) {
        if (entry?.shown) {
          entry.window.setArranging(false);
          entry.arranging = false;
          entry.window.setShown(false);
          entry.shown = false;
        }
        if (entry) {
          // Hidden because its setup is gone from the screen for a while: the window goes, and is made again on show.
          entry.idleSince = placed ? null : (entry.idleSince ?? now);
          if (entry.idleSince !== null && now - entry.idleSince >= IDLE_CLOSE_MS) this.dropWindow(id);
        }
        continue;
      }
      entry ??= this.create(overlay, id, placed!.setup) ?? undefined;
      if (!entry) continue;
      entry.setup = placed!.setup;
      entry.idleSince = null;
      if (entry.opacity !== settings.opacity) entry.window.setOpacity((entry.opacity = settings.opacity));
      if (entry.hideFromCapture !== settings.hideFromCapture) entry.window.setHideFromCapture((entry.hideFromCapture = settings.hideFromCapture));
      if (!entry.window.dragging) entry.window.setRect(placeItem(settings, area!));
      this.zoomTo(entry, area!);
      if (!entry.shown) {
        entry.window.setShown((entry.shown = true));
        entry.shownOrder = ++this.shownCount;
      }
      // After the window has its place and is shown (on top), never before: a window that takes the mouse while still unplaced would flash in the wrong spot.
      if (entry.arranging !== layerOpen) entry.window.setArranging((entry.arranging = layerOpen));
    }
    // Panels are over the game (or the screen) only while the layer is open.
    const gone: InGamePanel[] = [];
    if (layerOpen) {
      for (const { setup, item: panel } of panels.values()) {
        const area = this.areaOf(setup);
        if (!area) continue;
        const id = panelWindowId(panel.instanceId);
        live.add(id);
        let entry = this.open.get(id);
        if (!entry) {
          entry = this.createPanel(panel, id, setup) ?? undefined;
          if (!entry) {
            gone.push(panel);
            continue;
          }
        }
        entry.setup = setup;
        if (!entry.window.dragging) entry.window.setRect(placeItem(panel, area));
        this.zoomTo(entry, area);
        if (!entry.shown) {
          entry.window.setShown((entry.shown = true));
          entry.shownOrder = ++this.shownCount;
        }
        if (!entry.arranging) {
          entry.window.setArranging((entry.arranging = true));
          started.push(entry);
        }
      }
    }
    // Live views: a panel on screen shows its module's overlay page read-only in its own spot while the layer is closed.
    // With the layer open the full panel is there instead, so the view goes quiet (and comes back in the new spot).
    const everyPanel = new Map(this.store.panels().map((panel) => [panel.instanceId, panel]));
    for (const [instanceId, panel] of everyPanel) {
      const id = liveWindowId(instanceId);
      live.add(id);
      const placed = panels.get(instanceId);
      const module = this.options.module(panel.moduleId);
      const usable = module !== undefined && module.owner === panel.owner && !!module.manifest.overlay;
      const area = placed ? this.areaOf(placed.setup) : null;
      const settings = placed?.item ?? panel;
      const visible =
        usable &&
        this.liveStateOf(panel) !== undefined &&
        !this.stopped.has(id) &&
        area !== null &&
        !layerOpen &&
        overlayVisible({ enabled: active, gameInFront: placed !== undefined, mode: settings.mode, toggledOn: this.toggled.has(id), layerOpen: false });
      let entry = this.open.get(id);
      if (!visible) {
        if (entry?.shown) {
          entry.window.setShown(false);
          entry.shown = false;
        }
        if (entry) {
          entry.idleSince = placed ? null : (entry.idleSince ?? now);
          if (entry.idleSince !== null && now - entry.idleSince >= IDLE_CLOSE_MS) this.dropWindow(id);
        }
        continue;
      }
      entry ??= this.createLive(panel, id, placed!.setup);
      entry.setup = placed!.setup;
      entry.idleSince = null;
      if (entry.opacity !== settings.opacity) entry.window.setOpacity((entry.opacity = settings.opacity));
      if (entry.hideFromCapture !== settings.hideFromCapture) entry.window.setHideFromCapture((entry.hideFromCapture = settings.hideFromCapture));
      entry.window.setRect(placeItem(settings, area!));
      this.zoomTo(entry, area!);
      if (!entry.shown) {
        entry.window.setShown((entry.shown = true));
        entry.shownOrder = ++this.shownCount;
      }
    }
    for (const [id, entry] of this.open) {
      if (live.has(id) && (entry.kind !== "panel" || layerOpen)) continue;
      entry.window.destroy();
      this.open.delete(id);
    }
    // A fresh veil would otherwise sit above overlays that were shown before it.
    if (veilNew) {
      for (const kind of ["overlay", "panel"] as const) for (const entry of this.open.values()) if (entry.kind === kind && entry.shown) entry.window.raise?.();
    }
    // One window takes the keyboard, the panel used last; not each in turn.
    if (started.length > 0) {
      const used = (entry: Open) => this.options.panels?.usedAt(entry.instanceId!) ?? 0;
      const newest = started.filter((entry) => entry.window.focusPanel).sort((a, b) => used(b) - used(a) || b.shownOrder - a.shownOrder)[0];
      newest?.window.focusPanel?.();
    }
    // A panel that is gone (its window couldn't be made) is in no setup any more either.
    if (gone.length > 0) this.forgetPanels((panel) => gone.some((item) => item.instanceId === panel.instanceId));
    this.keysFollow();
    this.updateShowing();
  }

  /** Tells the renderer when whether any window shows over a game or the screen changed (the header button's Live look). */
  private updateShowing(): void {
    const shown = [...this.open.values()].some((entry) => entry.shown);
    if (shown === this.windowsShown) return;
    this.windowsShown = shown;
    this.options.changed();
  }

  /** Content in the overlays' windows scales with the area's height (contentScale), from a 1080p reference. */
  private zoomTo(entry: Open, area: Rect): void {
    const zoom = contentScale(area.height);
    if (entry.zoom === zoom) return;
    entry.zoom = zoom;
    entry.window.setZoom?.(zoom);
  }

  private requestFor(
    subject: OverlaySubject,
    id: string,
    moved: (rect: Rect) => void,
    closeRequested: () => void,
    frameText: () => { name: string; closeLabel: string },
  ): OverlayWindowRequest {
    const store = this.options.overlays;
    return {
      id,
      page: () => this.pageOf(subject),
      state: () => store.peek(subject)?.state ?? null,
      watch: (fn) => {
        const link = store.peek(subject)?.link;
        return link ? store.watch(link.token, fn) : null;
      },
      gameBounds: () => this.areaOf(this.open.get(id)?.setup ?? ALL_GAMES),
      moved,
      closeRequested,
      layoutRequested: () => this.options.openLayout?.(this.open.get(id)?.setup ?? null),
      ended: () => this.crashed(id),
      frameText: () => ({ ...frameText(), layoutLabel: translate(this.options.language(), "overlays.layoutLabel") }),
    };
  }

  /** The overlay page of a module, looked up at every request: a module that was removed or replaced by another publisher's stops being served. */
  private pageOf(subject: Pick<OverlaySubject, "owner" | "moduleId">): OverlayPage | null {
    const now = this.options.module(subject.moduleId);
    return now && now.owner === subject.owner && now.manifest.overlay ? { root: now.root, entry: now.manifest.overlay } : null;
  }

  /** The window of a panel's live view: the module's overlay page, fed by what the panel passes to panel.setLive. */
  private createLive(panel: InGamePanel, id: string, setup: string): Open {
    const instanceId = panel.instanceId;
    const window = this.options.openWindow({
      id,
      ...this.liveSource(panel),
      gameBounds: () => this.areaOf(this.open.get(id)?.setup ?? setup),
      moved: () => {},
      closeRequested: () => {},
      layoutRequested: () => {},
      ended: () => this.crashed(id),
      frameText: () => ({ name: this.options.panels?.name(instanceId) ?? panel.moduleId, closeLabel: translate(this.options.language(), "overlays.stopShowingLabel"), layoutLabel: "" }),
    });
    const entry: Open = { kind: "live", window, setup, opacity: 100, hideFromCapture: false, arranging: false, shown: false, shownOrder: 0, zoom: 1, idleSince: null, instanceId };
    this.open.set(id, entry);
    return entry;
  }

  /** The user moved an item in the layer: its new place, relative to its area, goes into the setup it shows from. */
  private movedIn(id: string, ref: ItemRef, rect: Rect): void {
    const setup = this.open.get(id)?.setup;
    const area = setup !== undefined ? this.areaOf(setup) : null;
    if (setup !== undefined && area && this.store.setRect(setup, ref, anchorOf(rect, area))) this.options.changed();
  }

  private create(overlay: GameOverlay, id: string, setup: string): Open | null {
    const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, key: overlay.key };
    const request = this.requestFor(
      subject,
      id,
      (rect) => this.movedIn(id, { kind: "overlay", subject }, rect),
      () => this.remove(subject, this.open.get(id)?.setup),
      () => ({ name: this.nameOf(overlay), closeLabel: translate(this.options.language(), "overlays.closeLabel") }),
    );
    const window = this.options.openWindow(request);
    // A new window is fully opaque, click-through and visible to capture; apply sets the rest.
    const entry: Open = { kind: "overlay", window, setup, opacity: 100, hideFromCapture: false, arranging: false, shown: false, shownOrder: 0, zoom: 1, idleSince: null };
    this.open.set(id, entry);
    return entry;
  }

  private createPanel(panel: InGamePanel, id: string, setup: string): Open | null {
    const subject: OverlaySubject = { owner: panel.owner, moduleId: panel.moduleId, workspaceId: panel.workspaceId, key: panel.instanceId };
    const request = this.requestFor(
      subject,
      id,
      (rect) => this.movedIn(id, { kind: "panel", instanceId: panel.instanceId }, rect),
      () => this.stopPanel(panel.instanceId, this.open.get(id)?.setup),
      () => ({ name: this.options.panels?.name(panel.instanceId) ?? panel.moduleId, closeLabel: translate(this.options.language(), "overlays.stopShowingLabel") }),
    );
    const window = this.options.panels?.openWindow({ ...request, instanceId: panel.instanceId, workspaceId: panel.workspaceId });
    if (!window) return null;
    const entry: Open = { kind: "panel", window, setup, opacity: 100, hideFromCapture: false, arranging: false, shown: false, shownOrder: 0, zoom: 1, idleSince: null, instanceId: panel.instanceId };
    this.open.set(id, entry);
    return entry;
  }

  /** A window's page is gone. It is made again on the next look, unless that keeps happening. */
  private crashed(id: string): void {
    const entry = this.open.get(id);
    // A panel's page is the panel's own; the host shows its crash screen in the slot.
    if (entry?.kind === "panel") return;
    this.dropWindow(id);
    const now = Date.now();
    const lately = [...(this.crashes.get(id) ?? []).filter((at) => now - at < CRASH_SPAN_MS), now];
    this.crashes.set(id, lately);
    if (lately.length < MAX_CRASHES || this.stopped.has(id)) return;
    this.stopped.add(id);
    this.options.notify(translate(this.options.language(), "overlays.stopped"));
  }

  private dropWindow(id: string): void {
    const entry = this.open.get(id);
    if (!entry) return;
    this.open.delete(id);
    entry.window.destroy();
  }

  /** Overlays of a module that another publisher's module replaced can't be shown and are forgotten; so are panels that no longer exist. */
  private prune(): void {
    const replaced = (item: { moduleId: string; owner: string }) => {
      const module = this.options.module(item.moduleId);
      return module !== undefined && module.owner !== item.owner;
    };
    const overlays = this.drop(replaced);
    const panels = this.dropPanels((panel) => replaced(panel) || (this.options.panels !== undefined && (!this.options.panels.exists(panel.workspaceId, panel.instanceId) || this.options.panels.allowed?.(panel.workspaceId, panel.instanceId) === false)), true);
    if (overlays || panels) this.options.changed();
  }

  /** Every window goes, the layer closes: panels are back in their slots, nothing is left over the game or the screen. */
  private closeAll(): void {
    this.endLayerQuietly();
    for (const entry of this.open.values()) entry.window.destroy();
    this.open.clear();
    this.updateShowing();
  }

  private endLayerQuietly(): void {
    this.layer = null;
    if (this.escape) this.options.shortcuts.unregister("Escape");
    this.escape = false;
    this.veil?.destroy();
    this.veil = null;
  }

  /**
   * Closes every window now, without waiting for anything and without looking at the settings: for quitting, a signal,
   * or the process exiting. Tavora's windows must never outlive it.
   */
  closeNow(): void {
    clearTimeout(this.liveTick);
    this.liveTick = undefined;
    clearInterval(this.timer);
    this.timer = undefined;
    try {
      this.closeAll();
    } catch (error) {
      console.error("[tavora] closing overlay windows failed", error);
    }
  }

  // ── The Overlay layout ───────────────────────────────────────────────

  /** What the Overlay layout needs of the setups (overlay-layout.ts). */
  get layout(): LayoutSource {
    return {
      items: (setupId) => this.layoutItems(setupId),
      setups: () => this.store.setupIds(),
      seenSize: (gameId) => this.store.seenSize(gameId),
      handleOf: (gameId) => (this.running.has(gameId) ? (this.handles.get(gameId) ?? null) : null),
      gameRunning: (gameId) => this.running.has(gameId),
      gameWindow: () => this.game ?? this.lastGame,
      grid: () => this.store.grid,
      setGrid: (grid) => {
        this.store.setGrid(grid);
        this.options.changed();
      },
      running: () => [...this.running].sort((a, b) => Number(b === this.front) - Number(a === this.front)),
      addSetup: (gameId) => this.addSetup(gameId),
      addPanel: (setupId, panel) => this.addPanelTo(setupId, panel),
      move: (ref, from, to) => this.moveItem(ref, from, to),
      setRect: (setupId, ref, rect) => {
        const done = this.store.setRect(setupId, ref, rect);
        // On screen at once: the windows take their new place on this look.
        if (done) this.tick();
        return done;
      },
      startSize: (ref, window) => {
        const area = { x: 0, y: 0, ...window };
        // The same lookups as when the item was made: an overlay's size from its module, a panel's from its viewport.
        const start =
          ref.kind === "panel"
            ? startRect(this.options.panels?.preferred?.(this.store.panelOf(ref.instanceId)?.workspaceId ?? "", ref.instanceId) ?? null, area)
            : startRect(this.options.module(ref.subject.moduleId)?.manifest.overlaySize ?? null, area, DEFAULT_RECT);
        return { width: start.width, height: start.height };
      },
      setOverlay: (setupId, subject, change) => this.update(subject, change, setupId),
      setPanel: (setupId, instanceId, change) => this.updatePanelView(instanceId, change, setupId),
      remove: (setupId, ref) => (ref.kind === "panel" ? this.stopPanel(ref.instanceId, setupId) : this.remove(ref.subject, setupId)),
      layerOpen: () => this.layer !== null,
    };
  }

  /** A panel the user put into a setup on the Overlay page. */
  private addPanelTo(setupId: string, panel: { owner: string; moduleId: string; workspaceId: string; instanceId: string }): AddResult {
    const preferred = this.options.panels?.preferred?.(panel.workspaceId, panel.instanceId) ?? null;
    const added = this.store.addPanel(setupId, panel, startRect(preferred, this.startArea()));
    if (added === "added") {
      this.revive(liveWindowId(panel.instanceId));
      this.options.changed();
      this.tick();
    }
    return added;
  }

  private moveItem(ref: LayoutItemRef, from: string, to: string): AddResult | "missing" {
    const moved = this.store.moveItem(ref, from, to);
    if (moved === "added" || moved === "exists") {
      this.options.changed();
      this.tick();
    }
    return moved;
  }

  /** Add overlay: a game workspace gets a setup of its own, starting with copies of what All games has. */
  addSetup(gameId: string): boolean {
    const added = this.store.addSetup(gameId);
    if (added) {
      this.options.changed();
      this.tick();
    }
    return added;
  }

  /** Remove overlay: the game's setup goes with what it holds; over the game, All games shows again. */
  removeSetup(gameId: string): boolean {
    if (!isGameSetup(gameId) || !this.store.hasSetup(gameId)) return false;
    // What only this setup held loses its key, as when its workspace goes.
    this.forget((_overlay, setupId) => setupId === gameId);
    this.forgetPanels((_panel, setupId) => setupId === gameId);
    this.store.removeSetup(gameId);
    this.options.changed();
    this.tick();
    return true;
  }

  hasSetup(gameId: string): boolean {
    return this.store.hasSetup(gameId);
  }

  /** The overlays and panels of a setup, in the order the user added them. */
  private layoutItems(setupId: string): LayoutItemInfo[] {
    const items: LayoutItemInfo[] = [];
    for (const overlay of this.store.overlaysIn(setupId)) {
      const module = this.options.module(overlay.moduleId);
      const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, key: overlay.key };
      const id = overlayId(overlay);
      items.push({
        id,
        ref: { kind: "overlay", subject },
        name: this.nameOf(overlay),
        moduleId: overlay.moduleId,
        scope: this.options.scopeOf(overlay.workspaceId),
        mode: overlay.mode,
        opacity: overlay.opacity,
        hideFromCapture: overlay.hideFromCapture,
        rect: overlay.rect,
        ...(overlay.legacy ? { legacy: overlay.legacy } : {}),
        hotkey: this.options.keyOf(toggleBinding(overlay)),
        toggledOn: this.toggled.has(id),
        source: module?.manifest.overlay && module.owner === overlay.owner ? this.overlaySource(subject) : null,
        keyTarget: subject,
      });
    }
    for (const panel of this.store.panelsIn(setupId)) {
      const module = this.options.module(panel.moduleId);
      const keyTarget = { owner: panel.owner, moduleId: panel.moduleId, workspaceId: panel.workspaceId, key: panel.instanceId };
      items.push({
        id: itemId(panel),
        ref: { kind: "panel", instanceId: panel.instanceId },
        name: this.options.panels?.name(panel.instanceId) ?? module?.manifest.name ?? panel.moduleId,
        moduleId: panel.moduleId,
        scope: this.options.scopeOf(panel.workspaceId),
        mode: panel.mode,
        opacity: panel.opacity,
        hideFromCapture: panel.hideFromCapture,
        rect: panel.rect,
        ...(panel.legacy ? { legacy: panel.legacy } : {}),
        hotkey: this.options.keyOf(toggleBinding(keyTarget)),
        toggledOn: this.toggled.has(liveWindowId(panel.instanceId)),
        // A panel without an overlay page in its module is drawn as a box with its name.
        source: module?.manifest.overlay && module.owner === panel.owner ? this.liveSource(panel) : null,
        keyTarget,
      });
    }
    return items;
  }

  /** What an overlay page is served from: the same lookups as the overlay's window makes. */
  private overlaySource(subject: OverlaySubject): GameOverlaySource {
    const store = this.options.overlays;
    return {
      page: () => this.pageOf(subject),
      state: () => store.peek(subject)?.state ?? null,
      watch: (fn) => {
        const link = store.peek(subject)?.link;
        return link ? store.watch(link.token, fn) : null;
      },
    };
  }

  /** What a panel's live view page is served from: what the panel passes to panel.setLive. */
  private liveSource(panel: InGamePanel): GameOverlaySource {
    const instanceId = panel.instanceId;
    return {
      page: () => this.pageOf(panel),
      state: () => this.liveStateOf(panel) ?? null,
      watch: (fn) => {
        const watchers = this.liveWatchers.get(instanceId) ?? new Set();
        this.liveWatchers.set(instanceId, watchers);
        watchers.add(fn);
        return () => {
          watchers.delete(fn);
          if (watchers.size === 0) this.liveWatchers.delete(instanceId);
        };
      },
    };
  }

  // ── Settings view ────────────────────────────────────────────────────

  /** What Settings shows for an overlay: its module's name, and the key when the module has several from the same place. */
  private nameOf(overlay: GameOverlaySubject): string {
    const name = this.options.module(overlay.moduleId)?.manifest.name ?? overlay.moduleId;
    const general = this.options.scopeOf(overlay.workspaceId) === "all";
    const ids = new Set(
      this.store
        .all()
        .filter((item) => item.moduleId === overlay.moduleId && (general ? this.options.scopeOf(item.workspaceId) === "all" : item.workspaceId === overlay.workspaceId))
        .map((item) => overlayId(item)),
    );
    return ids.size > 1 ? `${name} · ${overlay.key}` : name;
  }

  view(): GameOverlaysView {
    return {
      supported: this.options.supported,
      enabled: this.options.enabled(),
      stay: this.options.stay?.() ?? false,
      sidebar: this.options.sidebar?.() ?? "right",
      hidden: this.suspended,
      showing: this.windowsShown,
      gameSetups: this.store.gameSetups(),
      layerKey: this.options.keyOf(layerBinding()),
    };
  }

  /** The name a hotkey dialog calls an overlay or the layer key by. */
  dialogNames(binding: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "action" | "target">): { label: string; module: string; action: string } {
    const language = this.options.language();
    if (binding.action === OVERLAY_LAYER_ACTION) return { label: translate(language, "overlays.layerLabel"), module: "Tavora", action: translate(language, "overlays.layerAction") };
    const where = (workspaceId: string) => (this.options.scopeOf(workspaceId) === "all" ? translate(language, "overlays.allGames") : (this.options.workspaceName(workspaceId) ?? workspaceId));
    const overlay = this.store.find({ owner: binding.owner, moduleId: binding.moduleId, workspaceId: binding.workspaceId, key: binding.target });
    const panel = overlay ? undefined : this.panelOfKey(binding);
    if (panel) return { label: this.options.panels?.name(panel.instanceId) ?? panel.moduleId, module: where(panel.workspaceId), action: translate(language, "overlays.toggleAction") };
    return { label: overlay ? this.nameOf(overlay) : binding.target, module: where(binding.workspaceId), action: translate(language, "overlays.toggleAction") };
  }

  /** Whether the user has this overlay in some setup (a key can be set only for one that exists). */
  has(subject: GameOverlaySubject): boolean {
    return this.store.find(subject) !== undefined;
  }

  /** Whether the key is one of an overlay or of a panel in a setup: a toggle key can be set for either. */
  hasKey(subject: GameOverlaySubject): boolean {
    return this.has(subject) || this.panelOfKey({ ...subject, target: subject.key }) !== undefined;
  }

  /** Quitting: every window closes and the last changes are written. */
  async shutdown(): Promise<void> {
    this.closeNow();
    // The keys follow what shows: with nothing, the layer and toggle keys go back to the system.
    this.setFront(null, null);
    this.tavoraFront = true;
    this.away = null;
    this.keysFollow();
    await this.store.save();
  }
}
