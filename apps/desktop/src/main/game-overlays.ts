// Game overlays: a module's overlay page (the manifest's `overlay`) shown over the player's game in a Tavora window
// (game-overlay-window.ts), only while that game is in front, plus the panels the player chose to show in their game,
// which appear over it only while the in-game layer is open. This file holds what the player set for each one, kept in
// game-overlays.json in the data folder, and the rules that don't need Windows: where an overlay sits relative to the
// game's window, and when it is shown. The one key that opens the layer lives in hotkeys.json with the other hotkeys
// (hotkeys.ts), under the action below; so do the keys that toggle overlays.
import path from "node:path";
import { LIMITS, OVERLAY_KEY } from "@tavora/sdk/protocol";
import { DEFAULT_GRID, isGridSetting, type GridSetting } from "../shared/layout-math";
import {
  DEFAULT_PANEL_ANCHORED,
  DEFAULT_RECT,
  MIN_OVERLAY_SIZE,
  migrateLegacy,
  normalizeAnchored,
  normalizeLegacy,
  placeAnchored,
  placeLegacy,
  type AnchoredRect,
  type LegacyRect,
  type Rect,
} from "../shared/overlay-anchor";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside, setAside } from "./json";
import type { WindowState } from "./window-state";

export { MIN_OVERLAY_SIZE, type Rect };

export const GAME_OVERLAYS_FILE = "game-overlays.json";

/** The hotkey actions game overlays use. A `$` keeps them apart from any action a module declares. */
export const OVERLAY_TOGGLE_ACTION = "$overlay";
/** The one key that opens and closes the in-game layer. */
export const OVERLAY_LAYER_ACTION = "$layer";
/** The per-game arrange keys of 0.20.54; the layer key replaced them, and they are dropped when found. */
export const LEGACY_ARRANGE_ACTION = "$arrange";
/** Who owns the layer key: Tavora itself. */
export const LAYER_OWNER = "tavora";
/** The "game" of the layer key: it works over every game. */
export const ALL_GAMES = "$all";

/**
 * Overlay keys of a module can't start with this: older Tavoras kept panels moved over a game under such keys.
 * show() refuses them, and a file of that time (version 1) is cleaned of them once, when it is migrated.
 */
export const RESERVED_KEY_PREFIX = "panel-";

/** How much of the page shows through the window: Tavora's own setting per overlay. */
export const OPACITIES = [100, 75, 50, 25] as const;
export type Opacity = (typeof OPACITIES)[number];

/** `always`: shown whenever the game is in front. `toggle`: shown or hidden by the overlay's key. */
export type OverlayMode = "always" | "toggle";

/** `game`: only over the game it was made in. `all`: made in a workspace that is no game; over every library game in front. */
export type OverlayScope = "game" | "all";

/** The scope for something made in a library entry of this kind. */
export const scopeForKind = (kind: string | undefined): OverlayScope => (kind === "game" ? "game" : "all");

/**
 * The size the fractions kept for older Tavoras (`rect` in the file) are computed on when no window size was seen for
 * the game, and the Overlay layout's canvas before the game was seen.
 */
export const DEFAULT_GAME_SIZE = { width: 1920, height: 1080 } as const;

/** The smallest window that counts as the game's: a launcher or splash screen is smaller, and no position is converted on it. */
export const MIN_REAL_WINDOW = { width: 640, height: 480 } as const;

/** Whether this is the size of a game's real window (not a launcher's or a splash screen's). */
export const isRealWindow = (size: { width: number; height: number }) => size.width >= MIN_REAL_WINDOW.width && size.height >= MIN_REAL_WINDOW.height;

/**
 * Where a panel or overlay shown in the game starts: in the corner of `usual`, at the size its module prefers (a panel's
 * preferred viewport, an overlay's `overlaySize`, both in pixels) in a window of `area`'s size, so it isn't stretched.
 * Without a preferred size, or before any game window is known, it gets `usual`'s size.
 *
 * `area` is the game window in front, else the one seen last, else the main screen (GameOverlays.startArea). Sizes are
 * kept in units of the window's height, so the preferred pixels are divided by `area.height`: on that window the item
 * is exactly as big on screen as asked, and on a taller or wider one it keeps its share of the height.
 */
