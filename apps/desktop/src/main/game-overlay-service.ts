// Game overlays as a whole (game-overlays.ts has what the player set, game-overlay-window.ts the windows): looks every
// moment at which window is in front, shows each overlay while its game is, and handles the keys that toggle overlays
// or arrange them. Tavora only reads which window is in front (foreground.ts) and draws its own windows above it.
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
  looksExclusive,
  overlayId,
  overlayVisible,
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
export type OverlayWindow = Pick<GameOverlayWindow, "setRect" | "setShown" | "setArranging" | "setShowOnStream" | "setOpacity" | "destroy" | "dragging">;

/** What a window shows and tells back; the service hands it to `openWindow`. */
export interface OverlayWindowRequest {
  page(): OverlayPage | null;
  state(): JsonValue | null;
  watch(fn: (state: JsonValue | null | undefined) => void): () => void;
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

/** The hotkey binding of a game's arrange key, and of one overlay's toggle key. */
export const arrangeBinding = (gameId: string) => ({ owner: ARRANGE_OWNER, moduleId: ARRANGE_OWNER, gameId, action: OVERLAY_ARRANGE_ACTION, target: "arrange" });
export const toggleBinding = (overlay: GameOverlaySubject) => ({ owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, action: OVERLAY_TOGGLE_ACTION, target: overlay.key });

/** Whether a hotkey is one of game overlays (they are listed in Settings > Overlays, not in Streaming). */
export const isOverlayAction = (action: string) => action === OVERLAY_TOGGLE_ACTION || action === OVERLAY_ARRANGE_ACTION;

interface Open {
  window: OverlayWindow;
  opacity: Opacity;
  showOnStream: boolean;
  arranging: boolean;
  shown: boolean;
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

  private constructor(
    private readonly options: GameOverlayServiceOptions,
    private readonly store: GameOverlayStore,
  ) {}

  static async create(options: GameOverlayServiceOptions): Promise<GameOverlays> {
    return new GameOverlays(options, await GameOverlayStore.load(options.userData));
  }

  /** Starts looking at the window in front; called once Tavora is up. */
  start(): void {
    if (this.timer || !this.options.supported) return;
    this.timer = setInterval(() => this.tick(), this.options.everyMs ?? LOOK_MS);
    this.timer.unref?.();
  }

  // ── What a module panel gets ─────────────────────────────────────────

  /** overlay.showOverGame for a panel of `module` in `gameId`; the module view checked the key and the click. */
  show(module: StreamingModule, gameId: string, key: string): GameOverlayResult {
    if (!module.manifest.overlay) throw new HostError("INVALID_PARAMS", "this module has no overlay page in its manifest");
    if (!this.options.supported || !this.options.enabled()) {
      if (this.options.supported) this.options.openSetting("game-overlays");
      return "off";
    }
    const subject: GameOverlaySubject = { owner: module.owner, moduleId: module.manifest.id, gameId, key };
    if (this.store.add(subject) === "full") return "full";
    // The link holds what the module publishes for the key; making it now means the page hears it from the start.
    this.options.overlays.link(subject);
    this.options.changed();
    this.tick();
    return "shown";
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
      if (this.arranging === record.gameId) this.stopArranging();
      else this.startArranging(record.gameId);
      return;
    }
    const overlay = this.store.find({ owner: record.owner, moduleId: record.moduleId, gameId: record.gameId, key: record.target });
    if (!overlay || overlay.mode !== "toggle") return;
    const id = overlayId(overlay);
    if (!this.toggled.delete(id)) this.toggled.add(id);
    this.tick();
  }

  private startArranging(gameId: string): void {
    this.arranging = gameId;
    // Esc ends it too; the key is the game's again afterwards.
    this.escape = this.options.shortcuts.register("Escape", () => this.stopArranging());
    this.tick();
  }

  private stopArranging(): void {
    if (this.arranging === null) return;
    this.arranging = null;
    if (this.escape) this.options.shortcuts.unregister("Escape");
    this.escape = false;
    this.tick();
    // The windows never took the keyboard, but the click on one may have left the game without focus.
    try {
      this.probe?.focus();
    } catch {
      // Best effort: the player can click the game.
    }
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
    const withOverlays = new Set(this.store.all().map((overlay) => overlay.gameId));
    const front = foreground?.program ? gameInFront(this.options.gamesOf(foreground.program), withOverlays) : null;
    this.setFront(front, front && foreground ? this.options.toDip(foreground.bounds) : null);
    if (front && foreground && looksExclusive(foreground.notification) && !this.store.exclusiveHintShown) {
      this.store.markExclusiveHintShown();
      this.options.notify(translate(this.options.language(), "overlays.exclusiveHint"));
    }
    if (this.arranging !== null && this.arranging !== this.front) this.stopArranging();
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
    const live = new Set<string>();
    for (const overlay of this.store.all()) {
      const id = overlayId(overlay);
      live.add(id);
      const module = this.options.module(overlay.moduleId);
      const usable = module !== undefined && module.owner === overlay.owner && !!module.manifest.overlay;
      const arranging = this.arranging === overlay.gameId;
      const visible =
        usable && this.game !== null && overlayVisible({ enabled, gameInFront: this.front === overlay.gameId, mode: overlay.mode, toggledOn: this.toggled.has(id), arranging });
      let entry = this.open.get(id);
      if (!visible) {
        if (entry?.shown) {
          entry.window.setArranging(false);
          entry.arranging = false;
          entry.window.setShown(false);
          entry.shown = false;
        }
        continue;
      }
      entry ??= this.create(overlay, id);
      if (entry.opacity !== overlay.opacity) entry.window.setOpacity((entry.opacity = overlay.opacity));
      if (entry.showOnStream !== overlay.showOnStream) entry.window.setShowOnStream((entry.showOnStream = overlay.showOnStream));
      if (entry.arranging !== arranging) entry.window.setArranging((entry.arranging = arranging));
      if (!entry.window.dragging) entry.window.setRect(placeRelative(overlay.rect, this.game!));
      if (!entry.shown) entry.window.setShown((entry.shown = true));
    }
    for (const [id, entry] of this.open) {
      if (live.has(id)) continue;
      entry.window.destroy();
      this.open.delete(id);
    }
  }

  private create(overlay: GameOverlay, id: string): Open {
    const subject: OverlaySubject = { owner: overlay.owner, moduleId: overlay.moduleId, gameId: overlay.gameId, key: overlay.key };
    const store = this.options.overlays;
    const window = this.options.openWindow({
      // Looked up at every request: a module that was removed or replaced by another publisher's stops being served.
      page: () => {
        const now = this.options.module(overlay.moduleId);
        return now && now.owner === overlay.owner && now.manifest.overlay ? { root: now.root, entry: now.manifest.overlay } : null;
      },
      state: () => store.peek(subject)?.state ?? null,
      watch: (fn) => {
        const link = store.peek(subject)?.link;
        return link ? store.watch(link.token, fn) : () => {};
      },
      gameBounds: () => this.game,
      moved: (rect) => {
        if (this.game) this.store.update(subject, { rect: relativeTo(rect, this.game) });
      },
      closeRequested: () => this.remove(subject),
      ended: () => this.dropWindow(id),
      frameText: () => ({ name: this.nameOf(overlay), closeLabel: translate(this.options.language(), "overlays.closeLabel") }),
    });
    // A new window is fully opaque, hidden from capture and click-through; apply sets the rest.
    const entry: Open = { window, opacity: 100, showOnStream: false, arranging: false, shown: false };
    this.open.set(id, entry);
    return entry;
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
            showOnStream: overlay.showOnStream,
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
    await this.store.save();
  }
}
