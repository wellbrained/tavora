// Game overlays as a whole (game-overlays.ts has what the player set, game-overlay-window.ts the windows): looks every
// moment at which window is in front, shows each overlay while its game is, and handles the keys that toggle overlays
// or arrange them. Tavora only reads which window is in front (foreground.ts) and draws its own windows above it.
// A panel the player moved over its game (from Tavora's own panel menu) is one of these overlays too, with a key of its
// own (panelKey) and a window that holds the panel's view instead of an overlay page.
import type { GameOverlayResult, JsonValue } from "@tavora/sdk/protocol";
import type { GameOverlaysView } from "../shared/host-api";
import { translate, type Language } from "../shared/i18n";
import { HostError } from "./errors";
import type { Foreground, ForegroundProbe } from "./foreground";
import type { GameOverlayWindow } from "./game-overlay-window";
import {
  ARRANGE_OWNER,
  GameOverlayStore,
  OVERLAY_ARRANGE_ACTION,
  OVERLAY_TOGGLE_ACTION,
  gameInFront,
  isPanelKey,
  looksExclusive,
  overlayId,
  overlayVisible,
  panelInstanceOf,
  panelKey,
  placeRelative,
  relativeTo,
  sameOverlay,
  type GameOverlay,
  type GameOverlayChange,
  type GameOverlaySubject,
  type Opacity,
  type Rect,
} from "./game-overlays";
import type { HotkeyRecord, ShortcutRegistry } from "./hotkeys";
import type { OverlayPage, OverlayStore, OverlaySubject } from "./overlays";
import type { StreamingModule } from "./streaming";

/** The part of a game overlay's window the service drives (a test stands in for Electron). */
export type OverlayWindow = Pick<GameOverlayWindow, "setRect" | "setShown" | "setArranging" | "setHideFromCapture" | "setOpacity" | "destroy" | "dragging"> &
  Partial<Pick<GameOverlayWindow, "focused" | "focusPanel">>;

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
  ended(): void;
  frameText(): { name: string; closeLabel: string };
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
  /** The library games a program belongs to (game-watch.ts). */
  gamesOf(program: string): Set<string>;
  /** Looks at the window in front; made when first needed. */
  probe(): ForegroundProbe;
  /** Physical pixels of the screen to the DIPs windows are placed in. */
  toDip(rect: Rect): Rect;
  openWindow(request: OverlayWindowRequest): OverlayWindow;
  /** The host's side of panels over the game; Tavora without it has none. */
  panels?: {
    /** The name of a panel's tab, or null once the panel is gone. */
    name(instanceId: string): string | null;
    /** The window holding the panel (moved out of its workspace slot); null when the panel is gone. */
    openWindow(request: OverlayWindowRequest & { instanceId: string; gameId: string }): OverlayWindow | null;
  };
  shortcuts: ShortcutRegistry;
  /** Opens Settings at one of its settings. */
  openSetting(setting: string): void;
  /** Tells the player something (Tavora's notice and a system notification). */
  notify(message: string): void;
  /** Takes away the hotkeys matching `test`. */
  removeKeys(test: (record: HotkeyRecord) => boolean): void;
  /** The keys of one game: its arrange key and an overlay's key, as Streaming holds them. */
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

/** The hotkey binding of a game's arrange key, and of one overlay's toggle key. */
export const arrangeBinding = (gameId: string) => ({ owner: ARRANGE_OWNER, moduleId: ARRANGE_OWNER, gameId, action: OVERLAY_ARRANGE_ACTION, target: "arrange" });
export const toggleBinding = (overlay: GameOverlaySubject) => ({ owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, action: OVERLAY_TOGGLE_ACTION, target: overlay.key });

/** Whether a hotkey is one of game overlays (they are listed in Settings > Overlays, not in Streaming). */
export const isOverlayAction = (action: string) => action === OVERLAY_TOGGLE_ACTION || action === OVERLAY_ARRANGE_ACTION;

