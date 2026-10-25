// Game overlays: a module's overlay page (the manifest's `overlay`) shown over the player's game in a Tavora window
// (game-overlay-window.ts), only while that game is in front, plus the panels the player chose to show in their game,
// which appear over it only while the in-game layer is open. This file holds what the player set for each one, kept in
// game-overlays.json in the data folder, and the rules that don't need Windows: where an overlay sits relative to the
// game's window, and when it is shown. The one key that opens the layer lives in hotkeys.json with the other hotkeys
// (hotkeys.ts), under the action below; so do the keys that toggle overlays.
import path from "node:path";
import { LIMITS, OVERLAY_KEY } from "@tavora/sdk/protocol";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";

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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where an overlay sits in the game's window, as fractions of the window's size, so resolution changes keep it. */
export type RelativeRect = Rect;

/** An overlay can't be smaller than this on screen, so it can always be grabbed. */
export const MIN_OVERLAY_SIZE = 48;
/** What a new overlay is given: the top left corner of the game window. */
export const DEFAULT_RELATIVE_RECT: RelativeRect = { x: 0.02, y: 0.03, width: 0.2, height: 0.16 };
/** A panel in the game is taller than an overlay page: it is a whole panel, not one number. */
export const DEFAULT_PANEL_RECT: RelativeRect = { x: 0.02, y: 0.03, width: 0.22, height: 0.4 };

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
  rect: RelativeRect;
}

/** A panel the player chose to show in their game (by its instance id). It is over the game only while the layer is open. */
export interface InGamePanel {
  owner: string;
  moduleId: string;
  /** The workspace the panel is in. */
  gameId: string;
  scope: OverlayScope;
  instanceId: string;
  rect: RelativeRect;
  /** Its live view (the module's overlay page over the game while the layer is closed): always there, or with a key of its own. */
  mode: OverlayMode;
  opacity: Opacity;
  hideFromCapture: boolean;
}

type GameOverlayFile = { version?: number; exclusiveHintShown?: boolean; overlays: GameOverlay[]; panels: InGamePanel[] };

/** What the player can change on an existing overlay. */
export type GameOverlayChange = Partial<Pick<GameOverlay, "mode" | "opacity" | "hideFromCapture" | "rect">>;

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