export function startRect(preferred: { width?: number | undefined; height?: number | undefined } | null, area: Rect | null, usual: AnchoredRect = DEFAULT_PANEL_ANCHORED): AnchoredRect {
  if (!area || area.width <= 0 || area.height <= 0) return { ...usual };
  // What is left of the window after the start offset caps the size (the width in units of height: the window's shape counts).
  const share = (size: number | undefined, room: number, fallback: number) => (size && size > 0 ? Math.min(room, size / area.height) : fallback);
  return {
    ...usual,
    width: share(preferred?.width, area.width / area.height - usual.x, usual.width),
    height: share(preferred?.height, 1 - usual.y, usual.height),
  };
}

/** Who a game overlay belongs to: one key of one module in one workspace. */
export interface GameOverlaySubject {
  owner: string;
  moduleId: string;
  gameId: string;
  key: string;
}

export interface GameOverlay extends GameOverlaySubject {
  scope: OverlayScope;
  mode: OverlayMode;
  opacity: Opacity;
  /** Whether the window is hidden from screen capture (opt-in; off by default, as some anti-cheats flag it). */
  hideFromCapture: boolean;
  rect: AnchoredRect;
  /**
   * Set while the position is not converted yet: the fractions of the window an older Tavora saved. The item is placed
   * the old way (placeItem) until the game's real window size is seen; `rect` is only a stand-in then.
   */
  legacy?: LegacyRect;
}

/** A panel the player chose to show in their game (by its instance id). It is over the game only while the layer is open. */
export interface InGamePanel {
  owner: string;
  moduleId: string;
  /** The workspace the panel is in. */
  gameId: string;
  scope: OverlayScope;
  instanceId: string;
  rect: AnchoredRect;
  /** Set until the position is converted, as on GameOverlay. */
  legacy?: LegacyRect;
  /** Its live view (the module's overlay page over the game while the layer is closed): always there, or with a key of its own. */
  mode: OverlayMode;
  opacity: Opacity;
  hideFromCapture: boolean;
}

/**
 * The file's version now. Version 3 keeps each position twice: `anchor` (an AnchoredRect) and `rect` (fractions of the
 * window, as versions 1 and 2 kept them, computed on the last window size seen), so an older Tavora still places things
 * right. An item without `anchor` is not converted yet. A file of a higher version is never overwritten.
 */
export const FILE_VERSION = 3;

/** Where an item sits: placed the old way until it is converted, else anchored to the game window. */
export function placeItem(item: { rect: AnchoredRect; legacy?: LegacyRect }, game: Rect, min?: number): Rect {
  return item.legacy ? placeLegacy(item.legacy, game, min) : placeAnchored(item.rect, game, min);
}

/** The size of a game's window as last seen (DIPs), kept to draw the Overlay layout's canvas and to convert old positions. */
export interface SeenSize {
  width: number;
  height: number;
}

/** What the file keeps of a position: fractions of the window (for older Tavoras, and all there is until converted) and the anchor. */
type StoredPosition = { rect: LegacyRect; anchor?: AnchoredRect };

type GameOverlayFile = {
  version?: number;
  exclusiveHintShown?: boolean;
  /** The Overlay layout: the grid setting, the window's place and the last window size seen per game. */
  layout?: { grid?: GridSetting; window?: WindowState; seen?: Record<string, SeenSize> };
  overlays: unknown[];
  panels: unknown[];
};

/** What the player can change on an existing overlay. */
export type GameOverlayChange = Partial<Pick<GameOverlay, "mode" | "opacity" | "hideFromCapture" | "rect">>;

/** The most games whose window size is kept. */
const MAX_SEEN = 200;

export const sameOverlay = (a: GameOverlaySubject, b: GameOverlaySubject) => a.owner === b.owner && a.moduleId === b.moduleId && a.gameId === b.gameId && a.key === b.key;

