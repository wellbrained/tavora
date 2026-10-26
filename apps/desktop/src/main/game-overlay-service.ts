// Game overlays as a whole (game-overlays.ts has what the player set, game-overlay-window.ts the windows): looks every
// moment at which window is in front, shows each overlay while its game is, and runs the in-game layer.
//
// Two kinds of things go over the game. Overlays are a module's overlay page, always there (or with a key of their own),
// click-through. Panels in game are whole panels the player chose to show there; they appear only while the player holds
// the layer open with the one global key: a veil over the game window, every panel in game on top of it taking input,
// and every overlay with its frame to move, resize or close. Closing the layer puts everything back: panels return to
// their workspace slots, overlays are click-through again, and the game gets the keyboard back.
//
// Tavora only reads which window is in front (foreground.ts) and draws its own windows above it.
import type { GameOverlayResult, JsonValue } from "@tavora/sdk/protocol";
import type { GameOverlaysView } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { DEFAULT_RECT, DEFAULT_PANEL_ANCHORED, anchorOf, contentScale, type AnchoredRect, type LegacyRect } from "../shared/overlay-anchor";
import type { GridSetting } from "../shared/layout-math";
import { HostError } from "./errors";
import type { Foreground, ForegroundProbe } from "./foreground";
import type { GameOverlayWindow } from "./game-overlay-window";
import {
  ALL_GAMES,
  GameOverlayStore,
  LAYER_OWNER,
  LEGACY_ARRANGE_ACTION,
  OVERLAY_LAYER_ACTION,
  OVERLAY_TOGGLE_ACTION,
  RESERVED_KEY_PREFIX,
  appliesTo,
  gameInFront,
  isLive,
  isRealWindow,
  liveWindowId,
  looksExclusive,
  overlayId,
  overlayVisible,
  startRect,
  panelWindowId,
  placeItem,
  sameOverlay,
  type GameOverlay,
  type GameOverlayChange,
  type GameOverlaySubject,
  type InGamePanel,
  type InGamePanelChange,
  type Opacity,
  type OverlayScope,
  type Rect,
  type SeenSize,
} from "./game-overlays";
import type { WindowState } from "./window-state";
import type { GameOverlaySource } from "./game-overlay-page";
import type { VeilWindow } from "./game-veil-window";
import type { HotkeyRecord, ShortcutRegistry } from "./hotkeys";
import type { OverlayPage, OverlayStore, OverlaySubject } from "./overlays";
import type { StreamingModule } from "./streaming";

/** The part of a game overlay's window the service drives (a test stands in for Electron). */
export type OverlayWindow = Pick<GameOverlayWindow, "setRect" | "setShown" | "setArranging" | "setHideFromCapture" | "setOpacity" | "destroy" | "dragging"> &
  Partial<Pick<GameOverlayWindow, "focused" | "focusPanel" | "raise" | "setZoom">>;

/** Which overlay or panel in game an item of the Overlay layout is. */
export type LayoutItemRef = { kind: "overlay"; subject: GameOverlaySubject } | { kind: "panel"; instanceId: string };

