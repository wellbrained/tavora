// What the in-game layer shows, decided without any window (game-overlay-service.ts asks, game-layer-windows.ts makes
// the windows do it):
//
// - `layerStep`, pure: the layer itself, `closed | open(game, window, mode)`, and what the service has to do on each step
//   (take or give back Esc, give the game the keyboard, say why it can't open).
// - `layerScene`, deterministic over its input (some of which it reads through lookups): from the setups on screen
//   and the layer, every item's window as it should be now: shown where and how, hidden, or idle (its setup is off
//   the screen); and the veil and the card while the layer is open.
import type { LayerCardContent, LayerMode } from "../shared/layer-card";
import { contentScale } from "../shared/overlay-anchor";
import { EVERYWHERE, liveWindowId, overlayId, overlayVisible, panelWindowId, placeItem, type GameOverlay, type GameOverlayStore, type InGamePanel, type Opacity, type Rect, type WindowMode } from "./game-overlays";
import type { PanelWindowMaker, WindowMaker } from "./game-layer-windows";

// ── The layer ────────────────────────────────────────────────────────

/**
 * The in-game layer: closed, or open over a game in front (`game`) or over the screen (`game` null) with no game in
 * front. `window` is the window it opened over (another window of the program, a restart say, is not that one). It
 * always opens in Use; the mode is kept in memory only.
 */
export type LayerState = { status: "closed" } | { status: "open"; game: string | null; window: string | null; mode: LayerMode };

export const LAYER_CLOSED: LayerState = { status: "closed" };

/** What the last look saw, as far as the layer cares. */
export interface LayerLook {
  /** The game in front that has something to show, or null. */
  front: string | null;
  /** The window handle of the game window in front (when known), and of whatever window is in front. */
  frontWindow: string | null;
  foregroundWindow: string | null;
  /** The game in front looks like it owns the screen (exclusive full screen): no window can be drawn over it. */
  exclusive: boolean;
}

export type LayerEvent =
  /** The layer key (only while something shows for the keys). */
  | { type: "key"; look: LayerLook }
  /** Esc or the card's Close (`refocus`: the game gets the keyboard back), or Tavora coming to the front (not). */
  | { type: "close"; refocus: boolean }
  /** Use or Arrange, from the card. */
  | { type: "mode"; mode: LayerMode }
  /** A look at the window in front: the layer ends when what it opened over is gone. */
  | { type: "look"; look: LayerLook; tavoraFront: boolean; showing: boolean }
  /** Everything closes at once (overlays off, hidden, quitting): no look follows. */
  | { type: "reset" };

/**
 * What the service does after a step. `opened`: take Esc, look again. `closed`: give Esc back, give the game the
 * keyboard when `refocus`, look again. `ended`: give Esc back only. `changed`: look again. `exclusive`: tell the user
 * why the layer can't open.
 */
export type LayerEffect = { type: "none" } | { type: "opened" } | { type: "closed"; refocus: boolean } | { type: "ended" } | { type: "changed" } | { type: "exclusive" };

const NONE: LayerEffect = { type: "none" };

export function layerStep(state: LayerState, event: LayerEvent): { state: LayerState; effect: LayerEffect } {
  switch (event.type) {
    case "key": {
      if (state.status === "open") return { state: LAYER_CLOSED, effect: { type: "closed", refocus: true } };
      const { front, frontWindow, foregroundWindow, exclusive } = event.look;
      if (front !== null && exclusive) return { state, effect: { type: "exclusive" } };
      // Always in Use: the user opens it to work in a panel; Arrange is one click away on the card.
      return { state: { status: "open", game: front, window: front !== null ? frontWindow : foregroundWindow, mode: "use" }, effect: { type: "opened" } };
    }
    case "close":
      return state.status === "open" ? { state: LAYER_CLOSED, effect: { type: "closed", refocus: event.refocus } } : { state, effect: NONE };
    case "mode":
      return state.status === "open" && state.mode !== event.mode ? { state: { ...state, mode: event.mode }, effect: { type: "changed" } } : { state, effect: NONE };
    case "look": {
      if (state.status === "closed") return { state, effect: NONE };
      // It ends (and gives the keyboard to nobody) when its game window is gone, minimized, another one, or the game went
      // exclusive full screen; one over the screen ends when a game, another window or Tavora's own comes in front.
      const { front, frontWindow, foregroundWindow, exclusive } = event.look;
      const window = state.game !== null ? frontWindow : foregroundWindow;
      const gone = state.game !== front || (state.window !== null && window !== state.window) || exclusive;
      if (gone || (state.game === null && event.tavoraFront) || !event.showing) return { state: LAYER_CLOSED, effect: { type: "closed", refocus: false } };
      return { state, effect: NONE };
    }
    case "reset":
      return { state: LAYER_CLOSED, effect: { type: "ended" } };
  }
}

