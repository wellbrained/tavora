// Game overlays: a module's overlay page (the manifest's `overlay`) shown over the player's game in a Tavora window
// (game-overlay-window.ts), only while that game is in front. This file holds what the player set for each one, kept in
// game-overlays.json in the data folder, and the rules that don't need Windows: where an overlay sits relative to the
// game's window, and when it is shown. The keys that toggle overlays or arrange them live in hotkeys.json with the
// other hotkeys (hotkeys.ts), under the actions below.
import path from "node:path";
import { LIMITS, OVERLAY_KEY } from "@tavora/sdk/protocol";
import { SerialQueue, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside } from "./json";

export const GAME_OVERLAYS_FILE = "game-overlays.json";

/** The hotkey actions game overlays use. A `$` keeps them apart from any action a module declares. */
export const OVERLAY_TOGGLE_ACTION = "$overlay";
export const OVERLAY_ARRANGE_ACTION = "$arrange";
/** Who owns the arrange hotkey of a game: Tavora itself. */
export const ARRANGE_OWNER = "tavora";

/**
 * A panel the player moved over its game (from Tavora's own panel menu) is a game overlay whose key is the panel's id
 * behind this prefix. Modules can't pick keys that start with it (game-overlay-service.ts show), and these overlays are
 * not kept across a restart: the panel is back in its workspace slot the next time Tavora starts.
 */
export const PANEL_KEY_PREFIX = "panel-";
export const panelKey = (instanceId: string) => `${PANEL_KEY_PREFIX}${instanceId}`;
export const isPanelKey = (key: string) => key.startsWith(PANEL_KEY_PREFIX);
/** The panel instance a panel overlay's key names. */
export const panelInstanceOf = (key: string) => key.slice(PANEL_KEY_PREFIX.length);

/** How much of the page shows through the window: Tavora's own setting per overlay. */
export const OPACITIES = [100, 75, 50, 25] as const;
export type Opacity = (typeof OPACITIES)[number];

/** `always`: shown whenever the game is in front. `toggle`: shown or hidden by the overlay's key. */
export type OverlayMode = "always" | "toggle";

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
/** A panel over the game is taller than an overlay page: it is a whole panel, not one number. */
export const DEFAULT_PANEL_RECT: RelativeRect = { x: 0.02, y: 0.03, width: 0.22, height: 0.4 };

/** Who a game overlay belongs to: one key of one module in one game. */
export interface GameOverlaySubject {
  owner: string;
  moduleId: string;
  gameId: string;
  key: string;
}

export interface GameOverlay extends GameOverlaySubject {
  mode: OverlayMode;
  opacity: Opacity;
  /** Whether the window is hidden from screen capture (opt-in; off by default, as some anti-cheats flag it). */
  hideFromCapture: boolean;
  rect: RelativeRect;
}

type GameOverlayFile = { version: 1; exclusiveHintShown?: boolean; overlays: GameOverlay[] };

/** What the player can change on an existing overlay. */
export type GameOverlayChange = Partial<Pick<GameOverlay, "mode" | "opacity" | "hideFromCapture" | "rect">>;

export const sameOverlay = (a: GameOverlaySubject, b: GameOverlaySubject) => a.owner === b.owner && a.moduleId === b.moduleId && a.gameId === b.gameId && a.key === b.key;

/** One text for an overlay, to key maps and windows by. */
export const overlayId = (subject: GameOverlaySubject) => [subject.owner, subject.moduleId, subject.gameId, subject.key].join("\n");

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

// ── Panels over the game ───────────────────────────────────────────────

/** How much room the arrange frame takes around a panel while arranging: a bar on top (name, close) and edges to grab. */
export const PANEL_ARRANGE_INSET = { top: 30, side: 8 } as const;

/** Where a panel sits in its overlay window: all of it, or inside the arrange frame. */
export function panelBounds(size: { width: number; height: number }, arranging: boolean): Rect {
  if (!arranging) return { x: 0, y: 0, width: size.width, height: size.height };
  const { top, side } = PANEL_ARRANGE_INSET;
  return { x: side, y: top, width: Math.max(1, size.width - 2 * side), height: Math.max(1, size.height - top - side) };
}

/**
 * Whether a click or key press in a panel counts as the player's (links.open, pictures.save and the like need one).
 * A panel over the game takes input only while arranging, so nothing else is the player's.
 */
export const gestureCounts = (overGame: boolean, arranging: boolean) => !overGame || arranging;

// ── When an overlay shows ──────────────────────────────────────────────

