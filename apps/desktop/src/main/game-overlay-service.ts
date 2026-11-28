// Game overlays as a whole (game-overlays.ts has the setups, game-overlay-window.ts one window): looks every moment at
// which window is in front, shows the items of the setups on screen, and runs the in-game layer.
//
// Setups (docs/features/overlay-setups.md): Everywhere shows over any app, also over the desktop, except while
// Tavora's own window is in front. Over a game in front, its own setup shows next to it, or All games when it has none.
// An item is shown once: one that is in Everywhere and in the game's setup shows as the game's setup has it.
//
// Two kinds of items. Overlays are a module's overlay page, always there (or with a key of their own), click-through.
// Panels are whole panels the user chose to show; they appear only while the user holds the layer open with the one
// global key: a veil over the game window (over the screen, with no game in front), every panel on screen on top of it,
// and Tavora's card at the top (game-layer-card.ts). The layer opens in Use: panels take clicks and keys, nothing has a
// frame, overlays stay click-through. In Arrange (the card's other choice) every item has its frame to move, resize or
// close it, and no item's content takes input. Closing the layer puts everything back: panels return to their
// workspace slots, overlays are click-through again, and the game gets the keyboard back.
//
// Tavora only reads which window is in front (foreground.ts) and draws its own windows above it.
//
// This service keeps the setups, the keys, the live states and the Overlay layout's source, and looks. What the layer
// shows is decided in game-layer.ts (`layerStep` for the layer, `layerScene` for every window), and the windows are made
// to do it by game-layer-windows.ts (`LayerWindows`), over Electron's windows (game-layer-electron.ts) or a test's.
import type { GameOverlayResult, JsonValue, OverlaySource } from "@tavora/sdk/protocol";
import type { GameOverlaysView } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { DEFAULT_RECT, REFERENCE_HEIGHT, anchorOf, type AnchoredRect, type LegacyRect } from "../shared/overlay-anchor";
import { adoptRect, followRect, resizeContentRect } from "../shared/overlay-content";
import type { GridSetting } from "../shared/layout-math";
import type { ToolbarSetting } from "../shared/layout-toolbar";
import { HostError } from "./errors";
import type { Foreground, ForegroundProbe } from "./foreground";
import type { OverlayPanel } from "./game-overlay-window";
import type { PanelInGame } from "./panel-views";
import { layerCardContent, type LayerMode } from "../shared/layer-card";
import { LAYER_CLOSED, WATCH_START, awayOf, frontOf, layerScene, layerStep, placedOverlays, placedPanels, watchStep, type LayerEvent, type LayerLook, type LayerState, type Placed, type Watch, type WatchEvent } from "./game-layer";
import { CRASH_SPAN_MS, LayerWindows, MAX_CRASHES, type LayerWindowsPlatform, type OverlayWindow, type OverlayWindowRequest, type PanelWindowMaker, type WindowMaker } from "./game-layer-windows";
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
  panelWindowId,
  startRect,
  placeItem,
  sameOverlay,
  setupsOnScreen,
  type AddResult,
  type CopyOutcome,
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
import type { HotkeyRecord, ShortcutRegistry } from "./hotkeys";
import type { OverlayPage, OverlaySubject } from "./overlays";
import type { Streaming, StreamingModule } from "./streaming";
import type { WorkspaceNames } from "./workspace-lookup";
import type { Library } from "./library";
import type { GameWatcher } from "./game-watch";
import type { OverlayLayout } from "./overlay-layout";
import type { Shell } from "./shell";

/** Which overlay or panel an item of the Overlay layout is. */
export type LayoutItemRef = ItemRef;

/** Whether two saved rectangles have the same size. */
const sameSize = (a: AnchoredRect, b: AnchoredRect) => a.width === b.width && a.height === b.height;

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
  /** Lock position, and the place in the setup's stacking order (null: never arranged). */
  locked: boolean;
  z: number | null;
  /** Set while the position is not converted yet (the fractions of the window): the layout places it on its canvas the old way. */
  legacy?: LegacyRect;
  /** The scale of an overlay whose frame follows its content (`OverlaySource.grows`), once it has one. */
  scale?: number;
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
  /** The frame toolbar's setting (shown or not, the buttons in it), kept with the grid. */
  toolbar(): ToolbarSetting;
  setToolbar(change: Partial<ToolbarSetting>): void;
  /** Lock position or stacking place of an item in a setup. */
  setFlags(setupId: string, ref: LayoutItemRef, change: { locked?: boolean; z?: number }): boolean;
  /** A panel goes into a setup, at the size its module prefers; "refused" when it may not go there. */
  addPanel(setupId: string, panel: { owner: string; moduleId: string; workspaceId: string; instanceId: string }): AddResult;
  /** A source of a panel (an overlay for one key of its module) goes into a setup; "exists" when that setup has it. */
  addOverlay(setupId: string, overlay: { owner: string; moduleId: string; workspaceId: string; key: string }): AddResult;
  /** An item of a personal workspace moves between Everywhere and All games with its place and settings. */
  move(ref: LayoutItemRef, from: string, to: string): AddResult | "missing";
  /** `scale`: the new scale of a frame that follows its content; left out, it stays. */
  setRect(setupId: string, ref: LayoutItemRef, rect: AnchoredRect, scale?: number): boolean;
  /** Copies the items of a setup into a game's setup, replacing what it has or adding to it; see GameOverlayStore.copySetup. */
  copy(from: string, to: string, mode: "replace" | "add"): CopyOutcome | null;
  /** The size a new item of this kind starts with in a window of this size (Reset size), in units of the window's height. */
  startSize(ref: LayoutItemRef, window: { width: number; height: number }): { width: number; height: number };
  setOverlay(setupId: string, subject: GameOverlaySubject, change: GameOverlayChange): void;
  setPanel(setupId: string, instanceId: string, change: InGamePanelChange): void;
  remove(setupId: string, ref: LayoutItemRef): void;
  /** The item as the setup has it, whole (what undo keeps), or null when the setup hasn't it. */
  state(setupId: string, ref: LayoutItemRef): LayoutItemState | null;
  /**
   * Makes the item in the setup exactly what `state` says (undo and redo): puts it back when it isn't there, changes it when
   * it is, takes it out for null. False when that can't be done (the setup is full, its module or panel is gone).
   */
  put(setupId: string, ref: LayoutItemRef, state: LayoutItemState | null): boolean;
  layerOpen(): boolean;
}

/** An item as one setup has it, whole: what an undo step on the Overlay page keeps, to put it back exactly. */
export interface LayoutItemState {
  /** The stored item: who it is, its settings and its place. */
  item: GameOverlay | InGamePanel;
  /** Its place in the setup's list. */
  index: number;
  /** Its toggle key as it was, given back when the item returns without one (taking the last copy out takes the key). */
  key: HotkeyRecord | null;
}

/** What the host knows of a panel in the game. */
export interface PanelInfo {
  /** The name of the panel's tab; null when it has none yet. */
  name: string | null;
  /** Whether the panel's type still allows being shown in the game (`inGame`); true when that isn't known yet. */
  allowed: boolean;
  /** When the panel was used last, to give the keyboard to the newest one. */
  usedAt: number;
  /** The size the panel's module prefers (its viewport, in pixels), or null; Reset size in the Overlay layout starts from it. */
  preferred: { width?: number | undefined; height?: number | undefined } | null;
}