// ── What shows ───────────────────────────────────────────────────────

/** An item on screen: the setup it shows from, with its settings there. */
export type Placed<T> = { setup: string; item: T };

/** The overlays on screen, each once: as the game's setup (or All games) has it, else as Everywhere does. */
export function placedOverlays(store: Pick<GameOverlayStore, "overlaysIn">, setups: readonly string[]): Map<string, Placed<GameOverlay>> {
  const placed = new Map<string, Placed<GameOverlay>>();
  for (const setup of [...setups].reverse()) for (const item of store.overlaysIn(setup)) if (!placed.has(overlayId(item))) placed.set(overlayId(item), { setup, item });
  return placed;
}

/** The panels on screen, each once, the same way (by instance id). */
export function placedPanels(store: Pick<GameOverlayStore, "panelsIn">, setups: readonly string[]): Map<string, Placed<InGamePanel>> {
  const placed = new Map<string, Placed<InGamePanel>>();
  for (const setup of [...setups].reverse()) for (const item of store.panelsIn(setup)) if (!placed.has(item.instanceId)) placed.set(item.instanceId, { setup, item });
  return placed;
}

/** What `layerScene` reads: the setups, the layer and the last look. */
export interface SceneInput {
  /** Overlays may show: Tavora can draw them, the switch is on, and they aren't hidden for now. */
  active: boolean;
  layer: LayerState;
  /** The game in front that has something to show, and where its window is (DIPs). */
  front: string | null;
  game: Rect | null;
  /** The setups on screen now. */
  setups: readonly string[];
  /** Where a setup's items sit (the game's window, or the screen for Everywhere). */
  areaOf(setupId: string): Rect | null;
  store: Pick<GameOverlayStore, "all" | "panels" | "overlaysIn" | "panelsIn">;
  /** The items toggled on by their key, and those whose page crashed so often they are left alone (by window id). */
  toggled: ReadonlySet<string>;
  stopped: ReadonlySet<string>;
  /** The item's module is installed from its publisher and has an overlay page. */
  usable(item: { moduleId: string; owner: string }): boolean;
  /** The panel passed something to panel.setLive. */
  hasLive(panel: InGamePanel): boolean;
  /** What the open layer's card says. */
  card(mode: LayerMode): LayerCardContent;
  /** The handle of the game window the user left while overlays stay (0: none, or not known). */
  awayHandle: number;
  /** The window each kind of item lives in, made only when it has none. A live view's keeps to the area of `setup`. */
  make: {
    overlay(overlay: GameOverlay, id: string): WindowMaker;
    panel(panel: InGamePanel, id: string): PanelWindowMaker;
    live(panel: InGamePanel, id: string, setup: string): WindowMaker;
  };
}

/** How a shown panel looks: its place, zoom and mode, and its place in the setup's stacking order (null: never arranged). */
export interface PanelLook {
  rect: Rect;
  zoom: number;
  mode: WindowMode;
  z: number | null;
}

/** How a shown overlay looks: as a panel, and how see-through it is and whether screen capture sees it. */
export interface OverlayLook extends PanelLook {
  opacity: Opacity;
  hideFromCapture: boolean;
}

/** How a shown live view looks: as an overlay; while the layer is open, see-through behind its panel (`veiled`), and only if it is on screen already. */
export interface LiveLook extends OverlayLook {
  veiled: boolean;
}

export type ItemLook = PanelLook | OverlayLook | LiveLook;

export type ItemKind = "overlay" | "panel" | "live";

/**
 * Where an overlay or a live view is: shown from a setup on screen, with its look and how its window is made; or hidden
 * (`look` null), with the setup on screen that has it, or null while none does (its window goes after a while).
 */
type Placement<L> = { setup: string; look: L; make(): WindowMaker } | { setup: string | null; look: null };

/** An overlay's page; its window's id is overlayId. */
export type OverlayItem = { id: string; kind: "overlay" } & Placement<OverlayLook>;
/** A panel, only while the layer is open, and then always shown; its window's id is panelWindowId. */
export type PanelItem = { id: string; kind: "panel"; instanceId: string; setup: string; look: PanelLook; make(): PanelWindowMaker };
/** A panel's live view; its window's id is liveWindowId. */
export type LiveItem = { id: string; kind: "live"; instanceId: string } & Placement<LiveLook>;
export type SceneItem = OverlayItem | PanelItem | LiveItem;