/** One overlay or panel in game as the Overlay layout sees it. */
export interface LayoutItemInfo {
  /** Stable text for the item (overlayId, or panelWindowId). */
  id: string;
  ref: LayoutItemRef;
  /** The module's name and the overlay's key when the module has several in this place, or the panel's name. */
  name: string;
  moduleId: string;
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
  items(gameId: string): LayoutItemInfo[];
  /** Games that have overlays or panels of their own, and whether anything is general (shows over every game). */
  games(): { own: string[]; general: boolean };
  seenSize(gameId: string): SeenSize | undefined;
  /** The window handle of the game's window as last seen in front, or null. */
  handleOf(gameId: string): string | null;
  /** Where the game's window is on screen now or was last seen (DIPs), or null. */
  gameWindow(): Rect | null;
  grid(): GridSetting;
  setGrid(grid: GridSetting): void;
  window(): WindowState | null;
  setWindow(state: WindowState): void;
  setRect(ref: LayoutItemRef, rect: AnchoredRect): boolean;
  resetRect(ref: LayoutItemRef): boolean;
  setOverlay(subject: GameOverlaySubject, change: GameOverlayChange): void;
  setPanel(instanceId: string, change: InGamePanelChange): void;
  remove(ref: LayoutItemRef): void;
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
  gameBounds(): Rect | null;
  moved(rect: Rect): void;
  closeRequested(): void;
  /** The player pressed the frame's Overlay layout button. */
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
  gameName(gameId: string): string | null;
  /** Whether a library entry is a real game (kind "game"), not a workspace such as Personal. Something made in the latter is general. */
  scopeOf(gameId: string): OverlayScope;
  /** The library games a program belongs to (game-watch.ts). */
  gamesOf(program: string): Set<string>;
  /** Looks at the window in front; made when first needed. */
  probe(): ForegroundProbe;
  /** Physical pixels of the screen to the DIPs windows are placed in. */
  toDip(rect: Rect): Rect;
  /** Overlays stay over the game window's spot while the player is in another window (Settings > Overlays). */
  stay?(): boolean;
  /** The main screen (DIPs): what a panel shown in the game is sized against before any game window was seen. */
  screen?(): Rect;
  openWindow(request: OverlayWindowRequest): OverlayWindow;
  /** The veil over the game window while the layer is open. */
  openVeil(): VeilWindow;
  /** The host's side of panels in the game; Tavora without it has none. */
  panels?: {
    /** The name of a panel's tab, or null once the panel is gone. */
    name(instanceId: string): string | null;
    /** Whether the panel still exists in its workspace. */
    exists(gameId: string, instanceId: string): boolean;
    /** Whether the panel's type still allows being shown in the game (`inGame`); true when that isn't known yet. */
    allowed?(gameId: string, instanceId: string): boolean;
    /** When the panel was used last, to give the keyboard to the newest one. */
    usedAt(instanceId: string): number;
    /** The window holding the panel (moved out of its workspace slot); null when the panel is gone. */
    openWindow(request: OverlayWindowRequest & { instanceId: string; gameId: string }): OverlayWindow | null;
  };
  shortcuts: ShortcutRegistry;
  /** Opens Settings at one of its settings. */
  openSetting(setting: string): void;
  /** Opens the Overlay layout window for a game (the button on the in-game layer's frames). */
  openLayout?(gameId: string | null): void;
  /** Tells the player something (Tavora's notice and a system notification). */
  notify(message: string): void;
  /** Takes away the hotkeys matching `test`. */
  removeKeys(test: (record: HotkeyRecord) => boolean): void;
  /** Takes away the hotkeys matching `test`, but gives the layer key the key of the one set last, if the layer has none. */
  moveKey(test: (record: HotkeyRecord) => boolean, to: Pick<HotkeyRecord, "owner" | "moduleId" | "gameId" | "action" | "target">): void;
  /** The key set for a binding, as Streaming holds it. */
  keyOf(binding: Pick<HotkeyRecord, "owner" | "moduleId" | "gameId" | "action" | "target">): { accelerator: string; taken: boolean } | null;
  language(): Language;
  /** Something the Settings page or the hotkeys depend on changed. */
  changed(): void;
  /** How often the window in front is looked at. */
  everyMs?: number;
}

export const LOOK_MS = 400;
/** A window of a game that is not in front is closed after this long (it is made again when the game is back). */
export const IDLE_CLOSE_MS = 30_000;
/** A page that crashed this many times within CRASH_SPAN_MS is not made again until the player shows or toggles it. */
export const MAX_CRASHES = 3;
export const CRASH_SPAN_MS = 5 * 60_000;

/** The hotkey binding of the layer key, and of one overlay's toggle key. */
export const layerBinding = () => ({ owner: LAYER_OWNER, moduleId: LAYER_OWNER, gameId: ALL_GAMES, action: OVERLAY_LAYER_ACTION, target: "layer" });
export const toggleBinding = (overlay: GameOverlaySubject) => ({ owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, action: OVERLAY_TOGGLE_ACTION, target: overlay.key });

/** Whether a hotkey is one of game overlays (they are listed in Settings > Overlays, not in Streaming). */
export const isOverlayAction = (action: string) => action === OVERLAY_TOGGLE_ACTION || action === OVERLAY_LAYER_ACTION;