/**
 * What the service needs of the screen, the keyboard and the windows Electron draws: Electron's (game-layer-electron.ts)
 * or a test's stand-ins. The windows themselves are driven by LayerWindows (game-layer-windows.ts).
 */
export interface OverlayPlatform extends LayerWindowsPlatform {
  /** Whether Tavora can show game overlays here (Windows). */
  supported: boolean;
  /** Looks at the window in front; made when first needed. */
  probe(): ForegroundProbe;
  /** Physical pixels of the screen to the DIPs windows are placed in. */
  toDip(rect: Rect): Rect;
  /** The main screen (DIPs): Everywhere's area, and what a new item is sized against before any game window was seen. */
  screen?(): Rect;
  /** Whether one of Tavora's windows has the keyboard (its main window, a dialog); the service tells its own overlay windows apart. Everywhere hides then. */
  tavoraInFront?(): boolean;
  shortcuts: ShortcutRegistry;
}

export interface GameOverlayServiceOptions {
  userData: string;
  /** Stream overlays' store of overlays and the hotkeys of Streaming, which the overlays' keys live in. */
  streaming: Pick<Streaming, "overlayStore" | "removeKeys" | "moveKey" | "keyOf" | "keyRecord" | "restoreKey">;
  /** The modules installed now. */
  installed: { shown(moduleId: string): StreamingModule | undefined };
  /** The library's workspaces: names, and whether one is a game workspace (something made in a personal one may go into any setup). */
  workspaces: Pick<WorkspaceNames, "name" | "scopeOf">;
  /** The Settings > Overlays switches, read as they are now. */
  settings: Pick<Library, "gameOverlays" | "overlaysStay" | "overlaySidebar">;
  /** The game watcher: the library games a program belongs to (game-watch.ts). */
  watcher: Pick<GameWatcher, "gamesOf">;
  platform: OverlayPlatform;
  /** The host's side of panels in the game; Tavora without it has none. */
  panels?: {
    /** What the host knows of a panel (in this workspace, or wherever it is); null once the panel is gone. */
    info(instanceId: string, workspaceId?: string): PanelInfo | null;
    /**
     * Panel views lends the panel's view (made for the layer when its workspace isn't shown) into the window `open` makes
     * (panel-views.ts `lend`); null when the panel is gone or can't be. `revoked`: the panel closes for good while lent.
     */
    lend(instanceId: string, workspaceId: string, open: (panel: OverlayPanel) => OverlayWindow, revoked: () => void): PanelInGame<OverlayWindow> | null;
  };
  /** Opens Settings at one of its settings, and tells the user something (Tavora's notice and a system notification). */
  shell: Pick<Shell, "openSetting" | "notify">;
  language(): Language;
  /** Something the Settings page or the hotkeys depend on changed. */
  changed(): void;
  /** The overlays of a module in a workspace scope changed (the Overlay page added or removed one, or a panel did): its panels hear the keys now shown. */
  overGameChanged?(module: { owner: string; moduleId: string; workspaceId: string }): void;
  /** How often the window in front is looked at. */
  everyMs?: number;
}

/** The Overlay layout, which asks for the layer's items and is told when a game's window was seen or a game stopped (`useLayout`). */
export type LayoutPort = Pick<OverlayLayout, "open" | "refresh">;

export { CRASH_SPAN_MS, IDLE_CLOSE_MS, MAX_CRASHES } from "./game-layer-windows";

export const LOOK_MS = 400;
/**
 * How often the front window is looked at while overlays sit right above the game (the user is elsewhere): back in the
 * game, Windows raises it over them until the next look puts them on top again, so that look comes sooner.
 */
export const STACKED_LOOK_MS = 100;
/**
 * Looks in a row that may throw before game overlays stop for the session: a one-off Windows or koffi error is passed
 * over (what shows stays until the next look), one that keeps coming isn't. About 2 s at LOOK_MS.
 */
export const FAILED_LOOKS_ALLOWED = 5;

/** The hotkey binding of the layer key, and of one item's toggle key (an item has one key, whichever setups it is in). */
export const layerBinding = () => ({ owner: LAYER_OWNER, moduleId: LAYER_OWNER, workspaceId: ALL_GAMES, action: OVERLAY_LAYER_ACTION, target: "layer" });
export const toggleBinding = (overlay: GameOverlaySubject) => ({ owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, action: OVERLAY_TOGGLE_ACTION, target: overlay.key });

/** Whether a hotkey is one of game overlays (they are listed in Settings > Overlays, not in Streaming). */
export const isOverlayAction = (action: string) => action === OVERLAY_TOGGLE_ACTION || action === OVERLAY_LAYER_ACTION;

export class GameOverlays {
  private layoutPort: LayoutPort | undefined;
  /** The windows of the overlays and of the layer, made to do what each look decides (game-layer-windows.ts). */
  private readonly windows: LayerWindows;

  /** The user picked another interface font or theme: the frames and the layer's card take it. */
  refreshFonts(): void {
    this.windows.refreshFonts();
  }
  private readonly toggled = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  /** The quicker look while overlays are stacked above the game (STACKED_LOOK_MS). */
  private stackedTimer: ReturnType<typeof setInterval> | undefined;
  private probe: ForegroundProbe | null = null;
  /** Looks that threw since the last one that worked (FAILED_LOOKS_ALLOWED). */
  private failedLooks = 0;
  /** What the service watches: hidden for now, failed, the game in front or left (game-layer.ts `watchStep`, run by `see`). */
  private watch: Watch = WATCH_START;
  /** The in-game layer (game-layer.ts `layerStep`). */
  private layer: LayerState = LAYER_CLOSED;
  /** The window handle of each game's window as last seen in front (in memory only), to take its picture on a click. */
  private readonly handles = new Map<string, string>();
  /** The library games the game watcher says are running (game-watch.ts); a handle only counts for these. */
  private running: ReadonlySet<string> = new Set();
  /** Esc is taken while the layer is open (when the system let Tavora have it). */
  private escape = false;
  /** Whether something showed at the last look: the keys are told when that changes. */
  private wasShowing = false;
  /** Whether any window is shown over a game or the screen now (`GameOverlaysView.showing`). */
  private windowsShown = false;
  /** When each overlay's page crashed lately, and the overlays whose page crashed so often they are left alone. */
  private readonly crashes = new Map<string, number[]>();
  private readonly stopped = new Set<string>();
  /** When a failed look was last written to the log (one line per CRASH_SPAN_MS, not one per look). */
  private lastTickWarning = 0;
  /** What each panel passes to panel.setLive, and who listens (live view windows); kept while the panel exists, in memory only. */
  private readonly liveStates = new Map<string, { owner: string; state: JsonValue }>();
  /** The one pending look after a state appeared or went, so a page calling panel.setLive in a loop costs one look. */
  private liveTick: ReturnType<typeof setTimeout> | undefined;
  private readonly liveWatchers = new Map<string, Set<(state: JsonValue | null | undefined) => void>>();
  /** What each panel passes to overlay.setSources (its own list, last call wins); kept while the panel exists, in memory only. */
  private readonly sourceLists = new Map<string, { owner: string; moduleId?: string; workspaceId?: string; sources: OverlaySource[] }>();

  private constructor(
    private readonly options: GameOverlayServiceOptions,
    private readonly store: GameOverlayStore,
  ) {
    this.windows = new LayerWindows({
      platform: options.platform,
      setMode: (mode) => this.setLayerMode(mode),
      close: () => this.stepLayer({ type: "close", refocus: true }),
      usedAt: (instanceId) => options.panels?.info(instanceId)?.usedAt ?? 0,
    });
  }

