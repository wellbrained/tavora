// The windows of game overlays and of the in-game layer: makes each item's window do what the layer's scene says
// (game-layer.ts), with the veil under them and Tavora's card on top while the layer is open. Everything about the
// windows themselves lives here: when a window is made, shown, hidden or closed, its place, zoom, opacity and mode,
// which window takes the keyboard, and how they are stacked (above every window, or right above a game the user left).
// The windows come from the platform: Electron's (game-layer-electron.ts) or a test's stand-ins.
import type { JsonValue } from "@tavora/sdk/protocol";
import { EVERYWHERE, type Opacity, type Rect, type WindowMode } from "./game-overlays";
import type { ItemKind, LayerScene, SceneItem } from "./game-layer";
import type { GameOverlayWindow, OverlayPanel } from "./game-overlay-window";
import type { LayerCard, LayerCardRequest } from "./game-layer-card";
import type { VeilWindow } from "./game-veil-window";
import type { OverlayPage } from "./overlays";
import type { PanelInGame } from "./panel-views";

/** The part of a game overlay's window the layer drives (a test stands in for Electron). */
export type OverlayWindow = Pick<GameOverlayWindow, "setRect" | "setShown" | "setMode" | "setHideFromCapture" | "setOpacity" | "destroy" | "dragging"> &
  Partial<Pick<GameOverlayWindow, "focused" | "focusPanel" | "raise" | "setZoom" | "refreshFont" | "placed" | "setVeiled" | "setTopmost" | "handle">>;

/** What a window shows and tells back; the service makes it for each item. */
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
  /** The window got the keyboard (a panel): the layer's card goes on top again. */
  activated?(): void;
  frameText(): { name: string; closeLabel: string; layoutLabel: string };
}

/**
 * How an item's window is made: for an overlay page or a live view, from its request; for a panel, Panel views lends the
 * panel's view into the window made for it (panel-views.ts `lend`), or answers null when it can't right now.
 */
export interface WindowMaker {
  request: OverlayWindowRequest;
  lend?(open: (panel: OverlayPanel) => OverlayWindow): PanelInGame<OverlayWindow> | null;
}

/** The windows Electron draws, and Windows' order of windows (a test stands in for them). */
export interface LayerWindowsPlatform {
  /** A window for an overlay's page, or for the lent view of a panel (`panel`). */
  openWindow(request: OverlayWindowRequest, panel?: OverlayPanel): OverlayWindow;
  /** The veil over the game window (or the screen) while the layer is open. */
  openVeil(): VeilWindow;
  /** Tavora's card at the top of the open layer: Use | Arrange and Close. */
  openCard(request: LayerCardRequest): LayerCard;
  /**
   * Stacks windows (their handles, top first) right above the game's window (its handle) in Windows' order of windows
   * (window-order.ts). Windows only; left out, overlays stay above every window while the user is elsewhere.
   */
  stackAboveGame?(game: number, windows: readonly number[]): boolean;
  /** Whether the game's window (its handle) is always on top itself, as some borderless games are: nothing can cover it then. */
  gameOnTop?(game: number): boolean;
}

/** A window whose setup is not on screen is closed after this long (it is made again when the setup is back). */
export const IDLE_CLOSE_MS = 30_000;
/** A page that crashed this many times within CRASH_SPAN_MS is not made again until the user shows or toggles it. */
export const MAX_CRASHES = 3;
export const CRASH_SPAN_MS = 5 * 60_000;

/** Where a window is: hidden (its setup is on screen), idle since a time (its setup is not), or shown in a mode. */
type Showing = { status: "hidden" } | { status: "idle"; since: number } | { status: "shown"; mode: WindowMode };