interface Open {
  window: OverlayWindow;
  opacity: Opacity;
  hideFromCapture: boolean;
  arranging: boolean;
  shown: boolean;
  /** When the window was shown last, to tell which of several panel windows is the newest. */
  shownOrder: number;
  /** Since when the window is hidden because its game is not in front; null while it isn't. */
  idleSince: number | null;
}

export class GameOverlays {
  private readonly open = new Map<string, Open>();
  private readonly toggled = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private probe: ForegroundProbe | null = null;
  /** The game in front that has overlays, and where its window is (DIPs). */
  private front: string | null = null;
  private game: Rect | null = null;
  private arranging: string | null = null;
  private escape = false;
  private shownCount = 0;
  /** When each overlay's page crashed lately, and the overlays whose page crashed so often they are left alone. */
  private readonly crashes = new Map<string, number[]>();
  private readonly stopped = new Set<string>();

  private constructor(
    private readonly options: GameOverlayServiceOptions,
    private readonly store: GameOverlayStore,
  ) {}

  static async create(options: GameOverlayServiceOptions): Promise<GameOverlays> {
    return new GameOverlays(options, await GameOverlayStore.load(options.userData));
  }

  /** Starts looking at the window in front; called once Tavora is up. */
  start(): void {
    // A panel over the game isn't kept across a restart, so the key set for it isn't either.
    this.options.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && isPanelKey(record.target));
    if (this.timer || !this.options.supported) return;
    this.timer = setInterval(() => this.tick(), this.options.everyMs ?? LOOK_MS);
    this.timer.unref?.();
  }

  // ── What a module panel gets ─────────────────────────────────────────

  /** overlay.showOverGame for a panel of `module` in `gameId`; the module view checked the key and the click. */
  show(module: StreamingModule, gameId: string, key: string): GameOverlayResult {
    // Those keys are the panels the player moves over the game themselves.
    if (isPanelKey(key)) throw new HostError("INVALID_PARAMS", "this overlay key is reserved");
    if (!module.manifest.overlay) throw new HostError("INVALID_PARAMS", "this module has no overlay page in its manifest");
    if (!this.options.supported || !this.options.enabled()) {
      if (this.options.supported) this.options.openSetting("game-overlays");
      return "off";
    }
    const subject: GameOverlaySubject = { owner: module.owner, moduleId: module.manifest.id, gameId, key };
    const added = this.store.add(subject);
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

  /**
   * The player chose Show over game in a panel's menu, which is the consent: the panel (of the game shown now, checked by
   * the host) moves into a window over the game. Counts toward the game's overlays; "off" opens Settings > Overlays.
   */
  showPanel(panel: { owner: string; moduleId: string; gameId: string; instanceId: string }): GameOverlayResult {
    if (!this.options.supported || !this.options.enabled()) {
      if (this.options.supported) this.options.openSetting("game-overlays");
      return "off";
    }
    const added = this.store.add({ owner: panel.owner, moduleId: panel.moduleId, gameId: panel.gameId, key: panelKey(panel.instanceId) });
    if (added === "full") return "full";
    this.options.changed();
    this.tick();
    return "shown";
  }

  /** Whether the panel is over its game now. */
  hasPanel(instanceId: string): boolean {
    const key = panelKey(instanceId);
    return this.store.all().some((overlay) => overlay.key === key);
  }

  /** The panel comes back to its workspace slot (Bring back, or the panel is closing). */
  bringBack(instanceId: string): void {
    const key = panelKey(instanceId);
    this.forget((overlay) => overlay.key === key);
  }

  // ── Settings > Overlays ──────────────────────────────────────────────

  update(subject: GameOverlaySubject, change: GameOverlayChange): void {
    if (this.store.update(subject, change)) this.tick();
    this.options.changed();
  }

  /** The player removed an overlay, or closed it in arrange mode. */
  remove(subject: GameOverlaySubject): void {
    this.forget((overlay) => sameOverlay(overlay, subject));
  }

  /** A game left the library for good. */
  forgetGame(gameId: string): void {
    this.forget((overlay) => overlay.gameId === gameId);
  }

  /** A module's data was deleted, or the module was removed. */
  forgetModule(moduleId: string, owner?: string): void {
    this.forget((overlay) => overlay.moduleId === moduleId && (owner === undefined || overlay.owner === owner));
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

  /** Forgets the overlays matching `test` with their keys; whether any went. */
  private drop(test: (overlay: GameOverlay) => boolean): boolean {
    const gone = this.store.all().filter(test);
    if (!this.store.forget(test)) return false;
    for (const overlay of gone) {
      this.options.removeKeys((record) => record.action === OVERLAY_TOGGLE_ACTION && record.owner === overlay.owner && record.moduleId === overlay.moduleId && record.gameId === overlay.gameId && record.target === overlay.key);
      this.toggled.delete(overlayId(overlay));
      this.revive(overlayId(overlay));
    }
    // A game without overlays has no arrange key either.
    for (const gameId of new Set(gone.map((overlay) => overlay.gameId))) {
      if (this.store.of(gameId).length === 0) this.options.removeKeys((record) => record.action === OVERLAY_ARRANGE_ACTION && record.gameId === gameId);
    }
    return true;
  }

  /** Whether the window in front needs watching: overlays are on and there is one to show. */
  needsWatcher(): boolean {
    return this.options.supported && this.options.enabled() && this.store.all().length > 0;
  }

  // ── Keys ─────────────────────────────────────────────────────────────

  /** The game whose keys work now: the one in front. */
  frontGame(): string | null {
    return this.front;
  }

  /** Whether a hotkey of game overlays should be registered now. */
  wants(record: HotkeyRecord): boolean {
    if (!this.options.enabled()) return false;
    if (record.action === OVERLAY_ARRANGE_ACTION) return true;
    const overlay = this.store.find({ owner: record.owner, moduleId: record.moduleId, gameId: record.gameId, key: record.target });
    return record.action === OVERLAY_TOGGLE_ACTION && overlay?.mode === "toggle";
  }

  pressed(record: HotkeyRecord): void {
    if (record.gameId !== this.front) return;
    if (record.action === OVERLAY_ARRANGE_ACTION) {
      if (this.arranging === record.gameId) this.stopArranging(true);
      else this.startArranging(record.gameId);
      return;
    }
    const overlay = this.store.find({ owner: record.owner, moduleId: record.moduleId, gameId: record.gameId, key: record.target });
    if (!overlay || overlay.mode !== "toggle") return;
    const id = overlayId(overlay);
    if (!this.toggled.delete(id)) this.toggled.add(id);
    // Toggling is the player asking for it, also for a page that crashed too often.
    this.revive(id);
    this.tick();
  }

  private startArranging(gameId: string): void {
    this.arranging = gameId;
    // Esc ends it too; the key is the game's again afterwards.
    this.escape = this.options.shortcuts.register("Escape", () => this.stopArranging(true));
    this.tick();
  }

  /** Ends arranging. `refocus`: the player ended it (Esc or the key), so the game gets the keyboard back; not when it left the front. */
  private stopArranging(refocus: boolean): void {
    if (this.arranging === null) return;
    this.arranging = null;
    if (this.escape) this.options.shortcuts.unregister("Escape");
    this.escape = false;
    if (refocus) {
      // Only a panel takes the keyboard (while arranging), but a click on any overlay may have left the game without focus.
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
    const enabled = this.options.enabled() && this.options.supported;
    if (!enabled || this.store.all().length === 0) {
      this.closeAll();
      this.setFront(null, null);
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
    // A panel over the game took the keyboard while arranging, so Tavora's own window is in front: the game still is the one in front.
    if (foreground?.own && this.arranging !== null && [...this.open.values()].some((entry) => entry.window.focused)) {
      this.apply();
      return;
    }
    const withOverlays = new Set(this.store.all().map((overlay) => overlay.gameId));
    const front = foreground?.program ? gameInFront(this.options.gamesOf(foreground.program), withOverlays) : null;
    this.setFront(front, front && foreground ? this.options.toDip(foreground.bounds) : null);
    if (front && foreground && looksExclusive(foreground.notification) && !this.store.exclusiveHintShown) {
      this.store.markExclusiveHintShown();
      this.options.notify(translate(this.options.language(), "overlays.exclusiveHint"));
    }
    if (this.arranging !== null && this.arranging !== this.front) this.stopArranging(false);
    this.apply();
  }

  private setFront(gameId: string | null, bounds: Rect | null): void {
    this.game = bounds;
    if (gameId === this.front) return;
    this.front = gameId;
    // The keys follow the game in front (streaming.ts sync).
    this.options.changed();
  }

  private apply(): void {
    const enabled = this.options.enabled();
    const now = Date.now();
    const live = new Set<string>();
    const gone: GameOverlay[] = [];
    const started: Open[] = [];
    for (const overlay of this.store.all()) {
      const id = overlayId(overlay);
      live.add(id);
      const panel = isPanelKey(overlay.key);
      const module = this.options.module(overlay.moduleId);
      const usable = panel || (module !== undefined && module.owner === overlay.owner && !!module.manifest.overlay);
      const arranging = this.arranging === overlay.gameId;
      const inFront = this.front === overlay.gameId;
      const visible =
        usable && !this.stopped.has(id) && this.game !== null && overlayVisible({ enabled, gameInFront: inFront, mode: overlay.mode, toggledOn: this.toggled.has(id), arranging });
      let entry = this.open.get(id);
      // A panel lives in its window from the moment it moved, shown or not.
      if (panel && !entry) {
        entry = this.create(overlay, id) ?? undefined;
        if (!entry) {
          gone.push(overlay);
          continue;
        }
      }
      if (!visible) {
        if (entry?.shown) {
          entry.window.setArranging(false);
          entry.arranging = false;
          entry.window.setShown(false);
          entry.shown = false;
        }
        if (entry && !panel) {
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
      if (!entry.window.dragging) entry.window.setRect(placeRelative(overlay.rect, this.game!));
      if (!entry.shown) {
        entry.window.setShown((entry.shown = true));
        entry.shownOrder = ++this.shownCount;
      }
      // After the window has its place and is shown (on top), never before: a window that takes the mouse and the keyboard while still unplaced would flash in the wrong spot.
      if (entry.arranging !== arranging) {
        entry.window.setArranging((entry.arranging = arranging));
        if (arranging) started.push(entry);
      }
    }
    // One window takes the keyboard, the panel shown last; not each in turn.
    if (started.length > 0) {
      const newest = [...this.open.values()].filter((entry) => entry.arranging && entry.shown && entry.window.focusPanel).sort((a, b) => b.shownOrder - a.shownOrder)[0];
      newest?.window.focusPanel?.();
    }
    for (const [id, entry] of this.open) {
      if (live.has(id)) continue;
      entry.window.destroy();
      this.open.delete(id);
    }
    // A panel that is gone (its window couldn't be made) has no overlay either.
    if (gone.length > 0 && this.drop((overlay) => gone.includes(overlay))) this.options.changed();
  }

  private create(overlay: GameOverlay, id: string): Open | null {
    const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, key: overlay.key };
    const store = this.options.overlays;
    const request: OverlayWindowRequest = {
      id,
      // Looked up at every request: a module that was removed or replaced by another publisher's stops being served.
      page: () => {
        const now = this.options.module(overlay.moduleId);
        return now && now.owner === overlay.owner && now.manifest.overlay ? { root: now.root, entry: now.manifest.overlay } : null;
      },
      state: () => store.peek(subject)?.state ?? null,
      watch: (fn) => {
        const link = store.peek(subject)?.link;
        return link ? store.watch(link.token, fn) : null;
      },
      gameBounds: () => this.game,
      moved: (rect) => {
        if (this.game) this.store.update(subject, { rect: relativeTo(rect, this.game) });
      },
      closeRequested: () => this.remove(subject),
      ended: () => this.crashed(id),
      frameText: () => ({ name: this.nameOf(overlay), closeLabel: translate(this.options.language(), isPanelKey(overlay.key) ? "overlays.bringBackLabel" : "overlays.closeLabel") }),
    };
    const window = isPanelKey(overlay.key) ? this.options.panels?.openWindow({ ...request, instanceId: panelInstanceOf(overlay.key), gameId: overlay.gameId }) : this.options.openWindow(request);
    if (!window) return null;
    // A new window is fully opaque, click-through and visible to capture; apply sets the rest.
    const entry: Open = { window, opacity: 100, hideFromCapture: false, arranging: false, shown: false, shownOrder: 0, idleSince: null };
    this.open.set(id, entry);
    return entry;
  }

  /** A window's page is gone. It is made again on the next look, unless that keeps happening. */
  private crashed(id: string): void {
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

  /** Overlays of a module that another publisher's module replaced can't be shown, and are forgotten. */
  private prune(): void {
    const replaced = (overlay: GameOverlay) => {
      const module = this.options.module(overlay.moduleId);
      return module !== undefined && module.owner !== overlay.owner;
    };
    if (this.drop(replaced)) this.options.changed();
  }

  private closeAll(): void {
    if (this.arranging !== null) this.stopArrangingQuietly();
    // Panels go back to their workspace slots, and are not kept over the game.
    if (this.drop((overlay) => isPanelKey(overlay.key))) this.options.changed();
    for (const entry of this.open.values()) entry.window.destroy();
    this.open.clear();
  }

  private stopArrangingQuietly(): void {
    this.arranging = null;
    if (this.escape) this.options.shortcuts.unregister("Escape");
    this.escape = false;
  }

  // ── Settings view ────────────────────────────────────────────────────

  /** What Settings shows for an overlay: its module's name, and the key when the module has several in the game. */
  private nameOf(overlay: GameOverlay): string {
    if (isPanelKey(overlay.key)) {
      const panel = this.options.panels?.name(panelInstanceOf(overlay.key));
      if (panel) return panel;
    }
    const name = this.options.module(overlay.moduleId)?.manifest.name ?? overlay.moduleId;
    const several = this.store.of(overlay.gameId).filter((item) => item.moduleId === overlay.moduleId).length > 1;
    return several ? `${name} · ${overlay.key}` : name;
  }

  view(): GameOverlaysView {
    const ids = new Set(this.store.all().map((overlay) => overlay.gameId));
    return {
      supported: this.options.supported,
      enabled: this.options.enabled(),
      games: [...ids]
        .map((id) => ({
          id,
          name: this.options.gameName(id) ?? id,
          arrange: this.options.keyOf(arrangeBinding(id)),
          overlays: this.store.of(id).map((overlay) => ({
            owner: overlay.owner,
            moduleId: overlay.moduleId,
            key: overlay.key,
            name: this.nameOf(overlay),
            mode: overlay.mode,
            opacity: overlay.opacity,
            hideFromCapture: overlay.hideFromCapture,
            panel: isPanelKey(overlay.key),
            hotkey: this.options.keyOf(toggleBinding(overlay)),
          })),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** The name a hotkey dialog calls an overlay or a game's arrange key by. */
  dialogNames(binding: Pick<HotkeyRecord, "owner" | "moduleId" | "gameId" | "action" | "target">): { label: string; module: string; action: string } {
    const language = this.options.language();
    const game = this.options.gameName(binding.gameId) ?? binding.gameId;
    if (binding.action === OVERLAY_ARRANGE_ACTION) return { label: translate(language, "overlays.arrangeLabel"), module: game, action: translate(language, "overlays.arrangeAction") };
    const overlay = this.store.find({ owner: binding.owner, moduleId: binding.moduleId, gameId: binding.gameId, key: binding.target });
    return { label: overlay ? this.nameOf(overlay) : binding.target, module: game, action: translate(language, "overlays.toggleAction") };
  }

  /** Whether the player has this overlay (a key can be set only for one that exists). */
  has(subject: GameOverlaySubject): boolean {
    return this.store.find(subject) !== undefined;
  }

  /** Quitting: every window closes and the last changes are written. */
  async shutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    this.closeAll();
    // The keys follow the game in front: with none, the arrange and toggle keys go back to the system.
    this.setFront(null, null);
    await this.store.save();
  }
}