/** One text for an overlay, to key maps and windows by. */
export const overlayId = (subject: GameOverlaySubject) => [subject.owner, subject.moduleId, subject.gameId, subject.key].join("\n");

/** One text for an in-game panel's window. */
export const panelWindowId = (instanceId: string) => `panel\n${instanceId}`;

/** One text for an in-game panel's live view window. */
export const liveWindowId = (instanceId: string) => `live\n${instanceId}`;

/** What the player can change on an in-game panel's live view. */
export type InGamePanelChange = Partial<Pick<InGamePanel, "mode" | "opacity" | "hideFromCapture">>;

/** Whether something (an overlay or an in-game panel) shows over `gameId`: its own game, or any game for a general one. */
export const appliesTo = (item: { scope: OverlayScope; gameId: string }, gameId: string) => item.scope === "all" || item.gameId === gameId;

/** What limits count together: a game's own, and the general ones. */
const bucketOf = (item: { scope: OverlayScope; gameId: string }) => (item.scope === "all" ? ALL_GAMES : item.gameId);

/** The rule of the Live badge on a panel's tab: the panel is in the game, or its module has an overlay that shows over the game. */
export const isLive = (panelInGame: boolean, moduleOverlays: number) => panelInGame || moduleOverlays > 0;

// ── Where an overlay sits ──────────────────────────────────────────────

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The rectangle a drag or resize makes: `rect` moved by (dx, dy), or with the edges in `edges` pulled, kept inside the game window. */
export function dragRect(rect: Rect, game: Rect, edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean } | null, dx: number, dy: number): Rect {
  if (!edges) {
    return {
      ...rect,
      x: clamp(rect.x + dx, game.x, game.x + game.width - rect.width),
      y: clamp(rect.y + dy, game.y, game.y + game.height - rect.height),
    };
  }
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;
  if (edges.left) left = clamp(left + dx, game.x, right - MIN_OVERLAY_SIZE);
  if (edges.right) right = clamp(right + dx, left + MIN_OVERLAY_SIZE, game.x + game.width);
  if (edges.top) top = clamp(top + dy, game.y, bottom - MIN_OVERLAY_SIZE);
  if (edges.bottom) bottom = clamp(bottom + dy, top + MIN_OVERLAY_SIZE, game.y + game.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}


// ── Panels in the game ─────────────────────────────────────────────────

/** How much room the arrange frame takes around a panel in the layer: a bar on top (name, close) and edges to grab. */
export const PANEL_ARRANGE_INSET = { top: 30, side: 8 } as const;

/** Where a panel sits in its overlay window: all of it, or inside the arrange frame. */
export function panelBounds(size: { width: number; height: number }, arranging: boolean): Rect {
  if (!arranging) return { x: 0, y: 0, width: size.width, height: size.height };
  const { top, side } = PANEL_ARRANGE_INSET;
  return { x: side, y: top, width: Math.max(1, size.width - 2 * side), height: Math.max(1, size.height - top - side) };
}

/**
 * Whether a click or key press in a panel counts as the player's (links.open, pictures.save and the like need one).
 * A panel in the game takes input only while the layer is open, so nothing else is the player's.
 */
export const gestureCounts = (overGame: boolean, layerOpen: boolean) => !overGame || layerOpen;

// ── When an overlay shows ──────────────────────────────────────────────

export interface VisibilityInput {
  /** Game overlays are on, and not hidden for now. */
  enabled: boolean;
  /** The overlay applies to the game in front. */
  gameInFront: boolean;
  mode: OverlayMode;
  /** The overlay's key switched it on (toggle mode). */
  toggledOn: boolean;
  /** The in-game layer is open: all overlays of the game show, each with its frame, so each can be placed. */
  layerOpen: boolean;
}

export function overlayVisible({ enabled, gameInFront, mode, toggledOn, layerOpen }: VisibilityInput): boolean {
  if (!enabled || !gameInFront) return false;
  return layerOpen || mode === "always" || toggledOn;
}

/**
 * The game in front, given the games the front window's program belongs to: one that has overlays or panels of its own,
 * else (when something is general) any library game, if the program could belong to several (a launcher folder).
 */
export function gameInFront(programGames: ReadonlySet<string>, withItems: ReadonlySet<string>, general: boolean, isGame: (gameId: string) => boolean): string | null {
  for (const id of programGames) if (withItems.has(id)) return id;
  if (general) for (const id of programGames) if (isGame(id)) return id;
  return null;
}

/** QUNS_RUNNING_D3D_FULL_SCREEN of SHQueryUserNotificationState: an exclusive full-screen game, which no window can be drawn over. */
export const EXCLUSIVE_FULLSCREEN = 3;

export function looksExclusive(notificationState: number | null): boolean {
  return notificationState === EXCLUSIVE_FULLSCREEN;
}

// ── The store ──────────────────────────────────────────────────────────

/** How long saving waits for more changes, so a drag is written once. */
const SAVE_DELAY_MS = 250;

export type AddResult = "added" | "exists" | "full";

const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validField = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128;
/** A window size that is a size: whole numbers, big enough to be a window, not absurd. */
function validSize(value: unknown): SeenSize | null {
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const w = Math.round(width);
  const h = Math.round(height);
  return w >= 100 && h >= 100 && w <= 20_000 && h <= 20_000 ? { width: w, height: h } : null;
}

export class GameOverlayStore {
  /** The file was of version 1 (Tavora 0.21.0 and before); it is written as the current version from now on. */
  migrated = false;
  /** The file was of version 2 or 1: its positions convert as the games' windows are seen, and it is written as version 3 from now on. */
  upgraded = false;
  /** The Overlay layout's grid, its window's place and the last window size seen per game. */
  private gridSetting: GridSetting = DEFAULT_GRID;
  private windowState: WindowState | null = null;
  private seen = new Map<string, SeenSize>();
  private readonly queue = new SerialQueue();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    private readonly file: string,
    private overlays: GameOverlay[],
    private inGame: InGamePanel[],
    private hintShown: boolean,
  ) {}

  /**
   * Loads what was kept. A file of version 1 (Tavora 0.21.0 and before) is migrated: its overlays have no scope, so
   * `scopeOf` tells it from the workspace's kind, and the permanent panels over the game it may hold (keys behind
   * RESERVED_KEY_PREFIX) are not kept. `migrated` says so. Positions of a file of version 2 or 1 were fractions of the
   * game window and stay so (`legacy`) until the game's real window is seen (convertLegacy), because older Tavoras never
   * kept its size. `upgraded` says so. A file of a higher version (a newer Tavora wrote it) is set aside, not read.
   */
  static async load(userData: string, scopeOf: (gameId: string) => OverlayScope = () => "game"): Promise<GameOverlayStore> {
    const file = path.join(userData, GAME_OVERLAYS_FILE);
    const read = await readJsonOrSetAside<Partial<GameOverlayFile>>(file);
    const newer = typeof read?.version === "number" && read.version > FILE_VERSION;
    // Written by a newer Tavora: kept for that one, and never written over.
    if (newer) await setAside(file);
    const raw = newer ? null : read;
    const store = new GameOverlayStore(file, [], [], raw?.exclusiveHintShown === true);
    const known = raw !== null && raw !== undefined;
    store.migrated = known && raw.version !== 2 && raw.version !== FILE_VERSION;
    store.upgraded = known && raw.version !== FILE_VERSION;
    const layout = typeof raw?.layout === "object" && raw.layout !== null ? raw.layout : {};
    if (isGridSetting(layout.grid)) store.gridSetting = layout.grid;
    store.windowState = layout.window && typeof layout.window === "object" ? layout.window : null;
    for (const [gameId, size] of Object.entries(typeof layout.seen === "object" && layout.seen !== null ? layout.seen : {}).slice(0, MAX_SEEN)) {
      const valid = validSize(size);
      if (valid && validField(gameId)) store.seen.set(gameId, valid);
    }
    /** A saved position: the anchor when there is one, else the fractions, which wait to be converted. */
    const positionOf = (entry: object): Pick<GameOverlay, "rect" | "legacy"> | null => {
      const { rect, anchor } = entry as Partial<Record<keyof StoredPosition, unknown>>;
      const anchored = normalizeAnchored(anchor);
      if (anchored) return { rect: anchored };
      const legacy = normalizeLegacy(rect);
      // The stand-in is only there because a rectangle must exist; placeItem places the legacy one.
      return legacy ? { rect: migrateLegacy(legacy, DEFAULT_GAME_SIZE), legacy } : null;
    };
    for (const entry of Array.isArray(raw?.overlays) ? raw.overlays : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const { owner, moduleId, gameId, key, scope, mode, opacity, hideFromCapture } = entry as Partial<Record<keyof GameOverlay, unknown>>;
      if (![owner, moduleId, gameId].every(validField)) continue;
      const position = positionOf(entry);
      if (typeof key !== "string" || !OVERLAY_KEY.test(key) || (store.migrated && key.startsWith(RESERVED_KEY_PREFIX)) || !position) continue;
      const overlay: GameOverlay = {
        owner: owner as string,
        moduleId: moduleId as string,
        gameId: gameId as string,
        key,
        scope: scope === "all" || scope === "game" ? scope : scopeOf(gameId as string),
        mode: mode === "toggle" ? "toggle" : "always",
        opacity: OPACITIES.find((value) => value === opacity) ?? 100,
        hideFromCapture: hideFromCapture === true,
        ...position,
      };
      if (store.find(overlay) || store.count(bucketOf(overlay)) >= LIMITS.maxGameOverlays) continue;
      store.overlays.push(overlay);
    }
    for (const entry of Array.isArray(raw?.panels) ? raw.panels : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const { owner, moduleId, gameId, scope, instanceId, mode, opacity, hideFromCapture } = entry as Partial<Record<keyof InGamePanel, unknown>>;
      if (![owner, moduleId, gameId].every(validField)) continue;
      const position = positionOf(entry);
      if (typeof instanceId !== "string" || !INSTANCE_ID.test(instanceId) || !position) continue;
      const panel: InGamePanel = {
        owner: owner as string,
        moduleId: moduleId as string,
        gameId: gameId as string,
        scope: scope === "all" || scope === "game" ? scope : scopeOf(gameId as string),
        instanceId,
        ...position,
        mode: mode === "toggle" ? "toggle" : "always",
        opacity: OPACITIES.find((value) => value === opacity) ?? 100,
        hideFromCapture: hideFromCapture === true,
      };
      if (store.panelOf(instanceId) || store.count(bucketOf(panel)) >= LIMITS.maxGameOverlays) continue;
      store.inGame.push(panel);
    }
    return store;
  }

  all(): readonly GameOverlay[] {
    return this.overlays;
  }

  panels(): readonly InGamePanel[] {
    return this.inGame;
  }

  /** The overlays that show over `gameId`: its own and the general ones. */
  of(gameId: string): GameOverlay[] {
    return this.overlays.filter((overlay) => appliesTo(overlay, gameId));
  }

  panelsOf(gameId: string): InGamePanel[] {
    return this.inGame.filter((panel) => appliesTo(panel, gameId));
  }

  panelOf(instanceId: string): InGamePanel | undefined {
    return this.inGame.find((panel) => panel.instanceId === instanceId);
  }

  find(subject: GameOverlaySubject): GameOverlay | undefined {
    return this.overlays.find((overlay) => sameOverlay(overlay, subject));
  }

  /** Overlays and panels sharing one limit: a game's own, or the general ones (`ALL_GAMES`). */
  private count(bucket: string): number {
    return [...this.overlays, ...this.inGame].filter((item) => bucketOf(item) === bucket).length;
  }

  /** Where the next one of a bucket starts: below the others, so a second one doesn't hide the first. */
  private startRect(first: AnchoredRect, bucket: string): AnchoredRect {
    const row = this.count(bucket) % 4;
    return { ...first, y: Math.min(first.y + row * (first.height + 0.02), 1 - first.height) };
  }

  /** Adds an overlay with the usual settings, in the corner of the game's window; a game (and the general ones) may have `LIMITS.maxGameOverlays`. */
  add(subject: GameOverlaySubject, scope: OverlayScope, first: AnchoredRect = DEFAULT_RECT): AddResult {
    if (this.find(subject)) return "exists";
    const bucket = bucketOf({ scope, gameId: subject.gameId });
    if (this.count(bucket) >= LIMITS.maxGameOverlays) return "full";
    this.overlays.push({ ...subject, scope, mode: "always", opacity: 100, hideFromCapture: false, rect: this.startRect(first, bucket) });
    this.saveSoon();
    return "added";
  }

  /** Marks a panel as shown in the game; it counts toward the same limit as overlays. */
  addPanel(panel: Omit<InGamePanel, "rect" | "mode" | "opacity" | "hideFromCapture">, first: AnchoredRect = DEFAULT_PANEL_ANCHORED): AddResult {
    if (this.panelOf(panel.instanceId)) return "exists";
    const bucket = bucketOf(panel);
    if (this.count(bucket) >= LIMITS.maxGameOverlays) return "full";
    this.inGame.push({ ...panel, rect: this.startRect(first, bucket), mode: "always", opacity: 100, hideFromCapture: false });
    this.saveSoon();
    return "added";
  }

  /** Changes what the player set for an overlay; false when there is no such overlay. */
  update(subject: GameOverlaySubject, change: GameOverlayChange): boolean {
    const overlay = this.find(subject);
    if (!overlay) return false;
    if (change.mode) overlay.mode = change.mode;
    if (change.opacity !== undefined && OPACITIES.includes(change.opacity)) overlay.opacity = change.opacity;
    if (change.hideFromCapture !== undefined) overlay.hideFromCapture = change.hideFromCapture;
    const rect = change.rect ? normalizeAnchored(change.rect) : null;
    if (rect) {
      overlay.rect = rect;
      delete overlay.legacy;
    }
    this.saveSoon();
    return true;
  }

  updatePanel(instanceId: string, rect: AnchoredRect): boolean {
    const panel = this.panelOf(instanceId);
    if (!panel) return false;
    const next = normalizeAnchored(rect);
    if (next) {
      panel.rect = next;
      delete panel.legacy;
    }
    this.saveSoon();
    return true;
  }

  /** Changes the live view's settings of a panel in the game; false when the panel isn't in the game. */
  updatePanelView(instanceId: string, change: InGamePanelChange): boolean {
    const panel = this.panelOf(instanceId);
    if (!panel) return false;
    if (change.mode) panel.mode = change.mode;
    if (change.opacity !== undefined && OPACITIES.includes(change.opacity)) panel.opacity = change.opacity;
    if (change.hideFromCapture !== undefined) panel.hideFromCapture = change.hideFromCapture;
    this.saveSoon();
    return true;
  }

  /** Removes the overlays matching `test` (the player's remove, a deleted game, a module that is gone); whether any went. */
  forget(test: (overlay: GameOverlay) => boolean): boolean {
    const kept = this.overlays.filter((overlay) => !test(overlay));
    if (kept.length === this.overlays.length) return false;
    this.overlays = kept;
    this.saveSoon();
    return true;
  }

  /** The same for panels shown in the game. */
  forgetPanels(test: (panel: InGamePanel) => boolean): boolean {
    const kept = this.inGame.filter((panel) => !test(panel));
    if (kept.length === this.inGame.length) return false;
    this.inGame = kept;
    this.saveSoon();
    return true;
  }

  /** Whether the hint about exclusive full screen was shown; it is shown once. */
  get exclusiveHintShown(): boolean {
    return this.hintShown;
  }

  markExclusiveHintShown(): void {
    this.hintShown = true;
    this.saveSoon();
  }

  // ── The Overlay layout ───────────────────────────────────────────────

  get grid(): GridSetting {
    return this.gridSetting;
  }

  setGrid(setting: GridSetting): void {
    if (!isGridSetting(setting) || setting === this.gridSetting) return;
    this.gridSetting = setting;
    this.saveSoon();
  }

  /** The Overlay layout window's size and place as last saved, or null. */
  get layoutWindow(): WindowState | null {
    return this.windowState;
  }

  setLayoutWindow(state: WindowState): void {
    this.windowState = state;
    this.saveSoon();
  }

  /** The size of the game's window as last seen (DIPs), or undefined when none was. */
  seenSize(gameId: string): SeenSize | undefined {
    return this.seen.get(gameId);
  }

  /** Remembers the game window's size; whether it differs from the one kept. Sizes that aren't plausible are ignored. */
  setSeen(gameId: string, size: SeenSize): boolean {
    const valid = validSize(size);
    if (!valid || !validField(gameId)) return false;
    const now = this.seen.get(gameId);
    if (now?.width === valid.width && now.height === valid.height) return false;
    if (!now && this.seen.size >= MAX_SEEN) this.seen.delete(this.seen.keys().next().value!);
    this.seen.set(gameId, valid);
    this.saveSoon();
    return true;
  }

  /** A game left the library: its window size goes too. */
  forgetSeen(gameId: string): void {
    if (this.seen.delete(gameId)) this.saveSoon();
  }

  /** Puts the position of an overlay or panel to `rect` (the layout's Reset position); false when there is no such item. */
  setRect(subject: GameOverlaySubject | { instanceId: string }, rect: AnchoredRect): boolean {
    const target = "instanceId" in subject ? this.panelOf(subject.instanceId) : this.find(subject);
    const next = normalizeAnchored(rect);
    if (!target || !next) return false;
    target.rect = next;
    delete target.legacy;
    this.saveSoon();
    return true;
  }

  /**
   * The game's real window was seen: the positions still kept as fractions of the window (its own, and the general
   * ones) are converted for this size, so each stays on the very same pixels. Whether any was.
   */
  convertLegacy(gameId: string, size: { width: number; height: number }): boolean {
    if (!isRealWindow(size)) return false;
    let any = false;
    for (const item of [...this.overlays, ...this.inGame]) {
      if (!item.legacy || !appliesTo(item, gameId)) continue;
      item.rect = migrateLegacy(item.legacy, size);
      delete item.legacy;
      any = true;
    }
    if (any) this.saveSoon();
    return any;
  }

  /** A position as the file keeps it: the anchor, and the fractions of the window for older Tavoras. */
  private stored(item: { gameId: string; rect: AnchoredRect; legacy?: LegacyRect }): StoredPosition {
    if (item.legacy) return { rect: item.legacy };
    const size = this.seen.get(item.gameId) ?? DEFAULT_GAME_SIZE;
    const placed = placeAnchored(item.rect, { x: 0, y: 0, ...size });
    const fractions = normalizeLegacy({ x: placed.x / size.width, y: placed.y / size.height, width: placed.width / size.width, height: placed.height / size.height });
    return { rect: fractions ?? { x: 0, y: 0, width: 1, height: 1 }, anchor: item.rect };
  }

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** Writes game-overlays.json now; also called on quit so the last change is not lost. */
  save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const body: GameOverlayFile = {
      version: FILE_VERSION,
      exclusiveHintShown: this.hintShown,
      layout: { grid: this.gridSetting, ...(this.windowState ? { window: this.windowState } : {}), seen: Object.fromEntries(this.seen) },
      overlays: this.overlays.map(({ rect, legacy, ...item }) => ({ ...item, ...this.stored({ gameId: item.gameId, rect, ...(legacy ? { legacy } : {}) }) })),
      panels: this.inGame.map(({ rect, legacy, ...item }) => ({ ...item, ...this.stored({ gameId: item.gameId, rect, ...(legacy ? { legacy } : {}) }) })),
    };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.file, text)).catch((error: unknown) => console.error("[tavora] saving game overlays failed", error));
  }
}