interface Entry {
  kind: ItemKind;
  window: OverlayWindow;
  /** The setup the item is shown from now (or was shown from last). */
  setup: string;
  showing: Showing;
  opacity: Opacity;
  hideFromCapture: boolean;
  /** When the window was shown last, to tell which of several panel windows is the newest. */
  shownOrder: number;
  /** The content zoom the window was given; 1 until set. */
  zoom: number;
  /** A live view kept on screen but see-through while the layer is open (its panel is there instead). */
  veiled: boolean;
  instanceId?: string | undefined;
  /** The panel's view, lent by Panel views while its window holds it. */
  loan?: PanelInGame<OverlayWindow> | undefined;
}

export interface LayerWindowsOptions {
  platform: LayerWindowsPlatform;
  /** The card's Use | Arrange and Close. */
  setMode: LayerCardRequest["setMode"];
  close: LayerCardRequest["close"];
  /** When a panel was used last: the newest one coming up in Use gets the keyboard. */
  usedAt(instanceId: string): number;
}

const modeOf = (entry: Entry): WindowMode => (entry.showing.status === "shown" ? entry.showing.mode : "off");

export class LayerWindows {
  private readonly open = new Map<string, Entry>();
  private veil: VeilWindow | null = null;
  /** The card at the top of the open layer. */
  private card: LayerCard | null = null;
  /** The places the layer card keeps off, as last seen while nothing was dragged. */
  private cardItems: Rect[] = [];
  /** When the card's page crashed lately: after MAX_CRASHES within CRASH_SPAN_MS no new card is made until that passes. */
  private cardCrashes: number[] = [];
  /** The windows shown and their stacking places at the last look; they are raised again when it changes. */
  private stackKey = "";
  private shownCount = 0;

  constructor(private readonly options: LayerWindowsOptions) {}

  /** The setup the item's window shows from now, if it has a window. */
  setupOf(id: string): string | undefined {
    return this.open.get(id)?.setup;
  }

  /** Whether one of these windows has the keyboard (a panel in the layer, or the layer's card). */
  get focused(): boolean {
    return (this.card?.focused ?? false) || [...this.open.values()].some((entry) => entry.window.focused);
  }

  /** Whether any window is shown over a game or the screen now. */
  get anyShown(): boolean {
    return [...this.open.values()].some((entry) => entry.showing.status === "shown");
  }

  /** The user picked another interface font or theme: the frames and the layer's card take it. */
  refreshFonts(): void {
    for (const entry of this.open.values()) entry.window.refreshFont?.();
    this.card?.refresh();
  }

  /** Raises the card above the layer's windows (a panel clicked or given the keyboard came above it). */
  raiseCard(): void {
    this.card?.raise();
  }