export interface VisibilityInput {
  /** The Game overlays switch in Settings > Overlays. */
  enabled: boolean;
  /** The game the overlay belongs to is running and its window is the one in front. */
  gameInFront: boolean;
  mode: OverlayMode;
  /** The overlay's key switched it on (toggle mode). */
  toggledOn: boolean;
  /** The game's overlays are being arranged: all of them show, so each can be placed. */
  arranging: boolean;
}

export function overlayVisible({ enabled, gameInFront, mode, toggledOn, arranging }: VisibilityInput): boolean {
  if (!enabled || !gameInFront) return false;
  return arranging || mode === "always" || toggledOn;
}

/**
 * The game in front, given the games the front window's program belongs to: the one that has overlays, if the program
 * could belong to several (a launcher folder, a game installed twice).
 */
export function gameInFront(programGames: ReadonlySet<string>, withOverlays: ReadonlySet<string>): string | null {
  for (const id of programGames) if (withOverlays.has(id)) return id;
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

export class GameOverlayStore {
  private readonly queue = new SerialQueue();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    private readonly file: string,
    private overlays: GameOverlay[],
    private hintShown: boolean,
  ) {}

  static async load(userData: string): Promise<GameOverlayStore> {
    const file = path.join(userData, GAME_OVERLAYS_FILE);
    const raw = await readJsonOrSetAside<Partial<GameOverlayFile>>(file);
    const overlays: GameOverlay[] = [];
    for (const entry of Array.isArray(raw?.overlays) ? raw.overlays : []) {
      if (typeof entry !== "object" || entry === null) continue;
      const { owner, moduleId, gameId, key, mode, opacity, hideFromCapture, rect } = entry as Partial<Record<keyof GameOverlay, unknown>>;
      const fields = [owner, moduleId, gameId].every((value) => typeof value === "string" && value.length > 0 && value.length <= 128);
      const relative = normalizeRelative(rect);
      // Panels over the game are not kept (see PANEL_KEY_PREFIX).
      if (!fields || typeof key !== "string" || !OVERLAY_KEY.test(key) || isPanelKey(key) || !relative) continue;
      const overlay: GameOverlay = {
        owner: owner as string,
        moduleId: moduleId as string,
        gameId: gameId as string,
        key,
        mode: mode === "toggle" ? "toggle" : "always",
        opacity: OPACITIES.find((value) => value === opacity) ?? 100,
        hideFromCapture: hideFromCapture === true,
        rect: relative,
      };
      if (overlays.some((item) => sameOverlay(item, overlay)) || overlays.filter((item) => item.gameId === overlay.gameId).length >= LIMITS.maxGameOverlays) continue;
      overlays.push(overlay);
    }
    return new GameOverlayStore(file, overlays, raw?.exclusiveHintShown === true);
  }

  all(): readonly GameOverlay[] {
    return this.overlays;
  }

  of(gameId: string): GameOverlay[] {
    return this.overlays.filter((overlay) => overlay.gameId === gameId);
  }

  find(subject: GameOverlaySubject): GameOverlay | undefined {
    return this.overlays.find((overlay) => sameOverlay(overlay, subject));
  }

  /** Adds an overlay with the usual settings, in the corner of the game's window; the game may have `LIMITS.maxGameOverlays`. */
  add(subject: GameOverlaySubject): AddResult {
    if (this.find(subject)) return "exists";
    if (this.of(subject.gameId).length >= LIMITS.maxGameOverlays) return "full";
    // Overlays of one game start below each other, so a second one doesn't hide the first.
    const row = this.of(subject.gameId).length % 4;
    const first = isPanelKey(subject.key) ? DEFAULT_PANEL_RECT : DEFAULT_RELATIVE_RECT;
    const rect = { ...first, y: Math.min(first.y + row * (first.height + 0.02), 1 - first.height) };
    this.overlays.push({ ...subject, mode: "always", opacity: 100, hideFromCapture: false, rect });
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

  /** Removes the overlays matching `test` (the player's remove, a deleted game, a module that is gone); whether any went. */
  forget(test: (overlay: GameOverlay) => boolean): boolean {
    const kept = this.overlays.filter((overlay) => !test(overlay));
    if (kept.length === this.overlays.length) return false;
    this.overlays = kept;
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
    const body: GameOverlayFile = { version: 1, exclusiveHintShown: this.hintShown, overlays: this.overlays.filter((overlay) => !isPanelKey(overlay.key)) };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.file, text)).catch((error: unknown) => console.error("[tavora] saving game overlays failed", error));
  }
}