export interface LayerScene {
  /** The open layer: its area (the veil, with the card at its top) and what the card says; null while it is closed. */
  layer: { area: Rect; card: LayerCardContent } | null;
  /** The handle of the game window the user left while overlays stay right above it (0: above every window). */
  awayHandle: number;
  /** Every item, in the order its window is seen to: overlays, the panels (only while the layer is open), live views. */
  items: SceneItem[];
}

/**
 * Everything the layer shows now. A window without an item in `items` goes. Deterministic over its input: it decides
 * from the setups and the layer, and reads the rest through the input's own lookups (`areaOf`, `usable`, `hasLive`, `card`).
 */
export function layerScene(input: SceneInput): LayerScene {
  const { active, layer, front, store } = input;
  // Over a game, the layer needs its window; over the screen, nothing but itself.
  const layerOpen = layer.status === "open" && layer.game === front && (front === null || input.game !== null);
  const arranging = layerOpen && layer.status === "open" && layer.mode === "arrange";
  const overlays = placedOverlays(store, input.setups);
  const panels = placedPanels(store, input.setups);
  const area = layerOpen ? (front !== null ? input.game : input.areaOf(EVERYWHERE)) : null;
  const items: SceneItem[] = [];
  // Every overlay any setup has, once: shown from the setup on screen that has it, or hidden.
  const every = new Map(store.all().map((overlay) => [overlayId(overlay), overlay]));
  for (const [id, overlay] of every) {
    const placed = overlays.get(id);
    const where = placed ? input.areaOf(placed.setup) : null;
    const settings = placed?.item ?? overlay;
    const visible = input.usable(overlay) && !input.stopped.has(id) && where !== null && overlayVisible({ enabled: active, gameInFront: placed !== undefined, mode: settings.mode, toggledOn: input.toggled.has(id), layerOpen });
    if (placed && where && visible) {
      // An overlay has its frame only in Arrange; in Use it stays click-through.
      const look: OverlayLook = { rect: placeItem(settings, where), zoom: contentScale(where.height), mode: arranging ? "arrange" : "off", z: placed.item.z ?? null, opacity: settings.opacity, hideFromCapture: settings.hideFromCapture };
      items.push({ id, kind: "overlay", setup: placed.setup, look, make: () => input.make.overlay(overlay, id) });
    } else items.push({ id, kind: "overlay", setup: placed?.setup ?? null, look: null });
  }
  // Panels are over the game (or the screen) only while the layer is open. A panel takes input in Use; in Arrange its
  // frame covers it.
  if (layerOpen) {
    for (const { setup, item: panel } of panels.values()) {
      const where = input.areaOf(setup);
      if (!where) continue;
      const id = panelWindowId(panel.instanceId);
      items.push({
        id,
        kind: "panel",
        instanceId: panel.instanceId,
        setup,
        look: { rect: placeItem(panel, where), zoom: contentScale(where.height), mode: arranging ? "arrange" : "use", z: panel.z ?? null },
        make: () => input.make.panel(panel, id),
      });
    }
  }
  // Live views: a panel on screen shows its module's overlay page read-only in its own spot while the layer is closed.
  // With the layer open the full panel is there instead: a view on screen stays, see-through (veiled), so its page keeps
  // drawing what the panel changes and is current when the layer closes (a hidden one came back with a stale frame).
  const everyPanel = new Map(store.panels().map((panel) => [panel.instanceId, panel]));
  for (const [instanceId, panel] of everyPanel) {
    const id = liveWindowId(instanceId);
    const placed = panels.get(instanceId);
    const where = placed ? input.areaOf(placed.setup) : null;
    const settings = placed?.item ?? panel;
    const visible =
      input.usable(panel) &&
      input.hasLive(panel) &&
      !input.stopped.has(id) &&
      where !== null &&
      overlayVisible({ enabled: active, gameInFront: placed !== undefined, mode: settings.mode, toggledOn: input.toggled.has(id), layerOpen: false });
    if (placed && where && visible) {
      const setup = placed.setup;
      const look: LiveLook = { rect: placeItem(settings, where), zoom: contentScale(where.height), mode: "off", z: placed.item.z ?? null, opacity: settings.opacity, hideFromCapture: settings.hideFromCapture, veiled: layerOpen };
      items.push({ id, kind: "live", instanceId, setup, look, make: () => input.make.live(panel, id, setup) });
    } else items.push({ id, kind: "live", instanceId, setup: placed?.setup ?? null, look: null });
  }
  return { layer: area && layer.status === "open" ? { area, card: input.card(layer.mode) } : null, awayHandle: input.awayHandle, items };
}