  /**
   * Makes the windows what the scene says, in one go: the veil first, then the card, each item's window in the scene's
   * order, then the windows no item has any more go, and last the stacking and the keyboard. Answers whether windows are
   * stacked right above a game the user left (Windows raises the game over them when it is clicked, so the next look
   * should come sooner).
   */
  show(scene: LayerScene): boolean {
    const now = Date.now();
    const platform = this.options.platform;
    // Overlays stay while the user is in another window: the game's sit right above its window instead of above every
    // window, so a window brought over the game (a browser) covers them as it covers the game. Everywhere's stay on top,
    // and so does everything over a game that is always on top itself (nothing can cover it).
    const handle = scene.awayHandle;
    const awayGame = handle !== 0 && platform.stackAboveGame && !platform.gameOnTop?.(handle) ? handle : 0;
    const onTop = (setup: string) => awayGame === 0 || setup === EVERYWHERE;
    const started: Entry[] = [];
    /** Whether a window came up in this look: it is drawn above the card, which goes on top again. */
    let shownNow = false;
    // The veil first: everything shown after it is above it.
    let veilNew = false;
    const layer = scene.layer;
    if (layer) {
      if (!this.veil) {
        this.veil = platform.openVeil();
        veilNew = true;
      }
      this.veil.place(layer.area);
    } else if (this.veil) {
      this.veil.destroy();
      this.veil = null;
    }
    // The card at the top of the layer's area, above everything the layer shows.
    let cardNew = false;
    if (layer && (this.card || this.cardMayStart(now))) {
      if (!this.card) {
        this.card = platform.openCard({ setMode: this.options.setMode, close: this.options.close, ended: () => this.cardCrashed() });
        cardNew = true;
      }
      // What the card keeps off: the items you see (not the live views veiled behind their panels). It stays put while
      // one is dragged, so it doesn't jump around under the pointer.
      if (![...this.open.values()].some((entry) => entry.window.dragging)) {
        this.cardItems = [...this.open.values()].flatMap((entry) => (entry.showing.status === "shown" && !entry.veiled && entry.kind !== "live" && entry.window.placed ? [entry.window.placed] : []));
      }
      this.card.show(layer.area, layer.card, this.cardItems);
    } else if (!layer) this.dropCard();
    const ids = new Set<string>();
    for (const item of scene.items) {
      ids.add(item.id);
      if (item.kind === "overlay") shownNow = this.showOverlay(item, now, onTop) || shownNow;
      else if (item.kind === "panel") shownNow = this.showPanel(item, started) || shownNow;
      else this.showLive(item, now, onTop);
    }
    for (const [id, entry] of this.open) {
      if (ids.has(id)) continue;
      this.open.delete(id);
      this.closeWindow(entry);
    }
    const { restacked, stacked } = this.restack(scene, veilNew, awayGame, onTop);
    // One window takes the keyboard, the panel used last; not each in turn.
    let focused = false;
    if (started.length > 0) {
      const used = (entry: Entry) => this.options.usedAt(entry.instanceId!);
      const newest = started.filter((entry) => entry.window.focusPanel).sort((a, b) => used(b) - used(a) || b.shownOrder - a.shownOrder)[0];
      newest?.window.focusPanel?.();
      focused = newest !== undefined;
    }
    // The card stays on top of everything the layer shows; a window given the keyboard comes to the top of its level, so after that.
    if (restacked || cardNew || shownNow || focused) this.card?.raise();
    return stacked;
  }

  /** An overlay's window: shown where its setup has it, or hidden. Whether it came up now. */
  private showOverlay(item: SceneItem, now: number, onTop: (setup: string) => boolean): boolean {
    let entry = this.open.get(item.id);
    const look = item.look;
    if (!look) {
      if (entry?.showing.status === "shown") {
        entry.window.setMode("off");
        entry.window.setShown(false);
        entry.showing = { status: "hidden" };
      }
      if (entry) this.idle(item, entry, now);
      return false;
    }
    entry ??= this.make(item) ?? undefined;
    if (!entry) return false;
    entry.setup = item.setup!;
    if (entry.showing.status === "idle") entry.showing = { status: "hidden" };
    this.style(entry, look.opacity!, look.hideFromCapture!);
    if (!entry.window.dragging) entry.window.setRect(look.rect);
    this.zoomTo(entry, look.zoom);
    // Where it goes before it shows, so it never comes up over a window that covers the game.
    entry.window.setTopmost?.(onTop(entry.setup));
    const shownNow = this.reveal(entry);
    // After the window has its place and is shown (on top), never before: a window that takes the mouse while still
    // unplaced would flash in the wrong spot.
    this.setMode(entry, look.mode);
    return shownNow;
  }

  /** A panel's window while the layer is open, made when it has none. Whether it came up now. */
  private showPanel(item: SceneItem, started: Entry[]): boolean {
    const look = item.look!;
    // It can't be lent right now (its view is restarting, or a paused Discord panel doesn't start). It keeps its setups
    // and key, and the next look asks again; a panel that is really gone is taken out by the service.
    const entry = this.open.get(item.id) ?? this.make(item);
    if (!entry) return false;
    entry.setup = item.setup!;
    if (!entry.window.dragging) entry.window.setRect(look.rect);
    this.zoomTo(entry, look.zoom);
    const shownNow = this.reveal(entry);
    // One that comes up in Use, or is back from Arrange, may get the keyboard, so the user can tick or type right away.
    if (look.mode === "use" && modeOf(entry) !== "use") started.push(entry);
    this.setMode(entry, look.mode);
    return shownNow;
  }