  static async create(options: GameOverlayServiceOptions): Promise<GameOverlays> {
    return new GameOverlays(options, await GameOverlayStore.load(options.userData, (workspaceId) => options.workspaces.scopeOf(workspaceId)));
  }

  /** The Overlay layout, once it exists (it is made from this service's layout source, so it comes after). */
  useLayout(layout: LayoutPort): void {
    this.layoutPort = layout;
  }

  /** Starts looking at the window in front; called once Tavora is up. */
  start(): void {
    // Coming from Tavora 0.21.0 or before (file version 1): its per-game arrange keys are gone (the key set last becomes
    // the layer key, if there is none), and so are the keys of panels that were over the game then.
    if (this.store.migrated) {
      this.options.streaming.moveKey((record) => record.action === LEGACY_ARRANGE_ACTION, layerBinding());
      this.options.streaming.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.target.startsWith(RESERVED_KEY_PREFIX));
    }
    // The move to setups (and the one above) is written now; a start that stopped before this does it again.
    if (this.store.migrated || this.store.moved) void this.store.save();
    if (this.timer || !this.options.platform.supported) return;
    this.timer = setInterval(() => this.tick(), this.options.everyMs ?? LOOK_MS);
    this.timer.unref?.();
  }

  /** Whether overlays and the layer may show now: Tavora can, the switch is on, and the user didn't hide them for now. */
  private active(): boolean {
    return this.options.platform.supported && this.options.settings.gameOverlays && !this.watch.hidden;
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
    if (!this.options.platform.supported || !this.options.settings.gameOverlays) {
      if (this.options.platform.supported) this.options.shell.openSetting("game-overlays");
      return "off";
    }
    const added = this.putOverlay(module, workspaceId, key, landingSetup(workspaceId, this.options.workspaces.scopeOf(workspaceId)), true);
    return added === "full" || added === "refused" ? "full" : "shown";
  }

  /**
   * The Overlay page puts a source of a panel into the setup shown (not the landing one). Whether it went in; "exists" when
   * the setup has it already.
   */
  private addOverlayTo(setupId: string, module: StreamingModule, workspaceId: string, key: string): AddResult {
    if (!module.manifest.overlay || key.startsWith(RESERVED_KEY_PREFIX)) return "refused";
    return this.putOverlay(module, workspaceId, key, setupId, false);
  }

  /**
   * Puts the overlay for `key` into `setup` and links it. `anywhere`: one the user has in any setup already stays where it is
   * (the module's own show); else only this setup counts.
   */
  private putOverlay(module: StreamingModule, workspaceId: string, key: string, setup: string, anywhere: boolean): AddResult {
    const subject: GameOverlaySubject = { owner: module.owner, moduleId: module.manifest.id, workspaceId, key };
    const made = !this.store.hasSetup(setup);
    const added = this.store.find(subject, anywhere ? undefined : setup) ? "exists" : this.store.add(setup, subject, startRect(module.manifest.overlaySize ?? null, this.startArea(), DEFAULT_RECT));
    if (added === "full" || added === "refused") return added;
    try {
      // The link holds what the module publishes for the key; making it now means the page hears it from the start.
      // When it can't be made (too many for the module) nothing of the overlay is kept, nor the setup made for it.
      this.options.streaming.overlayStore.link(subject);
    } catch (error) {
      if (added === "added") this.store.forget((overlay, id) => id === setup && sameOverlay(overlay, subject));
      if (made) this.store.removeSetup(setup);
      throw error;
    }
    // A new frame for content that grows is as big as its content, at 100 %.
    if (added === "added") this.followContent((overlay) => sameOverlay(overlay, subject), true);
    // The user asked for it: a page that crashed too often gets another chance.
    this.revive(overlayId(subject));
    this.options.changed();
    this.tick();
    this.options.overGameChanged?.({ owner: module.owner, moduleId: module.manifest.id, workspaceId });
    return added;
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
    if (!this.options.platform.supported || !this.options.settings.gameOverlays) {
      if (this.options.platform.supported) this.options.shell.openSetting("game-overlays");
      return "off";
    }
    const setup = landingSetup(panel.workspaceId, this.options.workspaces.scopeOf(panel.workspaceId));
    const added = this.hasPanel(panel.instanceId) ? "exists" : this.store.addPanel(setup, panel, startRect(preferred, this.startArea()));
    if (added === "full" || added === "refused") return "full";
    // The user asked for it: a live view whose page crashed too often gets another chance.
    this.revivePanel(panel.instanceId);
    this.options.changed();
    this.tick();
    return "shown";
  }

  /** What a new overlay or panel is sized against: the game window in front, else the one seen last, else the main screen. */
  private startArea(): Rect | null {
    return this.gameWindow() ?? this.watch.lastGame ?? this.options.platform.screen?.() ?? null;
  }

  /** Whether the panel is in some setup. */
  hasPanel(instanceId: string): boolean {
    return this.store.panelOf(instanceId) !== undefined;
  }

  /** The workspace of a panel in some setup, or null. */
  panelWorkspace(instanceId: string): string | null {
    return this.store.panelOf(instanceId)?.workspaceId ?? null;
  }

  /** Closes the in-game layer without giving the keyboard back to the game: Tavora is about to come to the front. */
  endLayer(): void {
    this.stepLayer({ type: "close", refocus: false });
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

  /** overlay.setSources: what the panel can show over the game on its own (already checked); the Overlay page lists it under the panel. */
  setSources(instanceId: string, owner: string, sources: OverlaySource[], panel?: { moduleId: string; workspaceId: string }): void {
    // An empty list still says the panel lists its things (it has none right now), so it isn't offered as a whole either.
    this.sourceLists.set(instanceId, { owner, ...panel, sources: sources.map((source) => ({ ...source, ...(source.size ? { size: { ...source.size } } : {}) })) });
    // Frames whose content grows take its new size at once, over the game and on the Overlay page.
    if (panel && this.followContent((overlay) => overlay.owner === owner && overlay.moduleId === panel.moduleId && overlay.workspaceId === panel.workspaceId)) {
      this.options.changed();
      this.tick();
    }
    this.layoutPort?.refresh();
  }

  /** What the panel behind an overlay lists for its key, with how big its content is; null when it lists nothing for it. */
  private listedSource(subject: GameOverlaySubject): (OverlaySource & { size: { width: number; height: number } }) | null {
    for (const entry of this.sourceLists.values()) {
      if (entry.owner !== subject.owner || entry.moduleId !== subject.moduleId || entry.workspaceId !== subject.workspaceId) continue;
      const source = entry.sources.find((one) => one.key === subject.key);
      return source?.size ? (source as OverlaySource & { size: { width: number; height: number } }) : null;
    }
    return null;
  }

  /** The same, only when its content grows (`grows`): the frame follows it. */
  private growingSource(subject: GameOverlaySubject): (OverlaySource & { size: { width: number; height: number } }) | null {
    const source = this.listedSource(subject);
    return source?.grows ? source : null;
  }

  /**
   * Frames of the overlays matching `test` whose content grows get its size times their scale (overlay-content.ts). One
   * without a scale yet (from before) keeps how big its content looked: `fresh` frames start at 100 % instead. A frame
   * whose content says it doesn't grow (`grows: false`, a box the user sizes) is left as it is, and is given 100 % to start
   * from, so its text keeps its size when it grows later. A frame not converted from the old fractions yet waits. Whether
   * any changed.
   */
  private followContent(test: (overlay: GameOverlay) => boolean, fresh = false): boolean {
    let changed = false;
    for (const setupId of this.store.setupIds()) {
      for (const overlay of this.store.overlaysIn(setupId)) {
        if (!test(overlay) || overlay.legacy) continue;
        const source = this.listedSource(overlay);
        if (!source || source.grows === undefined) continue;
        const subject = { owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, key: overlay.key };
        if (!source.grows) {
          if (overlay.scale === undefined) changed = this.store.setRect(setupId, { kind: "overlay", subject }, overlay.rect, 1) || changed;
          continue;
        }
        const next = overlay.scale !== undefined || fresh ? { scale: overlay.scale ?? 1, rect: followRect(overlay.rect, source.size, overlay.scale ?? 1) } : adoptRect(overlay.rect, source.size);
        if (next.scale === overlay.scale && sameSize(next.rect, overlay.rect) && next.rect.x === overlay.rect.x && next.rect.y === overlay.rect.y) continue;
        changed = this.store.setRect(setupId, { kind: "overlay", subject }, next.rect, next.scale) || changed;
      }
    }
    return changed;
  }

  /** What a panel told overlay.setSources, if it did and its module is still its publisher's; null when it never did. */
  sourcesOf(instanceId: string, owner: string): readonly OverlaySource[] | null {
    const entry = this.sourceLists.get(instanceId);
    return entry && entry.owner === owner ? entry.sources : null;
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
    if (this.sourceLists.delete(instanceId)) this.layoutPort?.refresh();
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
      .filter((overlay) => overlay.owner === owner && overlay.moduleId === moduleId && (overlay.workspaceId === workspaceId || this.options.workspaces.scopeOf(overlay.workspaceId) === "all")).length;
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
    this.options.overGameChanged?.({ owner: subject.owner, moduleId: subject.moduleId, workspaceId: subject.workspaceId });
  }

  /** The games running now (game-watch.ts): the window remembered for a game that stopped is no window to take a picture of. */
  gamesRunning(running: ReadonlySet<string>): void {
    this.running = new Set(running);
    for (const id of [...this.handles.keys()]) if (!running.has(id)) this.handles.delete(id);
    this.layoutPort?.refresh();
  }

  /** A workspace left the library for good: its items leave every setup, and a game workspace's setup and window go too. */
  forgetWorkspace(workspaceId: string): void {
    this.store.forgetSeen(workspaceId);
    this.handles.delete(workspaceId);
    this.layoutPort?.refresh();
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
    if (this.watch.hidden === hidden) return;
    this.see({ type: "hide", hidden });
    this.tick();
    this.options.changed();
  }

  get hidden(): boolean {
    return this.watch.hidden;
  }

  /** Forgets that an overlay's page crashed. */
  private revive(id: string): void {
    this.crashes.delete(id);
    this.stopped.delete(id);
  }

  /** Forgets that a panel's live view or its window over the game crashed. */
  private revivePanel(instanceId: string): void {
    this.revive(liveWindowId(instanceId));
    this.revive(panelWindowId(instanceId));
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
    for (const panel of gone.values()) this.releasePanel(panel, clearLive);
    return true;
  }

  /** A panel is in no setup any more: its key and live state go. */
  private releasePanel(panel: InGamePanel, clearLive: boolean): void {
    if (clearLive) this.clearLive(panel.instanceId);
    this.options.streaming.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.owner === panel.owner && record.moduleId === panel.moduleId && record.workspaceId === panel.workspaceId && record.target === panel.instanceId);
    this.toggled.delete(liveWindowId(panel.instanceId));
    this.revivePanel(panel.instanceId);
  }

  /** Takes the overlays matching `test` out of their setups; one in no setup any more loses its key. Whether any went. */
  private drop(test: (overlay: GameOverlay, setupId: string) => boolean): boolean {
    const before = this.store.all().map((overlay) => ({ ...overlay }));
    if (!this.store.forget(test)) return false;
    const gone = new Map(before.filter((overlay) => !this.store.find(overlay)).map((overlay) => [overlayId(overlay), overlay]));
    for (const overlay of gone.values()) this.releaseOverlay(overlay);
    return true;
  }

  /** An overlay is in no setup any more: its key goes. */
  private releaseOverlay(overlay: GameOverlay): void {
    this.options.streaming.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.owner === overlay.owner && record.moduleId === overlay.moduleId && record.workspaceId === overlay.workspaceId && record.target === overlay.key);
    this.toggled.delete(overlayId(overlay));
    this.revive(overlayId(overlay));
  }

  /** Whether the game watcher is needed: overlays are on and a setup of games (All games, a game's) has something to show. */
  needsWatcher(): boolean {
    return this.active() && this.store.setupIds().some((id) => id !== EVERYWHERE && this.store.count(id) > 0);
  }

  // ── Which setups are on screen ───────────────────────────────────────

  /** The setups on screen now (setupsOnScreen): Everywhere unless Tavora's window is in front, and the game's or All games. */
  private onScreen(): string[] {
    // A layer over the screen holds only what the keys reach, never a game setup staying over the spot of a game left.
    if (this.layer.status === "open" && this.layer.game === null) return this.keySetups();
    return setupsOnScreen(this.frontGame() ?? awayOf(this.watch)?.game ?? null, this.watch.tavoraFront, (id) => this.store.hasSetup(id));
  }

  /** The setups whose keys work now: as on screen, but a game's only while it is in front, not while its items stay over its spot. */
  private keySetups(): string[] {
    return setupsOnScreen(this.frontGame(), this.watch.tavoraFront, (id) => this.store.hasSetup(id));
  }

  /** Where the items of a setup sit: Everywhere's on the main screen, the others on the game's window (the one in front, or the one they stay over). */
  private areaOf(setupId: string): Rect | null {
    if (setupId === EVERYWHERE) return this.options.platform.screen?.() ?? null;
    return this.gameWindow() ?? awayOf(this.watch)?.bounds ?? null;
  }

  /** Whether something shows for the keys now (keySetups have items): they work only then. */
  showing(): boolean {
    return this.active() && this.keySetups().some((id) => this.store.count(id) > 0);
  }

  /** The game in front that has something to show (its own setup, or All games), or null. */
  frontGame(): string | null {
    return frontOf(this.watch)?.game ?? null;
  }

  /** Where the game window in front is (DIPs), or null. */
  private gameWindow(): Rect | null {
    return frontOf(this.watch)?.bounds ?? null;
  }

  // ── Keys ─────────────────────────────────────────────────────────────

  /** The item a toggle key belongs to, as it is in the setups its keys work in now; undefined when it isn't. */
  private placedOfKey(record: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "target">): (Placed<GameOverlay | InGamePanel> & { id: string }) | undefined {
    const setups = this.keySetups();
    const overlay = placedOverlays(this.store, setups).get(overlayId({ owner: record.owner, moduleId: record.moduleId, workspaceId: record.workspaceId, key: record.target }));
    if (overlay) return { ...overlay, id: overlayId(overlay.item) };
    const panel = placedPanels(this.store, setups).get(record.target);
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

  /** Whether an item of this module from this workspace is in a setup whose keys work now (its module's own keys work then too). */
  moduleShowing(module: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId">): boolean {
    if (!this.showing()) return false;
    const setups = this.keySetups();
    const same = (item: { owner: string; moduleId: string; workspaceId: string }) => item.owner === module.owner && item.moduleId === module.moduleId && item.workspaceId === module.workspaceId;
    return [...placedOverlays(this.store, setups).values()].some(({ item }) => same(item)) || [...placedPanels(this.store, setups).values()].some(({ item }) => same(item));
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
    if (record.action === OVERLAY_LAYER_ACTION) return this.stepLayer({ type: "key", look: this.layerLook() });
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
    return this.layer.status === "open";
  }

  /** What the open layer is for (Use or Arrange), or null while it is closed. */
  get layerMode(): LayerMode | null {
    return this.layer.status === "open" ? this.layer.mode : null;
  }

  /** Use or Arrange, from the layer's card. Nothing while the layer is closed. */
  setLayerMode(mode: LayerMode): void {
    this.stepLayer({ type: "mode", mode });
  }

  /** What the last look saw, as the layer needs it. */
  private layerLook(): LayerLook {
    const front = frontOf(this.watch);
    return { front: front?.game ?? null, frontWindow: front?.window ?? null, foregroundWindow: this.watch.foregroundWindow, exclusive: looksExclusive(front?.notification ?? null) };
  }

  /** One step of the layer (game-layer.ts), and what it asks for: Esc, the game's keyboard, a look, or a word to the user. */
  private stepLayer(event: LayerEvent): void {
    const { state, effect } = layerStep(this.layer, event);
    this.layer = state;
    switch (effect.type) {
      case "opened":
        // Esc ends it too; the key is the game's again afterwards.
        this.escape = this.options.platform.shortcuts.register("Escape", () => this.stepLayer({ type: "close", refocus: true }));
        return this.tick();
      case "closed":
        this.dropEscape();
        if (effect.refocus) {
          // The user ended it (Esc, the key or the card), so the game gets the keyboard back; not when it left the front.
          // Only a panel takes the keyboard, but a click on an overlay's frame may have left the game without focus.
          // Before looking again, so a panel that had the keyboard isn't taken for the game being left.
          try {
            this.probe?.focus();
          } catch {
            // Best effort: the user can click the game.
          }
        }
        return this.tick();
      case "ended":
        return this.dropEscape();
      case "changed":
        return this.tick();
      case "exclusive":
        // No window can be drawn over a game that owns the screen exclusively: say so instead of opening nothing.
        return this.options.shell.notify(translate(this.options.language(), "overlays.exclusiveHint"));
      case "none":
        return;
    }
  }

  private dropEscape(): void {
    if (this.escape) this.options.platform.shortcuts.unregister("Escape");
    this.escape = false;
  }

  // ── Looking ──────────────────────────────────────────────────────────

  /** Looks at the window in front and shows or hides every item accordingly. */
  tick(): void {
    try {
      this.prune();
      if (!this.active() || this.store.empty) {
        this.closeAll();
        this.see({ type: "off" });
        this.keysFollow();
        return;
      }
      this.look();
    } catch (error) {
      // A throw from a window or a panel's view must not leave the main process with an uncaught error at every look; the next look tries again.
      const now = Date.now();
      if (now - this.lastTickWarning >= CRASH_SPAN_MS) {
        this.lastTickWarning = now;
        console.warn(`[tavora] looking at the game overlays failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Whether one of the service's own windows has the keyboard (a panel in the layer, or the layer's card). */
  private ownWindowFocused(): boolean {
    return this.windows.focused;
  }

  private look(): void {
    let foreground: Foreground | null = null;
    let failed = this.watch.failed;
    if (!failed) {
      const stop = (error: unknown) => {
        // Said once, and not tried again.
        console.warn(`[tavora] game overlays stopped: ${error instanceof Error ? error.message : String(error)}`);
        failed = true;
        clearInterval(this.timer);
        this.timer = undefined;
        this.lookQuickly(false);
      };
      try {
        this.probe ??= this.options.platform.probe();
      } catch (error) {
        // Windows' functions could not be loaded; looking again won't help.
        stop(error);
      }
      if (this.probe && !failed) {
        try {
          foreground = this.probe.look();
          this.failedLooks = 0;
        } catch (error) {
          // One call that failed passes; the next look tries again, and only failures that keep coming stop overlays.
          this.failedLooks += 1;
          if (this.failedLooks >= FAILED_LOOKS_ALLOWED) stop(error);
          else return;
        }
      }
    }
    if (failed) {
      this.closeAll();
      this.see({ type: "failed" });
      return;
    }
    // A panel in the layer took the keyboard, so Tavora's own window is in front: the game (or the desktop) still is the one in front.
    if (foreground?.own && this.layer.status === "open" && this.ownWindowFocused()) {
      this.apply();
      return;
    }
    const tavoraFront = (this.options.platform.tavoraInFront?.() ?? false) && !this.ownWindowFocused();
    const withSetups = new Set(this.store.gameSetups());
    const general = this.store.count(ALL_GAMES) > 0;
    const game = foreground?.program ? gameInFront(this.options.watcher.gamesOf(foreground.program), withSetups, general, (id) => this.options.workspaces.scopeOf(id) === "game") : null;
    const front = game !== null && foreground ? { game, bounds: this.options.platform.toDip(foreground.bounds), window: foreground.handle ?? null, notification: foreground.notification } : null;
    // Overlays stay while the user is in another window: over the game window seen in front last, while it is still open
    // and not minimized. Overlays only; the layer and the keys stay with the game in front.
    const kept = () => {
      const window = this.probe?.kept?.() ?? null;
      return window ? this.options.platform.toDip(window) : null;
    };
    this.see({ type: "look", front, foregroundWindow: foreground?.handle ?? null, tavoraFront, stay: this.options.settings.overlaysStay === true, kept });
    if (front?.window && this.handles.get(front.game) !== front.window) {
      this.handles.set(front.game, front.window);
      this.layoutPort?.refresh();
    }
    // The game in front is the one overlays stay over once the user leaves it (the probe remembers its window).
    if (front) this.probe?.keep?.();
    if (front && looksExclusive(front.notification) && !this.store.exclusiveHintShown) {
      this.store.markExclusiveHintShown();
      this.options.shell.notify(translate(this.options.language(), "overlays.exclusiveHint"));
    }
    // The layer ends (and gives the keyboard to nobody) when what it opened over is gone (layerStep).
    if (this.layer.status === "open") this.stepLayer({ type: "look", look: this.layerLook(), tavoraFront: this.watch.tavoraFront, showing: this.showing() });
    this.apply();
  }

  /**
   * One step of what the service watches (game-layer.ts `watchStep`), and what follows from it: the Overlay layout's canvas
   * takes the shape of the window last seen for the game in front, and the keys follow that game (streaming.ts sync).
   */
  private see(event: WatchEvent): void {
    const was = this.frontGame();
    this.watch = watchStep(this.watch, event);
    const front = frontOf(this.watch);
    // Each look: the positions an older Tavora saved (fractions of the window) are converted on the first real window
    // size seen. A launcher's or splash screen's window is no size to go by.
    if (event.type === "look" && front && isRealWindow(front.bounds)) {
      const seen = this.store.setSeen(front.game, front.bounds);
      const converted = this.store.convertLegacy(front.game, front.bounds);
      if (seen || converted) this.options.changed();
    }
    if ((front?.game ?? null) !== was) this.options.changed();
  }

  /** The keys work while something shows: when that changed since the last look (Tavora's window came in front, say), they follow. */
  private keysFollow(): void {
    const showing = this.showing();
    if (showing === this.wasShowing) return;
    this.wasShowing = showing;
    this.options.changed();
  }

  /** Shows what the setups and the layer say now (game-layer.ts `layerScene`), through the windows (game-layer-windows.ts). */
  private apply(): void {
    const handle = awayOf(this.watch) !== null ? Number(this.probe?.keptHandle?.() ?? 0) : 0;
    const scene = layerScene({
      active: this.active(),
      layer: this.layer,
      front: this.frontGame(),
      game: this.gameWindow(),
      setups: this.onScreen(),
      areaOf: (setupId) => this.areaOf(setupId),
      store: this.store,
      toggled: this.toggled,
      stopped: this.stopped,
      usable: (item) => {
        const module = this.options.installed.shown(item.moduleId);
        return module !== undefined && module.owner === item.owner && !!module.manifest.overlay;
      },
      hasLive: (panel) => this.liveStateOf(panel) !== undefined,
      card: (mode) => layerCardContent(this.options.language(), mode, this.options.streaming.keyOf(layerBinding())?.accelerator ?? null),
      awayHandle: handle,
      frontHandle: Number(frontOf(this.watch)?.window ?? 0) || 0,
      make: {
        overlay: (overlay, id) => this.makeOverlay(overlay, id),
        panel: (panel, id) => this.makePanel(panel, id),
        live: (panel, id, setup) => this.makeLive(panel, id, setup),
      },
    });
    this.lookQuickly(this.windows.show(scene));
    this.keysFollow();
    this.updateShowing();
  }

  /** Looks at the front window every STACKED_LOOK_MS while overlays are stacked above the game, else only at the usual pace. */
  private lookQuickly(on: boolean): void {
    if (on === (this.stackedTimer !== undefined)) return;
    if (!on || !this.timer) {
      clearInterval(this.stackedTimer);
      this.stackedTimer = undefined;
      return;
    }
    this.stackedTimer = setInterval(() => this.tick(), STACKED_LOOK_MS);
    this.stackedTimer.unref?.();
  }

  /** Tells the renderer when whether any window shows over a game or the screen changed (the header button's Live look). */
  private updateShowing(): void {
    const shown = this.windows.anyShown;
    if (shown === this.windowsShown) return;
    this.windowsShown = shown;
    this.options.changed();
  }

  private requestFor(
    subject: OverlaySubject,
    id: string,
    moved: (rect: Rect) => void,
    closeRequested: () => void,
    frameText: () => { name: string; closeLabel: string },
  ): OverlayWindowRequest {
    const store = this.options.streaming.overlayStore;
    return {
      id,
      page: () => this.pageOf(subject),
      state: () => store.peek(subject)?.state ?? null,
      watch: (fn) => {
        const link = store.peek(subject)?.link;
        return link ? store.watch(link.token, fn) : null;
      },
      gameBounds: () => this.areaOf(this.windows.setupOf(id) ?? ALL_GAMES),
      moved,
      closeRequested,
      layoutRequested: () => this.layoutPort?.open(this.windows.setupOf(id) ?? null),
      ended: () => this.crashed(id),
      // A panel clicked or given the keyboard comes above the card where they overlap: the card goes on top again.
      activated: () => this.windows.raiseCard(),
      frameText: () => ({ ...frameText(), layoutLabel: translate(this.options.language(), "overlays.layoutLabel") }),
    };
  }

  /** The overlay page of a module, looked up at every request: a module that was removed or replaced by another publisher's stops being served. */
  private pageOf(subject: Pick<OverlaySubject, "owner" | "moduleId">): OverlayPage | null {
    const now = this.options.installed.shown(subject.moduleId);
    return now && now.owner === subject.owner && now.manifest.overlay ? { root: now.root, entry: now.manifest.overlay } : null;
  }

  /** The window of a panel's live view: the module's overlay page, fed by what the panel passes to panel.setLive. */
  private makeLive(panel: InGamePanel, id: string, setup: string): WindowMaker {
    const instanceId = panel.instanceId;
    return {
      request: {
        id,
        ...this.liveSource(panel),
        gameBounds: () => this.areaOf(this.windows.setupOf(id) ?? setup),
        moved: () => {},
        closeRequested: () => {},
        layoutRequested: () => {},
        ended: () => this.crashed(id),
        frameText: () => ({ name: this.options.panels?.info(instanceId)?.name ?? panel.moduleId, closeLabel: translate(this.options.language(), "overlays.stopShowingLabel"), layoutLabel: "" }),
      },
    };
  }

  /** The user moved an item in the layer: its new place, relative to its area, goes into the setup it shows from. */
  private movedIn(id: string, ref: ItemRef, rect: Rect): void {
    const setup = this.windows.setupOf(id);
    const area = setup !== undefined ? this.areaOf(setup) : null;
    if (setup === undefined || !area) return;
    // A frame that follows its content scales with the drag and keeps the content's shape (overlay-content.ts).
    const overlay = ref.kind === "overlay" ? this.store.find(ref.subject, setup) : undefined;
    const source = overlay && !overlay.legacy ? this.growingSource(overlay) : null;
    if (overlay && source) {
      const before = placeItem(overlay, area);
      const scale = overlay.scale ?? adoptRect(overlay.rect, source.size).scale;
      const next = resizeContentRect(before, rect, source.size, scale, area.height / REFERENCE_HEIGHT);
      if (this.store.setRect(setup, ref, anchorOf(next.rect, area), next.scale)) {
        this.options.changed();
        // The window takes the content's shape at once, not only when it is let go.
        this.tick();
      }
      return;
    }
    if (this.store.setRect(setup, ref, anchorOf(rect, area))) this.options.changed();
  }

  /** The window of an overlay's page. */
  private makeOverlay(overlay: GameOverlay, id: string): WindowMaker {
    const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, key: overlay.key };
    return {
      request: this.requestFor(
        subject,
        id,
        (rect) => this.movedIn(id, { kind: "overlay", subject }, rect),
        () => this.remove(subject, this.windows.setupOf(id)),
        () => ({ name: this.nameOf(overlay), closeLabel: translate(this.options.language(), "overlays.closeLabel") }),
      ),
    };
  }

  /** The window of a panel over the game: Panel views lends the panel's view into it (panel-views.ts `lend`). */
  private makePanel(panel: InGamePanel, id: string): PanelWindowMaker {
    const subject: OverlaySubject = { owner: panel.owner, moduleId: panel.moduleId, workspaceId: panel.workspaceId, key: panel.instanceId };
    const request = this.requestFor(
      subject,
      id,
      (rect) => this.movedIn(id, { kind: "panel", instanceId: panel.instanceId }, rect),
      () => this.stopPanel(panel.instanceId, this.windows.setupOf(id)),
      () => ({ name: this.options.panels?.info(panel.instanceId)?.name ?? panel.moduleId, closeLabel: translate(this.options.language(), "overlays.stopShowingLabel") }),
    );
    return { request, lend: (open) => this.options.panels?.lend(panel.instanceId, panel.workspaceId, open, () => this.stopPanel(panel.instanceId)) ?? null };
  }

  /**
   * A window's page is gone. It is made again on the next look, unless that keeps happening. A panel's page is the
   * panel's own (its slot shows the crash): one that keeps dying over the game is no longer lent at every look either,
   * until the user shows it in the game again (hunt 2026-11-25 A15).
   */
  private crashed(id: string): void {
    this.windows.ended(id);
    const now = Date.now();
    const lately = [...(this.crashes.get(id) ?? []).filter((at) => now - at < CRASH_SPAN_MS), now];
    this.crashes.set(id, lately);
    if (lately.length < MAX_CRASHES || this.stopped.has(id)) return;
    this.stopped.add(id);
    this.options.shell.notify(translate(this.options.language(), "overlays.stopped"));
  }

  /** Overlays of a module that another publisher's module replaced can't be shown and are forgotten; so are panels that no longer exist. */
  private prune(): void {
    const replaced = (item: { moduleId: string; owner: string }) => {
      const module = this.options.installed.shown(item.moduleId);
      return module !== undefined && module.owner !== item.owner;
    };
    const overlays = this.drop(replaced);
    const panels = this.dropPanels((panel) => replaced(panel) || (this.options.panels !== undefined && ((info) => info === null || !info.allowed)(this.options.panels.info(panel.instanceId, panel.workspaceId))), true);
    if (overlays || panels) this.options.changed();
  }

  /** Every window goes, the layer closes: panels are back in their slots, nothing is left over the game or the screen. */
  private closeAll(): void {
    this.stepLayer({ type: "reset" });
    this.windows.closeAll();
    this.updateShowing();
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
    this.lookQuickly(false);
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
      gameWindow: () => this.gameWindow() ?? this.watch.lastGame,
      grid: () => this.store.grid,
      setGrid: (grid) => {
        this.store.setGrid(grid);
        this.options.changed();
      },
      toolbar: () => this.store.toolbar,
      setToolbar: (change) => {
        this.store.setToolbar(change);
        this.options.changed();
      },
      setFlags: (setupId, ref, change) => {
        const done = this.store.setFlags(setupId, ref, change);
        // The windows follow the new stacking order on this look.
        if (done) this.tick();
        return done;
      },
      running: () => {
        const front = this.frontGame();
        return [...this.running].sort((a, b) => Number(b === front) - Number(a === front));
      },
      addPanel: (setupId, panel) => this.addPanelTo(setupId, panel),
      addOverlay: (setupId, overlay) => {
        const module = this.options.installed.shown(overlay.moduleId);
        return module && module.owner === overlay.owner ? this.addOverlayTo(setupId, module, overlay.workspaceId, overlay.key) : "refused";
      },
      move: (ref, from, to) => this.moveItem(ref, from, to),
      setRect: (setupId, ref, rect, scale) => {
        const done = this.store.setRect(setupId, ref, rect, scale);
        // On screen at once: the windows take their new place on this look.
        if (done) this.tick();
        return done;
      },
      copy: (from, to, mode) => this.copySetup(from, to, mode),
      startSize: (ref, window) => {
        const area = { x: 0, y: 0, ...window };
        // The same lookups as when the item was made: an overlay's size from its module, a panel's from its viewport.
        const start =
          ref.kind === "panel"
            ? startRect(this.options.panels?.info(ref.instanceId, this.store.panelOf(ref.instanceId)?.workspaceId ?? "")?.preferred ?? null, area)
            : startRect(this.options.installed.shown(ref.subject.moduleId)?.manifest.overlaySize ?? null, area, DEFAULT_RECT);
        return { width: start.width, height: start.height };
      },
      setOverlay: (setupId, subject, change) => this.update(subject, change, setupId),
      setPanel: (setupId, instanceId, change) => this.updatePanelView(instanceId, change, setupId),
      remove: (setupId, ref) => (ref.kind === "panel" ? this.stopPanel(ref.instanceId, setupId) : this.remove(ref.subject, setupId)),
      state: (setupId, ref) => this.stateOf(setupId, ref),
      put: (setupId, ref, state) => this.putItem(setupId, ref, state),
      layerOpen: () => this.layer.status === "open",
    };
  }

  /** An item as the setup has it, whole (what undo keeps), or null when the setup hasn't it. */
  private stateOf(setupId: string, ref: ItemRef): LayoutItemState | null {
    const found = this.store.itemIn(setupId, ref);
    if (!found) return null;
    const item = found.item;
    const keyTarget = "instanceId" in item ? { owner: item.owner, moduleId: item.moduleId, workspaceId: item.workspaceId, key: item.instanceId } : item;
    return { item, index: found.index, key: this.options.streaming.keyRecord(toggleBinding(keyTarget)) };
  }

  /** Undo and redo on the Overlay page: the item in the setup becomes exactly `state` (null: it leaves). */
  private putItem(setupId: string, ref: ItemRef, state: LayoutItemState | null): boolean {
    const there = this.store.itemIn(setupId, ref) !== null;
    if (!state) {
      if (there) {
        if (ref.kind === "panel") this.stopPanel(ref.instanceId, setupId);
        else this.remove(ref.subject, setupId);
      }
      return true;
    }
    if (there) {
      if (!this.store.replace(setupId, ref, state.item)) return false;
    } else if (!this.bringBack(setupId, ref, state)) return false;
    if (state.key) this.options.streaming.restoreKey(state.key);
    this.options.changed();
    this.tick();
    return true;
  }

  /** An item comes back into a setup as it was: its module must still show it, a panel must still be open. */
  private bringBack(setupId: string, ref: ItemRef, state: LayoutItemState): boolean {
    const item = state.item;
    if (ref.kind === "panel") {
      if (this.options.panels && !this.options.panels.info(ref.instanceId, item.workspaceId)) return false;
      if (this.store.restore(setupId, item, "panel", state.index) !== "added") return false;
      this.revivePanel(ref.instanceId);
      return true;
    }
    const module = this.options.installed.shown(ref.subject.moduleId);
    if (!module || module.owner !== ref.subject.owner || !module.manifest.overlay) return false;
    if (this.store.restore(setupId, item, "overlay", state.index) !== "added") return false;
    try {
      this.options.streaming.overlayStore.link(ref.subject);
    } catch {
      this.store.forget((overlay, id) => id === setupId && sameOverlay(overlay, ref.subject));
      return false;
    }
    this.revive(overlayId(ref.subject));
    this.options.overGameChanged?.({ owner: ref.subject.owner, moduleId: ref.subject.moduleId, workspaceId: ref.subject.workspaceId });
    return true;
  }

  /** A panel the user put into a setup on the Overlay page. */
  private addPanelTo(setupId: string, panel: { owner: string; moduleId: string; workspaceId: string; instanceId: string }): AddResult {
    const preferred = this.options.panels?.info(panel.instanceId, panel.workspaceId)?.preferred ?? null;
    const added = this.store.addPanel(setupId, panel, startRect(preferred, this.startArea()));
    if (added === "added") {
      this.revivePanel(panel.instanceId);
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

  /** Copy to… on the Overlay page: a setup's items go into a game's setup (GameOverlayStore.copySetup). */
  private copySetup(from: string, to: string, mode: "replace" | "add"): CopyOutcome | null {
    // The same test as prune: a panel whose type doesn't allow being shown in game can't be shown there.
    const outcome = this.store.copySetup(from, to, mode, (item) => !("instanceId" in item) || this.options.panels === undefined || this.options.panels.info(item.instanceId, item.workspaceId)?.allowed === true);
    if (!outcome) return null;
    // What a replace took out and is in no setup any more loses its key, as when the user removes it.
    for (const overlay of outcome.removed.overlays) if (!this.store.find(overlay)) this.releaseOverlay(overlay);
    for (const panel of outcome.removed.panels) if (!this.hasPanel(panel.instanceId)) this.releasePanel(panel, false);
    if (outcome.copied > 0 || outcome.removed.overlays.length + outcome.removed.panels.length > 0) {
      this.tick();
      this.options.changed();
    }
    return outcome;
  }

  /** Remove overlay: the game's setup goes with what it holds; over the game, All games shows again. */
  removeSetup(gameId: string): boolean {
    return this.takeSetup(gameId) !== null;
  }

  /**
   * Delete overlay (the rail, the Overlay page): the same as removeSetup, and the answer is how to put the setup back
   * exactly as it was (its place in the list, every item with its place and settings, and the keys that went with them),
   * or null when the game has no setup (Everywhere and All games are never taken). The way back answers false when it
   * can't come back any more: its workspace is gone, or none of its items can be shown again. Items that can't (their panel
   * closed, their module is gone, the setup is full) stay out; the rest come back, also into a setup the game got meanwhile.
   */
  takeSetup(gameId: string): (() => boolean) | null {
    if (!isGameSetup(gameId) || !this.store.hasSetup(gameId)) return null;
    const index = this.store.setupIndex(gameId);
    const refs: ItemRef[] = [
      ...this.store.overlaysIn(gameId).map((overlay): ItemRef => ({ kind: "overlay", subject: { owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, key: overlay.key } })),
      ...this.store.panelsIn(gameId).map((panel): ItemRef => ({ kind: "panel", instanceId: panel.instanceId })),
    ];
    const kept = refs.flatMap((ref) => {
      const state = this.stateOf(gameId, ref);
      return state ? [{ ref, state }] : [];
    });
    // What only this setup held loses its key, as when its workspace goes.
    this.forget((_overlay, setupId) => setupId === gameId);
    this.forgetPanels((_panel, setupId) => setupId === gameId);
    this.store.removeSetup(gameId);
    this.options.changed();
    this.tick();
    // Once only: a second go would merge the same items into the setup again.
    let used = false;
    return () => {
      if (used) return false;
      used = true;
      return this.putBackSetup(gameId, index, kept);
    };
  }

  /**
   * The way back of takeSetup: the setup returns in its place, with the items that can be shown again. When the game has a
   * setup again by then (a module showed an overlay for it, a panel was added, Copy to… went into it), nothing of the deleted
   * one may be lost: its items are merged in. One the new setup has too (a copy of an All games item) goes back to how it
   * was, the others are added up to the limit, and what the new setup got on its own stays.
   */
  private putBackSetup(gameId: string, index: number, kept: readonly { ref: ItemRef; state: LayoutItemState }[]): boolean {
    if (this.options.workspaces.name(gameId) == null) return false;
    const made = !this.store.hasSetup(gameId);
    if (made && !this.store.insertSetup(gameId, index)) return false;
    let back = 0;
    for (const { ref, state } of kept) if (this.putItem(gameId, ref, state)) back++;
    // Nothing of a setup that had items came back: there is nothing to show for it (the new one, if any, is left alone).
    if (kept.length > 0 && back === 0) {
      if (made) this.store.removeSetup(gameId);
      return false;
    }
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
      const module = this.options.installed.shown(overlay.moduleId);
      const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, workspaceId: overlay.workspaceId, key: overlay.key };
      const id = overlayId(overlay);
      items.push({
        id,
        ref: { kind: "overlay", subject },
        name: this.nameOf(overlay),
        moduleId: overlay.moduleId,
        scope: this.options.workspaces.scopeOf(overlay.workspaceId),
        mode: overlay.mode,
        opacity: overlay.opacity,
        hideFromCapture: overlay.hideFromCapture,
        rect: overlay.rect,
        locked: overlay.locked === true,
        z: overlay.z ?? null,
        ...(overlay.legacy ? { legacy: overlay.legacy } : {}),
        ...(overlay.scale === undefined ? {} : { scale: overlay.scale }),
        hotkey: this.options.streaming.keyOf(toggleBinding(overlay)),
        toggledOn: this.toggled.has(id),
        source: module?.manifest.overlay && module.owner === overlay.owner ? this.overlaySource(subject) : null,
        keyTarget: subject,
      });
    }
    for (const panel of this.store.panelsIn(setupId)) {
      const module = this.options.installed.shown(panel.moduleId);
      const keyTarget = { owner: panel.owner, moduleId: panel.moduleId, workspaceId: panel.workspaceId, key: panel.instanceId };
      items.push({
        id: itemId(panel),
        ref: { kind: "panel", instanceId: panel.instanceId },
        name: this.options.panels?.info(panel.instanceId)?.name ?? module?.manifest.name ?? panel.moduleId,
        moduleId: panel.moduleId,
        scope: this.options.workspaces.scopeOf(panel.workspaceId),
        mode: panel.mode,
        opacity: panel.opacity,
        hideFromCapture: panel.hideFromCapture,
        rect: panel.rect,
        locked: panel.locked === true,
        z: panel.z ?? null,
        ...(panel.legacy ? { legacy: panel.legacy } : {}),
        hotkey: this.options.streaming.keyOf(toggleBinding(keyTarget)),
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
    const store = this.options.streaming.overlayStore;
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
    const name = this.options.installed.shown(overlay.moduleId)?.manifest.name ?? overlay.moduleId;
    const general = this.options.workspaces.scopeOf(overlay.workspaceId) === "all";
    const ids = new Set(
      this.store
        .all()
        .filter((item) => item.moduleId === overlay.moduleId && (general ? this.options.workspaces.scopeOf(item.workspaceId) === "all" : item.workspaceId === overlay.workspaceId))
        .map((item) => overlayId(item)),
    );
    return ids.size > 1 ? `${name} · ${overlay.key}` : name;
  }

  view(): GameOverlaysView {
    return {
      supported: this.options.platform.supported,
      enabled: this.options.settings.gameOverlays,
      stay: this.options.settings.overlaysStay ?? false,
      sidebar: this.options.settings.overlaySidebar,
      hidden: this.watch.hidden,
      showing: this.windowsShown,
      gameSetups: this.store.gameSetups(),
      layerKey: this.options.streaming.keyOf(layerBinding()),
    };
  }

  /** The name a hotkey dialog calls an overlay or the layer key by. */
  dialogNames(binding: Pick<HotkeyRecord, "owner" | "moduleId" | "workspaceId" | "action" | "target">): { label: string; module: string; action: string } {
    const language = this.options.language();
    if (binding.action === OVERLAY_LAYER_ACTION) return { label: translate(language, "overlays.layerLabel"), module: "Tavora", action: translate(language, "overlays.layerAction") };
    const where = (workspaceId: string) => (this.options.workspaces.scopeOf(workspaceId) === "all" ? translate(language, "overlays.allGames") : (this.options.workspaces.name(workspaceId) ?? workspaceId));
    const overlay = this.store.find({ owner: binding.owner, moduleId: binding.moduleId, workspaceId: binding.workspaceId, key: binding.target });
    const panel = overlay ? undefined : this.panelOfKey(binding);
    if (panel) return { label: this.options.panels?.info(panel.instanceId)?.name ?? panel.moduleId, module: where(panel.workspaceId), action: translate(language, "overlays.toggleAction") };
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

  /** Writes the last changes and leaves everything running (the cloud copy saves before it copies). */
  save(): Promise<void> {
    return this.store.save();
  }

  /** Quitting: every window closes and the last changes are written. */
  async shutdown(): Promise<void> {
    this.closeNow();
    // The keys follow what shows: with nothing, the layer and toggle keys go back to the system.
    this.see({ type: "quit" });
    this.keysFollow();
    await this.store.save();
  }
}