/** A saved rectangle that makes sense: finite fractions, inside the window, not smaller than a sliver. */
export function normalizeRelative(rect: unknown): RelativeRect | null {
  if (typeof rect !== "object" || rect === null) return null;
  const { x, y, width, height } = rect as Record<string, unknown>;
  if (![x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) return null;
  const w = clamp(width as number, 0.02, 1);
  const h = clamp(height as number, 0.02, 1);
  return { x: clamp(x as number, 0, 1 - w), y: clamp(y as number, 0, 1 - h), width: w, height: h };
}

/** Where a relative rectangle lands in the game's window `game` (screen coordinates), always inside it. */
export function placeRelative(rel: RelativeRect, game: Rect): Rect {
  const width = Math.min(game.width, Math.max(MIN_OVERLAY_SIZE, Math.round(rel.width * game.width)));
  const height = Math.min(game.height, Math.max(MIN_OVERLAY_SIZE, Math.round(rel.height * game.height)));
  const x = clamp(game.x + Math.round(rel.x * game.width), game.x, game.x + game.width - width);
  const y = clamp(game.y + Math.round(rel.y * game.height), game.y, game.y + game.height - height);
  return { x, y, width, height };
}

/** The relative rectangle of a rectangle on screen, for saving what the player dragged. */
export function relativeTo(rect: Rect, game: Rect): RelativeRect {
  if (game.width <= 0 || game.height <= 0) return { ...DEFAULT_RELATIVE_RECT };
  return normalizeRelative({
    x: (rect.x - game.x) / game.width,
    y: (rect.y - game.y) / game.height,
    width: rect.width / game.width,
    height: rect.height / game.height,
  })!;
}

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

export class GameOverlayStore {
  /** The file was of an older version; it is written as version 2 from now on. */
  migrated = false;
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
   * RESERVED_KEY_PREFIX) are not kept. `migrated` says so. A file of version 2 is taken as it is.
   */
  static async load(userData: string, scopeOf: (gameId: string) => OverlayScope = () => "game"): Promise<GameOverlayStore> {
    const file = path.join(userData, GAME_OVERLAYS_FILE);
    const raw = await readJsonOrSetAside<Partial<GameOverlayFile>>(file);
    const store = new GameOverlayStore(file, [], [], raw?.exclusiveHintShown === true);
    store.migrated = raw !== null && raw !== undefined && raw.version !== 2;
    for (const entry of Array.isArray(raw?.overlays) ? raw.overlays : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const { owner, moduleId, gameId, key, scope, mode, opacity, hideFromCapture, rect } = entry as Partial<Record<keyof GameOverlay, unknown>>;
      const relative = normalizeRelative(rect);
      if (![owner, moduleId, gameId].every(validField) || typeof key !== "string" || !OVERLAY_KEY.test(key) || (store.migrated && key.startsWith(RESERVED_KEY_PREFIX)) || !relative) continue;
      const overlay: GameOverlay = {
        owner: owner as string,
        moduleId: moduleId as string,
        gameId: gameId as string,
        key,
        scope: scope === "all" || scope === "game" ? scope : scopeOf(gameId as string),
        mode: mode === "toggle" ? "toggle" : "always",
        opacity: OPACITIES.find((value) => value === opacity) ?? 100,
        hideFromCapture: hideFromCapture === true,
        rect: relative,
      };
      if (store.find(overlay) || store.count(bucketOf(overlay)) >= LIMITS.maxGameOverlays) continue;
      store.overlays.push(overlay);
    }
    for (const entry of Array.isArray(raw?.panels) ? raw.panels : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const { owner, moduleId, gameId, scope, instanceId, rect, mode, opacity, hideFromCapture } = entry as Partial<Record<keyof InGamePanel, unknown>>;
      const relative = normalizeRelative(rect);
      if (![owner, moduleId, gameId].every(validField) || typeof instanceId !== "string" || !INSTANCE_ID.test(instanceId) || !relative) continue;
      const panel: InGamePanel = {
        owner: owner as string,
        moduleId: moduleId as string,
        gameId: gameId as string,
        scope: scope === "all" || scope === "game" ? scope : scopeOf(gameId as string),
        instanceId,
        rect: relative,
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
  private startRect(first: RelativeRect, bucket: string): RelativeRect {
    const row = this.count(bucket) % 4;
    return { ...first, y: Math.min(first.y + row * (first.height + 0.02), 1 - first.height) };
  }

  /** Adds an overlay with the usual settings, in the corner of the game's window; a game (and the general ones) may have `LIMITS.maxGameOverlays`. */
  add(subject: GameOverlaySubject, scope: OverlayScope): AddResult {
    if (this.find(subject)) return "exists";
    const bucket = bucketOf({ scope, gameId: subject.gameId });
    if (this.count(bucket) >= LIMITS.maxGameOverlays) return "full";
    this.overlays.push({ ...subject, scope, mode: "always", opacity: 100, hideFromCapture: false, rect: this.startRect(DEFAULT_RELATIVE_RECT, bucket) });
    this.saveSoon();
    return "added";
  }

  /** Marks a panel as shown in the game; it counts toward the same limit as overlays. */
  addPanel(panel: Omit<InGamePanel, "rect" | "mode" | "opacity" | "hideFromCapture">): AddResult {
    if (this.panelOf(panel.instanceId)) return "exists";
    const bucket = bucketOf(panel);
    if (this.count(bucket) >= LIMITS.maxGameOverlays) return "full";
    this.inGame.push({ ...panel, rect: this.startRect(DEFAULT_PANEL_RECT, bucket), mode: "always", opacity: 100, hideFromCapture: false });
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
    if (change.rect) overlay.rect = normalizeRelative(change.rect) ?? overlay.rect;
    this.saveSoon();
    return true;
  }

  updatePanel(instanceId: string, rect: RelativeRect): boolean {
    const panel = this.panelOf(instanceId);
    if (!panel) return false;
    panel.rect = normalizeRelative(rect) ?? panel.rect;
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

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** Writes game-overlays.json now; also called on quit so the last change is not lost. */
  save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const body: GameOverlayFile = { version: 2, exclusiveHintShown: this.hintShown, overlays: this.overlays, panels: this.inGame };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.file, text)).catch((error: unknown) => console.error("[tavora] saving game overlays failed", error));
  }
}