  /** A panel's live view: shown; see-through behind its panel while the layer is open (only one on screen already); or hidden. */
  private showLive(item: SceneItem, now: number, onTop: (setup: string) => boolean): void {
    let entry = this.open.get(item.id);
    const look = item.look;
    // With the layer open only a view already on screen stays (veiled); none is made or shown for it.
    const veiled = look?.veiled === true && entry?.showing.status === "shown";
    if (!look || (look.veiled === true && !veiled)) {
      if (entry?.veiled) entry.window.setVeiled?.((entry.veiled = false));
      if (entry?.showing.status === "shown") {
        entry.window.setShown(false);
        entry.showing = { status: "hidden" };
      }
      if (entry) this.idle(item, entry, now);
      return;
    }
    entry ??= this.make(item)!;
    entry.setup = item.setup!;
    if (entry.showing.status === "idle") entry.showing = { status: "hidden" };
    this.style(entry, look.opacity!, look.hideFromCapture!);
    entry.window.setRect(look.rect);
    this.zoomTo(entry, look.zoom);
    if (entry.veiled !== veiled) entry.window.setVeiled?.((entry.veiled = veiled));
    entry.window.setTopmost?.(onTop(entry.setup));
    this.reveal(entry);
  }

  /** A hidden window waits while its setup is on screen; gone from the screen for a while, it goes, and is made again on show. */
  private idle(item: SceneItem, entry: Entry, now: number): void {
    if (item.setup !== null) {
      entry.showing = { status: "hidden" };
      return;
    }
    if (entry.showing.status !== "idle") entry.showing = { status: "idle", since: now };
    if (now - entry.showing.since >= IDLE_CLOSE_MS) this.drop(item.id);
  }

  /** Makes the item's window; null when a panel can't be lent now. A new window is fully opaque, click-through and visible to capture. */
  private make(item: SceneItem): Entry | null {
    const maker = item.make();
    let window: OverlayWindow;
    let loan: PanelInGame<OverlayWindow> | undefined;
    if (maker.lend) {
      const lent = maker.lend((view) => this.options.platform.openWindow(maker.request, view));
      if (!lent) return null;
      loan = lent;
      window = lent.window;
    } else window = this.options.platform.openWindow(maker.request);
    const entry: Entry = { kind: item.kind, window, setup: item.setup!, showing: { status: "hidden" }, opacity: 100, hideFromCapture: false, shownOrder: 0, zoom: 1, veiled: false, instanceId: item.instanceId, loan };
    this.open.set(item.id, entry);
    return entry;
  }

  private style(entry: Entry, opacity: Opacity, hideFromCapture: boolean): void {
    if (entry.opacity !== opacity) entry.window.setOpacity((entry.opacity = opacity));
    if (entry.hideFromCapture !== hideFromCapture) entry.window.setHideFromCapture((entry.hideFromCapture = hideFromCapture));
  }

  /** Content in the windows scales with the area's height (contentScale), from a 1080p reference. */
  private zoomTo(entry: Entry, zoom: number): void {
    if (entry.zoom === zoom) return;
    entry.zoom = zoom;
    entry.window.setZoom?.(zoom);
  }

  /** Shows a window that isn't shown (in mode off until told otherwise). Whether it came up now. */
  private reveal(entry: Entry): boolean {
    if (entry.showing.status === "shown") return false;
    entry.window.setShown(true);
    entry.showing = { status: "shown", mode: "off" };
    entry.shownOrder = ++this.shownCount;
    return true;
  }

  private setMode(entry: Entry, mode: WindowMode): void {
    if (modeOf(entry) === mode) return;
    entry.showing = { status: "shown", mode };
    entry.window.setMode(mode);
  }