interface Open {
  /** `live`: the overlay page of a panel in game, shown read-only in the panel's spot while the layer is closed. */
  kind: "overlay" | "panel" | "live";
  window: OverlayWindow;
  opacity: Opacity;
  hideFromCapture: boolean;
  arranging: boolean;
  shown: boolean;
  /** When the window was shown last, to tell which of several panel windows is the newest. */
  shownOrder: number;
  /** The content zoom the window was given (contentScale of the game window's height); 1 until set. */
  zoom: number;
  /** Since when the window is hidden because its game is not in front; null while it isn't. */
  idleSince: number | null;
  instanceId?: string;
}

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
  /** The game seen in front last, and its window while the player is in another one and overlays stay (`stay`). */
  private left: string | null = null;
  private away: { gameId: string; bounds: Rect } | null = null;
  /** The game whose in-game layer is open. */
  private layer: string | null = null;
  /** The window handle of the game window in front (when known), the one the layer opened over, and what Windows says about full screen. */
  private frontWindow: string | null = null;
  /** The window handle of each game's window as last seen in front (in memory only), to take its picture on a click. */
  private readonly handles = new Map<string, string>();
  private layerWindow: string | null = null;
  private notification: number | null = null;
  private veil: VeilWindow | null = null;
  private escape = false;
  /** "Hide all for now": nothing shows until Tavora starts again or the player shows it again. */
  private suspended = false;
  private shownCount = 0;
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
      void this.store.save();
    }
    if (this.timer || !this.options.supported) return;
    this.timer = setInterval(() => this.tick(), this.options.everyMs ?? LOOK_MS);
    this.timer.unref?.();
  }

  /** Whether overlays and the layer may show now: Tavora can, the switch is on, and the player didn't hide them for now. */
  private active(): boolean {
    return this.options.supported && this.options.enabled() && !this.suspended;
  }

  // ── What a module panel gets ─────────────────────────────────────────

  /** overlay.showOverGame for a panel of `module` in `gameId`; the module view checked the key and the click. */
  show(module: StreamingModule, gameId: string, key: string): GameOverlayResult {
    if (!module.manifest.overlay) throw new HostError("INVALID_PARAMS", "this module has no overlay page in its manifest");
    if (key.startsWith(RESERVED_KEY_PREFIX)) throw new HostError("INVALID_PARAMS", "this overlay key is reserved");
    if (!this.options.supported || !this.options.enabled()) {
      if (this.options.supported) this.options.openSetting("game-overlays");
      return "off";
    }
    const subject: GameOverlaySubject = { owner: module.owner, moduleId: module.manifest.id, gameId, key };
    const added = this.store.add(subject, this.options.scopeOf(gameId), startRect(module.manifest.overlaySize ?? null, this.startArea(), DEFAULT_RECT));
    if (added === "full") return "full";
    try {
      // The link holds what the module publishes for the key; making it now means the page hears it from the start.
      // When it can't be made (too many for the module) nothing of the overlay is kept.
      this.options.overlays.link(subject);
    } catch (error) {
      if (added === "added") this.store.forget((overlay) => sameOverlay(overlay, subject));
      throw error;
    }
    // The player asked for it: a page that crashed too often gets another chance.
    this.revive(overlayId(subject));
    this.options.changed();
    this.tick();
    return "shown";
  }

  /** overlay.hideOverGame: takes this module's overlay for `key` away from the workspace's scope; nothing happens when there is none. */
  hide(module: StreamingModule, gameId: string, key: string): void {
    this.remove({ owner: module.owner, moduleId: module.manifest.id, gameId, key });
  }

  /** overlay.overGame: the keys of this module's game overlays in the workspace's scope. */
  keysOf(module: StreamingModule, gameId: string): string[] {
    return this.store.all().filter((overlay) => overlay.owner === module.owner && overlay.moduleId === module.manifest.id && overlay.gameId === gameId).map((overlay) => overlay.key);
  }

  /**
   * The player chose Show in game in a panel's menu (offered only for panel types the manifest marks `inGame`, checked by
   * the host). The panel is then over the game whenever the player opens the layer. Counts toward the game's overlays;
   * "off" opens Settings > Overlays. It starts at the size its module prefers (`preferred`, the panel's viewport).
   */
  showPanel(panel: { owner: string; moduleId: string; gameId: string; instanceId: string }, preferred: { width?: number | undefined; height?: number | undefined } | null = null): GameOverlayResult {
    if (!this.options.supported || !this.options.enabled()) {
      if (this.options.supported) this.options.openSetting("game-overlays");
      return "off";
    }
    const added = this.store.addPanel({ ...panel, scope: this.options.scopeOf(panel.gameId) }, startRect(preferred, this.startArea()));
    if (added === "full") return "full";
    // The player asked for it: a live view whose page crashed too often gets another chance.
    this.revive(liveWindowId(panel.instanceId));
    this.options.changed();
    this.tick();
    return "shown";
  }

  /** What a new overlay or panel is sized against: the game window in front, else the one seen last, else the main screen. */
  private startArea(): Rect | null {
    return this.game ?? this.lastGame ?? this.options.screen?.() ?? null;
  }

  /** Whether the panel is one the player shows in their game. */
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

  /** Settings > Overlays: the live view's mode, opacity and Hide from capture of a panel in the game. */
  updatePanelView(instanceId: string, change: InGamePanelChange): void {
    if (this.store.updatePanelView(instanceId, change)) this.tick();
    this.options.changed();
  }

  /** The overlay subject a panel's toggle key is kept under (its instance id is the key), or null when the panel isn't in the game. */
  panelSubject(instanceId: string): GameOverlaySubject | null {
    const panel = this.store.panelOf(instanceId);
    return panel ? { owner: panel.owner, moduleId: panel.moduleId, gameId: panel.gameId, key: panel.instanceId } : null;
  }

  /** The panel in game a toggle key belongs to. */
  private panelOfKey(record: Pick<HotkeyRecord, "owner" | "moduleId" | "gameId" | "target">): InGamePanel | undefined {
    const panel = this.store.panelOf(record.target);
    return panel && panel.owner === record.owner && panel.moduleId === record.moduleId && panel.gameId === record.gameId ? panel : undefined;
  }

  /** Stop showing in game (or the panel is closing): the panel stays in its workspace slot. */
  stopPanel(instanceId: string): void {
    this.forgetPanels((panel) => panel.instanceId === instanceId);
  }

  /** The Live badge of a panel's tab: it is in the game, or its module has an overlay that shows over its workspace's game. */
  liveFor(instanceId: string, owner: string, moduleId: string, gameId: string): boolean {
    const overlays = this.store.all().filter((overlay) => overlay.owner === owner && overlay.moduleId === moduleId && (overlay.scope === "all" || overlay.gameId === gameId)).length;
    return isLive(this.hasPanel(instanceId), overlays);
  }

  // ── Settings > Overlays ──────────────────────────────────────────────

  update(subject: GameOverlaySubject, change: GameOverlayChange): void {
    if (this.store.update(subject, change)) this.tick();
    this.options.changed();
  }

  /** The player removed an overlay, or closed it in the layer. */
  remove(subject: GameOverlaySubject): void {
    this.forget((overlay) => sameOverlay(overlay, subject));
  }

  /** The games running now (game-watch.ts): the window remembered for a game that stopped is no window to take a picture of. */
  gamesRunning(running: ReadonlySet<string>): void {
    for (const id of [...this.handles.keys()]) if (!running.has(id)) this.handles.delete(id);
  }

  /** A game left the library for good. */
  forgetGame(gameId: string): void {
    this.store.forgetSeen(gameId);
    this.handles.delete(gameId);
    this.forget((overlay) => overlay.gameId === gameId);
    this.forgetPanels((panel) => panel.gameId === gameId, true);
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

  private forget(test: (overlay: GameOverlay) => boolean): void {
    if (!this.drop(test)) return;
    this.tick();
    this.options.changed();
  }

  private forgetPanels(test: (panel: InGamePanel) => boolean, clearLive = false): void {
    if (!this.dropPanels(test, clearLive)) return;
    this.tick();
    this.options.changed();
  }

  /** Forgets the panels matching `test` with their live view's key; whether any went. */
  private dropPanels(test: (panel: InGamePanel) => boolean, clearLive = false): boolean {
    const gone = this.store.panels().filter(test);
    if (!this.store.forgetPanels(test)) return false;
    for (const panel of gone) {
      if (clearLive) this.clearLive(panel.instanceId);
      this.options.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.owner === panel.owner && record.moduleId === panel.moduleId && record.gameId === panel.gameId && record.target === panel.instanceId);
      this.toggled.delete(liveWindowId(panel.instanceId));
      this.revive(liveWindowId(panel.instanceId));
    }
    return true;
  }

  /** Forgets the overlays matching `test` with their keys; whether any went. */
  private drop(test: (overlay: GameOverlay) => boolean): boolean {
    const gone = this.store.all().filter(test);
    if (!this.store.forget(test)) return false;
    for (const overlay of gone) {
      this.options.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.owner === overlay.owner && record.moduleId === overlay.moduleId && record.gameId === overlay.gameId && record.target === overlay.key);
      this.toggled.delete(overlayId(overlay));
      this.revive(overlayId(overlay));
    }
    return true;
  }

  /** Whether the window in front needs watching: overlays are on and there is something to show. */
  needsWatcher(): boolean {
    return this.active() && (this.store.all().length > 0 || this.store.panels().length > 0);
  }

  // ── Keys ─────────────────────────────────────────────────────────────

  /** The game whose keys work now: the one in front. */
  frontGame(): string | null {
    return this.front;
  }

  /** Whether a hotkey of game overlays should be registered now (only while a game with something to show is in front). */
  wants(record: HotkeyRecord): boolean {
    if (!this.active() || this.front === null) return false;
    if (record.action === OVERLAY_LAYER_ACTION) return true;
    if (record.action !== OVERLAY_TOGGLE_ACTION) return false;
    const item = this.store.find({ owner: record.owner, moduleId: record.moduleId, gameId: record.gameId, key: record.target }) ?? this.panelOfKey(record);
    return item?.mode === "toggle" && appliesTo(item, this.front);
  }

  /** Whether a key works over every game (the layer key, and the toggle key of a general overlay): it collides with any game's keys. */
  general(record: Pick<HotkeyRecord, "owner" | "moduleId" | "gameId" | "action" | "target">): boolean {
    if (record.action === OVERLAY_LAYER_ACTION) return true;
    if (record.action !== OVERLAY_TOGGLE_ACTION) return false;
    return (this.store.find({ owner: record.owner, moduleId: record.moduleId, gameId: record.gameId, key: record.target }) ?? this.panelOfKey(record))?.scope === "all";
  }

  pressed(record: HotkeyRecord): void {
    if (this.front === null) return;
    if (record.action === OVERLAY_LAYER_ACTION) {
      if (this.layer !== null) this.closeLayer(true);
      else if (looksExclusive(this.notification)) {
        // No window can be drawn over a game that owns the screen exclusively: say so instead of opening nothing.
        this.options.notify(translate(this.options.language(), "overlays.exclusiveHint"));
      } else this.openLayer(this.front);
      return;
    }
    const overlay = this.store.find({ owner: record.owner, moduleId: record.moduleId, gameId: record.gameId, key: record.target });
    const panel = overlay ? undefined : this.panelOfKey(record);
    const item = overlay ?? panel;
    if (!item || item.mode !== "toggle" || !appliesTo(item, this.front)) return;
    const id = panel ? liveWindowId(panel.instanceId) : overlayId(overlay!);
    if (!this.toggled.delete(id)) this.toggled.add(id);
    // Toggling is the player asking for it, also for a page that crashed too often.
    this.revive(id);
    this.tick();
    // The Overlay layout shows it too.
    this.options.changed();
  }

  /** Whether the in-game layer is open. */
  get layerOpen(): boolean {
    return this.layer !== null;
  }

  private openLayer(gameId: string): void {
    this.layer = gameId;
    // The layer belongs to this game window: another window of the program (a restart) is not the one it opened over.
    this.layerWindow = this.frontWindow;
    // Esc ends it too; the key is the game's again afterwards.
    this.escape = this.options.shortcuts.register("Escape", () => this.closeLayer(true));
    this.tick();
  }

  /** Closes the layer. `refocus`: the player ended it (Esc or the key), so the game gets the keyboard back; not when it left the front. */
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
        // Best effort: the player can click the game.
      }
    }
    this.tick();
  }

  // ── Looking ──────────────────────────────────────────────────────────

  /** Looks at the window in front and shows or hides every overlay accordingly. */
  tick(): void {
    this.prune();
    if (!this.active() || (this.store.all().length === 0 && this.store.panels().length === 0)) {
      this.closeAll();
      this.setFront(null, null);
      this.left = null;
      this.away = null;
      return;
    }
    return this.look();
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
    // A panel in the layer took the keyboard, so Tavora's own window is in front: the game still is the one in front.
    if (foreground?.own && this.layer !== null && [...this.open.values()].some((entry) => entry.window.focused)) {
      this.apply();
      return;
    }
    const withItems = new Set([...this.store.all(), ...this.store.panels()].filter((item) => item.scope === "game").map((item) => item.gameId));
    const general = [...this.store.all(), ...this.store.panels()].some((item) => item.scope === "all");
    const front = foreground?.program ? gameInFront(this.options.gamesOf(foreground.program), withItems, general, (id) => this.options.scopeOf(id) === "game") : null;
    this.setFront(front, front && foreground ? this.options.toDip(foreground.bounds) : null);
    this.frontWindow = front && foreground?.handle ? foreground.handle : null;
    if (front && this.frontWindow) this.handles.set(front, this.frontWindow);
    this.notification = front && foreground ? foreground.notification : null;
    this.away = this.stayingAway(front);
    if (front && foreground && looksExclusive(foreground.notification) && !this.store.exclusiveHintShown) {
      this.store.markExclusiveHintShown();
      this.options.notify(translate(this.options.language(), "overlays.exclusiveHint"));
    }
    // The layer ends (and gives the keyboard to nobody) when its game window is gone, minimized, another one, or the game went exclusive full screen.
    if (this.layer !== null && (this.layer !== this.front || (this.layerWindow !== null && this.frontWindow !== this.layerWindow) || looksExclusive(this.notification))) this.closeLayer(false);
    this.apply();
  }

  /**
   * Where overlays stay while the player is in another window: over the game window seen in front last, while it is
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

  private apply(): void {
    const active = this.active();
    const now = Date.now();
    const live = new Set<string>();
    const started: Open[] = [];
    const front = this.front;
    const layerOpen = this.layer !== null && this.layer === front && this.game !== null;
    // Overlays show over the game in front, or stay over the one the player left.
    const shownGame = front ?? this.away?.gameId ?? null;
    const area = this.game ?? this.away?.bounds ?? null;
    // The veil first: everything shown after it is above it.
    let veilNew = false;
    if (layerOpen) {
      if (!this.veil) {
        this.veil = this.options.openVeil();
        veilNew = true;
      }
      this.veil.place(this.game!);
    } else if (this.veil) {
      this.veil.destroy();
      this.veil = null;
    }
    for (const overlay of this.store.all()) {
      const id = overlayId(overlay);
      live.add(id);
      const module = this.options.module(overlay.moduleId);
      const usable = module !== undefined && module.owner === overlay.owner && !!module.manifest.overlay;
      const inFront = shownGame !== null && appliesTo(overlay, shownGame);
      const visible = usable && !this.stopped.has(id) && area !== null && overlayVisible({ enabled: active, gameInFront: inFront, mode: overlay.mode, toggledOn: this.toggled.has(id), layerOpen: layerOpen && inFront });
      let entry = this.open.get(id);
      if (!visible) {
        if (entry?.shown) {
          entry.window.setArranging(false);
          entry.arranging = false;
          entry.window.setShown(false);
          entry.shown = false;
        }
        if (entry) {
          // Hidden because its game is gone from the front for a while: the window goes, and is made again on show.
          entry.idleSince = inFront ? null : (entry.idleSince ?? now);
          if (entry.idleSince !== null && now - entry.idleSince >= IDLE_CLOSE_MS) this.dropWindow(id);
        }
        continue;
      }
      entry ??= this.create(overlay, id) ?? undefined;
      if (!entry) continue;
      entry.idleSince = null;
      if (entry.opacity !== overlay.opacity) entry.window.setOpacity((entry.opacity = overlay.opacity));
      if (entry.hideFromCapture !== overlay.hideFromCapture) entry.window.setHideFromCapture((entry.hideFromCapture = overlay.hideFromCapture));
      if (!entry.window.dragging) entry.window.setRect(placeItem(overlay, area!));
      this.zoomTo(entry, area!);
      if (!entry.shown) {
        entry.window.setShown((entry.shown = true));
        entry.shownOrder = ++this.shownCount;
      }
      // After the window has its place and is shown (on top), never before: a window that takes the mouse while still unplaced would flash in the wrong spot.
      const arranging = layerOpen;
      if (entry.arranging !== arranging) entry.window.setArranging((entry.arranging = arranging));
    }
    // Panels in game are over the game only while the layer is open.
    const gone: InGamePanel[] = [];
    if (layerOpen && front !== null) {
      for (const panel of this.store.panelsOf(front)) {
        const id = panelWindowId(panel.instanceId);
        live.add(id);
        let entry = this.open.get(id);
        if (!entry) {
          entry = this.createPanel(panel, id) ?? undefined;
          if (!entry) {
            gone.push(panel);
            continue;
          }
        }
        if (!entry.window.dragging) entry.window.setRect(placeItem(panel, this.game!));
        this.zoomTo(entry, this.game!);
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
    // Live views: a panel in game shows its module's overlay page read-only in its own spot while the layer is closed.
    // With the layer open the full panel is there instead, so the view goes quiet (and comes back in the new spot).
    for (const panel of this.store.panels()) {
      const id = liveWindowId(panel.instanceId);
      live.add(id);
      const module = this.options.module(panel.moduleId);
      const usable = module !== undefined && module.owner === panel.owner && !!module.manifest.overlay;
      const inFront = shownGame !== null && appliesTo(panel, shownGame);
      const visible = usable && this.liveStateOf(panel) !== undefined && !this.stopped.has(id) && area !== null && !layerOpen && overlayVisible({ enabled: active, gameInFront: inFront, mode: panel.mode, toggledOn: this.toggled.has(id), layerOpen: false });
      let entry = this.open.get(id);
      if (!visible) {
        if (entry?.shown) {
          entry.window.setShown(false);
          entry.shown = false;
        }
        if (entry) {
          entry.idleSince = inFront ? null : (entry.idleSince ?? now);
          if (entry.idleSince !== null && now - entry.idleSince >= IDLE_CLOSE_MS) this.dropWindow(id);
        }
        continue;
      }
      entry ??= this.createLive(panel, id);
      entry.idleSince = null;
      if (entry.opacity !== panel.opacity) entry.window.setOpacity((entry.opacity = panel.opacity));
      if (entry.hideFromCapture !== panel.hideFromCapture) entry.window.setHideFromCapture((entry.hideFromCapture = panel.hideFromCapture));
      entry.window.setRect(placeItem(panel, area!));
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
    // A panel that is gone (its window couldn't be made) is no longer in the game either.
    if (gone.length > 0) this.forgetPanels((panel) => gone.includes(panel));
  }

  /** Content in the game's windows scales with the game window's height (contentScale), from a 1080p reference. */
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
      gameBounds: () => this.game ?? this.away?.bounds ?? null,
      moved,
      closeRequested,
      layoutRequested: () => this.options.openLayout?.(this.front),
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
  private createLive(panel: InGamePanel, id: string): Open {
    const instanceId = panel.instanceId;
    const window = this.options.openWindow({
      id,
      ...this.liveSource(panel),
      gameBounds: () => this.game ?? this.away?.bounds ?? null,
      moved: () => {},
      closeRequested: () => {},
      layoutRequested: () => {},
      ended: () => this.crashed(id),
      frameText: () => ({ name: this.options.panels?.name(instanceId) ?? panel.moduleId, closeLabel: translate(this.options.language(), "overlays.stopShowingLabel"), layoutLabel: "" }),
    });
    const entry: Open = { kind: "live", window, opacity: 100, hideFromCapture: false, arranging: false, shown: false, shownOrder: 0, zoom: 1, idleSince: null, instanceId };
    this.open.set(id, entry);
    return entry;
  }

  private create(overlay: GameOverlay, id: string): Open | null {
    const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, key: overlay.key };
    const request = this.requestFor(
      subject,
      id,
      (rect) => {
        if (this.game) this.store.update(subject, { rect: anchorOf(rect, this.game) });
      },
      () => this.remove(subject),
      () => ({ name: this.nameOf(overlay), closeLabel: translate(this.options.language(), "overlays.closeLabel") }),
    );
    const window = this.options.openWindow(request);
    // A new window is fully opaque, click-through and visible to capture; apply sets the rest.
    const entry: Open = { kind: "overlay", window, opacity: 100, hideFromCapture: false, arranging: false, shown: false, shownOrder: 0, zoom: 1, idleSince: null };
    this.open.set(id, entry);
    return entry;
  }

  private createPanel(panel: InGamePanel, id: string): Open | null {
    const subject: OverlaySubject = { owner: panel.owner, moduleId: panel.moduleId, gameId: panel.gameId, key: panel.instanceId };
    const request = this.requestFor(
      subject,
      id,
      (rect) => {
        if (this.game) this.store.updatePanel(panel.instanceId, anchorOf(rect, this.game));
      },
      () => this.stopPanel(panel.instanceId),
      () => ({ name: this.options.panels?.name(panel.instanceId) ?? panel.moduleId, closeLabel: translate(this.options.language(), "overlays.stopShowingLabel") }),
    );
    const window = this.options.panels?.openWindow({ ...request, instanceId: panel.instanceId, gameId: panel.gameId });
    if (!window) return null;
    const entry: Open = { kind: "panel", window, opacity: 100, hideFromCapture: false, arranging: false, shown: false, shownOrder: 0, zoom: 1, idleSince: null, instanceId: panel.instanceId };
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
    const panels = this.dropPanels((panel) => replaced(panel) || (this.options.panels !== undefined && (!this.options.panels.exists(panel.gameId, panel.instanceId) || this.options.panels.allowed?.(panel.gameId, panel.instanceId) === false)), true);
    if (overlays || panels) this.options.changed();
  }

  /** Every window goes, the layer closes: panels are back in their slots, nothing is left over the game. */
  private closeAll(): void {
    this.endLayerQuietly();
    for (const entry of this.open.values()) entry.window.destroy();
    this.open.clear();
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

  /** What the Overlay layout needs of the overlays and panels in game (overlay-layout.ts). */
  get layout(): LayoutSource {
    return {
      items: (gameId) => this.layoutItems(gameId),
      games: () => {
        const own = new Set<string>();
        for (const item of [...this.store.all(), ...this.store.panels()]) if (item.scope === "game") own.add(item.gameId);
        return { own: [...own], general: [...this.store.all(), ...this.store.panels()].some((item) => item.scope === "all") };
      },
      seenSize: (gameId) => this.store.seenSize(gameId),
      handleOf: (gameId) => this.handles.get(gameId) ?? null,
      gameWindow: () => this.game ?? this.lastGame,
      grid: () => this.store.grid,
      setGrid: (grid) => {
        this.store.setGrid(grid);
        this.options.changed();
      },
      window: () => this.store.layoutWindow,
      setWindow: (state) => this.store.setLayoutWindow(state),
      setRect: (ref, rect) => {
        const done = ref.kind === "panel" ? this.store.setRect({ instanceId: ref.instanceId }, rect) : this.store.setRect(ref.subject, rect);
        // Over the game at once: the windows take their new place on this look.
        if (done) this.tick();
        return done;
      },
      resetRect: (ref) => {
        const done = ref.kind === "panel" ? this.store.setRect({ instanceId: ref.instanceId }, DEFAULT_PANEL_ANCHORED) : this.store.setRect(ref.subject, DEFAULT_RECT);
        if (done) this.tick();
        return done;
      },
      setOverlay: (subject, change) => this.update(subject, change),
      setPanel: (instanceId, change) => this.updatePanelView(instanceId, change),
      remove: (ref) => (ref.kind === "panel" ? this.stopPanel(ref.instanceId) : this.remove(ref.subject)),
      layerOpen: () => this.layer !== null,
    };
  }

  /** The overlays and panels in game that show over `gameId` (its own and the general ones), in the order the player made them. */
  private layoutItems(gameId: string): LayoutItemInfo[] {
    const items: LayoutItemInfo[] = [];
    for (const overlay of this.store.of(gameId)) {
      const module = this.options.module(overlay.moduleId);
      const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, key: overlay.key };
      const id = overlayId(overlay);
      items.push({
        id,
        ref: { kind: "overlay", subject },
        name: this.nameOf(overlay),
        moduleId: overlay.moduleId,
        scope: overlay.scope,
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
    for (const panel of this.store.panelsOf(gameId)) {
      const module = this.options.module(panel.moduleId);
      const id = liveWindowId(panel.instanceId);
      items.push({
        id: panelWindowId(panel.instanceId),
        ref: { kind: "panel", instanceId: panel.instanceId },
        name: this.options.panels?.name(panel.instanceId) ?? module?.manifest.name ?? panel.moduleId,
        moduleId: panel.moduleId,
        scope: panel.scope,
        mode: panel.mode,
        opacity: panel.opacity,
        hideFromCapture: panel.hideFromCapture,
        rect: panel.rect,
        ...(panel.legacy ? { legacy: panel.legacy } : {}),
        hotkey: this.options.keyOf(toggleBinding({ owner: panel.owner, moduleId: panel.moduleId, gameId: panel.gameId, key: panel.instanceId })),
        toggledOn: this.toggled.has(id),
        // A panel without an overlay page in its module is drawn as a box with its name.
        source: module?.manifest.overlay && module.owner === panel.owner ? this.liveSource(panel) : null,
        keyTarget: { owner: panel.owner, moduleId: panel.moduleId, gameId: panel.gameId, key: panel.instanceId },
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

  /** What Settings shows for an overlay: its module's name, and the key when the module has several in the same place. */
  private nameOf(overlay: GameOverlay): string {
    const name = this.options.module(overlay.moduleId)?.manifest.name ?? overlay.moduleId;
    const several = this.store.all().filter((item) => item.moduleId === overlay.moduleId && item.scope === overlay.scope && (overlay.scope === "all" || item.gameId === overlay.gameId)).length > 1;
    return several ? `${name} · ${overlay.key}` : name;
  }

  view(): GameOverlaysView {
    return {
      supported: this.options.supported,
      enabled: this.options.enabled(),
      stay: this.options.stay?.() ?? false,
      hidden: this.suspended,
      layerKey: this.options.keyOf(layerBinding()),
    };
  }

  /** The name a hotkey dialog calls an overlay or the layer key by. */
  dialogNames(binding: Pick<HotkeyRecord, "owner" | "moduleId" | "gameId" | "action" | "target">): { label: string; module: string; action: string } {
    const language = this.options.language();
    if (binding.action === OVERLAY_LAYER_ACTION) return { label: translate(language, "overlays.layerLabel"), module: "Tavora", action: translate(language, "overlays.layerAction") };
    const overlay = this.store.find({ owner: binding.owner, moduleId: binding.moduleId, gameId: binding.gameId, key: binding.target });
    const panel = overlay ? undefined : this.panelOfKey(binding);
    if (panel) {
      const where = panel.scope === "all" ? translate(language, "overlays.allGames") : (this.options.gameName(panel.gameId) ?? panel.gameId);
      return { label: this.options.panels?.name(panel.instanceId) ?? panel.moduleId, module: where, action: translate(language, "overlays.toggleAction") };
    }
    const game = overlay?.scope === "all" ? translate(language, "overlays.allGames") : (this.options.gameName(binding.gameId) ?? binding.gameId);
    return { label: overlay ? this.nameOf(overlay) : binding.target, module: game, action: translate(language, "overlays.toggleAction") };
  }

  /** Whether the player has this overlay (a key can be set only for one that exists). */
  has(subject: GameOverlaySubject): boolean {
    return this.store.find(subject) !== undefined;
  }

  /** Whether the key is one of an overlay or of a panel in game: a toggle key can be set for either. */
  hasKey(subject: GameOverlaySubject): boolean {
    return this.has(subject) || this.panelOfKey({ ...subject, target: subject.key }) !== undefined;
  }

  /** Quitting: every window closes and the last changes are written. */
  async shutdown(): Promise<void> {
    this.closeNow();
    // The keys follow the game in front: with none, the layer and toggle keys go back to the system.
    this.setFront(null, null);
    await this.store.save();
  }

}