  /**
   * Stacks the windows shown as the setups' order says (Arrange on the Overlay page); where none was arranged, overlays
   * below panels, as shown. Only an arranged order counts: windows coming and going don't raise the others. A fresh veil
   * would otherwise sit above overlays that were shown before it.
   */
  private restack(scene: LayerScene, veilNew: boolean, awayGame: number, onTop: (setup: string) => boolean): { restacked: boolean; stacked: boolean } {
    const places = new Map(scene.items.flatMap((item) => (item.look ? [[item.id, item.look.z] as const] : [])));
    const stack = [...this.open]
      .filter(([, entry]) => entry.showing.status === "shown")
      .map(([id, entry]) => ({ id, entry, z: places.get(id) ?? Number.MAX_SAFE_INTEGER }))
      .sort((x, y) => x.z - y.z || Number(x.entry.kind !== "overlay") - Number(y.entry.kind !== "overlay") || x.entry.shownOrder - y.entry.shownOrder);
    const stackKey = stack.filter((one) => one.z !== Number.MAX_SAFE_INTEGER).map((one) => `${one.id}:${one.z}`).join("|");
    const restacked = veilNew || stackKey !== this.stackKey;
    if (restacked) for (const one of stack) one.entry.window.raise?.();
    this.stackKey = stackKey;
    for (const one of stack) one.entry.window.setTopmost?.(onTop(one.entry.setup));
    let stacked = false;
    if (awayGame !== 0) {
      const overGame = stack.filter((one) => one.entry.setup !== EVERYWHERE);
      // Top first: the last in the stack is the highest.
      const handles = overGame.flatMap((one) => (one.entry.window.handle ? [one.entry.window.handle] : [])).reverse();
      stacked = handles.length > 0 && this.options.platform.stackAboveGame!(awayGame, handles);
      // Windows wouldn't stack them: above every window, as before, rather than lost under the game.
      if (handles.length > 0 && !stacked) for (const one of overGame) one.entry.window.setTopmost?.(true);
    }
    return { restacked, stacked };
  }

  /**
   * A window's page is gone. A panel's page is the panel's own: its view goes back to Panel views, which shows its crash
   * screen in the slot, and its window stays until the next look (`panel`). Any other window goes (`window`).
   */
  ended(id: string): "panel" | "window" {
    const entry = this.open.get(id);
    if (entry?.kind === "panel") {
      entry.loan?.giveBack();
      return "panel";
    }
    this.drop(id);
    return "window";
  }

  /** Closes one item's window now. */
  drop(id: string): void {
    const entry = this.open.get(id);
    if (!entry) return;
    this.open.delete(id);
    this.closeWindow(entry);
  }

  /** The window goes; a panel it held is back in its workspace slot. */
  private closeWindow(entry: Entry): void {
    if (entry.loan) entry.loan.end();
    else entry.window.destroy();
  }

  /** Every window goes, the veil and the card first: panels are back in their slots, nothing is left over the game or the screen. */
  closeAll(): void {
    this.veil?.destroy();
    this.veil = null;
    this.dropCard();
    const entries = [...this.open.values()];
    this.open.clear();
    for (const entry of entries) this.closeWindow(entry);
  }

  private dropCard(): void {
    this.card?.destroy();
    this.card = null;
  }

  /** The card's page crashed: it goes now, and a new one is made on the next look, unless that keeps happening. */
  private cardCrashed(): void {
    this.dropCard();
    const now = Date.now();
    this.cardCrashes = [...this.cardCrashes.filter((at) => now - at < CRASH_SPAN_MS), now];
  }

  /** Whether a card may be made: not after MAX_CRASHES within CRASH_SPAN_MS (the layer's key and Esc still close it). */
  private cardMayStart(now: number): boolean {
    this.cardCrashes = this.cardCrashes.filter((at) => now - at < CRASH_SPAN_MS);
    return this.cardCrashes.length < MAX_CRASHES;
  }
}
