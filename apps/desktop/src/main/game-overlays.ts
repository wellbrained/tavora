// Game overlays: a module's overlay page (the manifest's `overlay`) shown in a Tavora window (game-overlay-window.ts),
// plus the panels the user chose to show, which appear only while the in-game layer is open. Both are kept in
// setups (docs/features/overlay-setups.md): Everywhere shows over any app, All games over a game in front that has no
// setup of its own, and a game's own setup over that game. This file holds the setups, kept in game-overlays.json in
// the data folder, and the rules that don't need Windows: which setup shows, what may go where, where an item sits
// relative to its area, and when it is shown. The one key that opens the layer lives in hotkeys.json with the other
// hotkeys (hotkeys.ts), under the action below; so do the keys that toggle items.
import { readFile } from "node:fs/promises";
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
import { backupsDir } from "./backup";
import { SerialQueue, keepCopy, writeFileAtomic } from "./fsutil";
import { readJsonOrSetAside, setAside } from "./json";

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

/**
 * Overlay keys of a module can't start with this: older Tavoras kept panels moved over a game under such keys.
 * show() refuses them, and a file of that time (version 1) is cleaned of them once, when it is migrated.
 */
export const RESERVED_KEY_PREFIX = "panel-";

/** How much of the page shows through the window: Tavora's own setting per overlay. */
export const OPACITIES = [100, 75, 50, 25] as const;
export type Opacity = (typeof OPACITIES)[number];

/** `always`: shown whenever its setup shows. `toggle`: shown or hidden by the item's key. */
export type OverlayMode = "always" | "toggle";

/** The kind of workspace an item comes from: `game` (a game workspace) or `all` (a personal workspace, whose items may go into any setup). */
export type OverlayScope = "game" | "all";

/** The scope for something made in a workspace of this kind. */
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
  /** The workspace it was made in. A game workspace's id is its game's, so a game's own overlay names its game here. */
  workspaceId: string;
  key: string;
}

/** How an item is set in one setup: each setup that has it keeps its own. */
export interface ItemSettings {
  /** Its live view or page: always there, or with a key of its own. */
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

/** A module's overlay page in one setup. */
export interface GameOverlay extends GameOverlaySubject, ItemSettings {}

/** A panel the user chose to show in a setup (by its instance id): the panel itself, never a copy. It is over the game only while the layer is open. */
export interface InGamePanel extends ItemSettings {
  owner: string;
  moduleId: string;
  /** The workspace the panel is in. */
  workspaceId: string;
  instanceId: string;
}

/** Which item: a module overlay (by its subject) or a panel (by its instance id). */
export type ItemRef = { kind: "overlay"; subject: GameOverlaySubject } | { kind: "panel"; instanceId: string };

// ── Setups ─────────────────────────────────────────────────────────────

/** The setup that shows over any app, with or without a game, except while Tavora's own window is in front. */
export const EVERYWHERE = "$everywhere";
/** All games: the setup over a game in front that has no setup of its own. Its id is also the layer key's workspace. */
export const ALL_GAMES = "$all";

/** Whether a setup is one game's own (its id is the game workspace's). */
export const isGameSetup = (setupId: string) => setupId !== EVERYWHERE && setupId !== ALL_GAMES;

/** The setup that shows next to Everywhere over this game: its own, else All games. They never stack. */
export const gameSetupFor = (gameId: string, has: (setupId: string) => boolean): string => (has(gameId) ? gameId : ALL_GAMES);

/** Whether something from this workspace may go into the setup: from a personal workspace into any, from a game workspace only into its game's. */
export const allowedIn = (setupId: string, workspaceId: string, scope: OverlayScope): boolean => scope === "all" || setupId === workspaceId;

/** Where a module overlay or a panel shown in game lands: its game's setup, or All games when it comes from a personal workspace. */
export const landingSetup = (workspaceId: string, scope: OverlayScope): string => (scope === "game" ? workspaceId : ALL_GAMES);

/** One setup as the store keeps it: its overlays and panels, in the order they were added. */
interface Setup {
  id: string;
  overlays: GameOverlay[];
  panels: InGamePanel[];
}

/**
 * The file's version now. Version 5 keeps setups: Everywhere, All games and one per game, each with its own items
 * and their own settings. Versions 4 and before kept items with a scope (one game's, or general) and per-game positions
 * of the general ones; load moves them into setups (moveToSetups) after copying the file to backups/before-overlay-setups.
 * Version 4 is version 3 with the workspace names (workspace-move.ts); a file moved from version 1 or 2 says so in
 * `formerVersion`. Version 3 kept each position twice (an anchor and fractions of the window for older Tavoras); an
 * item without an anchor is not converted yet. A file of a higher version is never overwritten.
 */
export const FILE_VERSION = 5;

/** The folder in backups/ that keeps game-overlays.json as it was before the setups. Backups never prune it. */
export const BEFORE_SETUPS_DIR = "before-overlay-setups";

/** Where an item sits: placed the old way until it is converted, else anchored to its area (the game window, or the screen for Everywhere). */
export function placeItem(item: { rect: AnchoredRect; legacy?: LegacyRect }, game: Rect, min?: number): Rect {
  return item.legacy ? placeLegacy(item.legacy, game, min) : placeAnchored(item.rect, game, min);
}

/** The size of a game's window as last seen (DIPs), kept to draw the Overlay layout's canvas and to convert old positions. */
export interface SeenSize {
  width: number;
  height: number;
}

/** What the file keeps of a position: the anchor, or the fractions of the window while it is not converted. */
type StoredPosition = { anchor: AnchoredRect } | { rect: LegacyRect };

type StoredSetup = { id: string; overlays: unknown[]; panels: unknown[] };

type GameOverlayFile = {
  version?: number;
  /** The version a file had before the workspace names, when it was 1 or 2. Kept until the moves of start() ran. */
  formerVersion?: number;
  exclusiveHintShown?: boolean;
  /** The Overlay page: the grid setting and the last window size seen per game. Versions 4 and before also had `games`. */
  layout?: { grid?: GridSetting; seen?: Record<string, SeenSize>; games?: unknown };
  setups?: StoredSetup[];
  /** Versions 4 and before. */
  overlays?: unknown[];
  panels?: unknown[];
};

/** What the user can change on an existing overlay. */
export type GameOverlayChange = Partial<Pick<GameOverlay, "mode" | "opacity" | "hideFromCapture" | "rect">>;

/** The most games whose window size is kept. */
const MAX_SEEN = 200;

export const sameOverlay = (a: GameOverlaySubject, b: GameOverlaySubject) => a.owner === b.owner && a.moduleId === b.moduleId && a.workspaceId === b.workspaceId && a.key === b.key;

/** One text for an overlay, to key maps and windows by. */
export const overlayId = (subject: GameOverlaySubject) => [subject.owner, subject.moduleId, subject.workspaceId, subject.key].join("\n");

/** One text for an in-game panel's window. */
export const panelWindowId = (instanceId: string) => `panel\n${instanceId}`;

/** One text for an in-game panel's live view window. */
export const liveWindowId = (instanceId: string) => `live\n${instanceId}`;

/** The text an item is named by in the Overlay layout and in undo steps: overlayId, or panelWindowId. */
export const itemId = (item: GameOverlaySubject | { instanceId: string }) => ("instanceId" in item ? panelWindowId(item.instanceId) : overlayId(item));

/** What the user can change on an in-game panel's live view. */
export type InGamePanelChange = Partial<Pick<InGamePanel, "mode" | "opacity" | "hideFromCapture">>;

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
 * Whether a click or key press in a panel counts as the user's (links.open, pictures.save and the like need one).
 * A panel in the game takes input only while the layer is open, so nothing else is the user's.
 */
export const gestureCounts = (overGame: boolean, layerOpen: boolean) => !overGame || layerOpen;

// ── When an overlay shows ──────────────────────────────────────────────

/**
 * The setups on screen now: Everywhere, unless Tavora's own window is in front, plus for a game (the one in front, or
 * the one overlays stay over) its own setup or else All games. A game's setup and All games never stack.
 */
export function setupsOnScreen(gameId: string | null, tavoraInFront: boolean, has: (setupId: string) => boolean): string[] {
  const shown = tavoraInFront ? [] : [EVERYWHERE];
  if (gameId !== null) shown.push(gameSetupFor(gameId, has));
  return shown;
}

export interface VisibilityInput {
  /** Game overlays are on, and not hidden for now. */
  enabled: boolean;
  /** The item's setup is on screen now (setupsOnScreen). */
  gameInFront: boolean;
  mode: OverlayMode;
  /** The overlay's key switched it on (toggle mode). */
  toggledOn: boolean;
  /** The in-game layer is open: every item on screen shows, each with its frame, so each can be placed. */
  layerOpen: boolean;
}

export function overlayVisible({ enabled, gameInFront, mode, toggledOn, layerOpen }: VisibilityInput): boolean {
  if (!enabled || !gameInFront) return false;
  return layerOpen || mode === "always" || toggledOn;
}

/**
 * The game in front, given the games the front window's program belongs to: one that has a setup of its own, else
 * (when All games has something) any library game, if the program could belong to several (a launcher folder).
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

/** `refused`: the item may not go into that setup (a game workspace's into another game's, or a setup that isn't there). */
export type AddResult = "added" | "exists" | "full" | "refused";

/** What copying a setup did (GameOverlayStore.copySetup): how many items went in, which were left out and why, and what a replace took out. */
export interface CopyOutcome {
  copied: number;
  /** One entry per item left out, with the workspace it comes from. */
  skipped: { reason: "game-only" | "not-in-game" | "exists" | "full"; workspaceId: string }[];
  removed: { overlays: GameOverlay[]; panels: InGamePanel[] };
}

const INSTANCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validField = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** A window size that is a size: whole numbers, big enough to be a window, not absurd. */
function validSize(value: unknown): SeenSize | null {
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as Record<string, unknown>;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const w = Math.round(width);
  const h = Math.round(height);
  return w >= 100 && h >= 100 && w <= 20_000 && h <= 20_000 ? { width: w, height: h } : null;
}

/** A saved position: the anchor when there is one, else the fractions, which wait to be converted. */
function positionOf(entry: Record<string, unknown>): Pick<ItemSettings, "rect" | "legacy"> | null {
  const anchored = normalizeAnchored(entry.anchor);
  if (anchored) return { rect: anchored };
  const legacy = normalizeLegacy(entry.rect);
  // The stand-in is only there because a rectangle must exist; placeItem places the legacy one.
  return legacy ? { rect: migrateLegacy(legacy, DEFAULT_GAME_SIZE), legacy } : null;
}

/** What the user set for an item, with the defaults for what is missing or not understood. */
function settingsOf(entry: Record<string, unknown>): Omit<ItemSettings, "rect" | "legacy"> {
  return {
    mode: entry.mode === "toggle" ? "toggle" : "always",
    opacity: OPACITIES.find((value) => value === entry.opacity) ?? 100,
    hideFromCapture: entry.hideFromCapture === true,
  };
}

/** A saved overlay, or null when it can't be used. `oldKeys`: a file of version 1, whose `panel-` keys are not kept. */
function readOverlay(entry: unknown, oldKeys = false): GameOverlay | null {
  if (!isObject(entry)) return null;
  const { owner, moduleId, workspaceId, key } = entry;
  if (![owner, moduleId, workspaceId].every(validField)) return null;
  if (typeof key !== "string" || !OVERLAY_KEY.test(key) || (oldKeys && key.startsWith(RESERVED_KEY_PREFIX))) return null;
  const position = positionOf(entry);
  if (!position) return null;
  return { owner: owner as string, moduleId: moduleId as string, workspaceId: workspaceId as string, key, ...settingsOf(entry), ...position };
}

function readPanel(entry: unknown): InGamePanel | null {
  if (!isObject(entry)) return null;
  const { owner, moduleId, workspaceId, instanceId } = entry;
  if (![owner, moduleId, workspaceId].every(validField)) return null;
  if (typeof instanceId !== "string" || !INSTANCE_ID.test(instanceId)) return null;
  const position = positionOf(entry);
  if (!position) return null;
  return { owner: owner as string, moduleId: moduleId as string, workspaceId: workspaceId as string, instanceId, ...settingsOf(entry), ...position };
}

/** An item as a file of version 4 or before kept it: with its scope (one game's, or general), before setups. */
export type OldItem<T> = T & { scope: OverlayScope };

const copyItem = <T extends ItemSettings>(item: T): T => structuredClone(item);

/**
 * The move to setups (file version 5). General items (made in personal workspaces) go to All games. A game's own items
 * go to a new setup for that game, and so do copies of the general ones, so what shows over each game stays the same.
 * Customized per-game positions of the general items (`layout.games`) are not kept: the copies take the All games
 * place. A setup takes the game's own first, then the general ones, up to LIMITS.maxGameOverlays. Everywhere starts
 * empty, so nothing shows anywhere new.
 */
export function moveToSetups(overlays: readonly OldItem<GameOverlay>[], panels: readonly OldItem<InGamePanel>[]): Setup[] {
  const strip = <T extends { scope: OverlayScope }>({ scope: _scope, ...item }: T) => item;
  const general: Setup = { id: ALL_GAMES, overlays: [], panels: [] };
  for (const overlay of overlays) if (overlay.scope === "all") general.overlays.push(strip(overlay));
  for (const panel of panels) if (panel.scope === "all") general.panels.push(strip(panel));
  const games = new Map<string, Setup>();
  const setupOf = (gameId: string) => {
    let setup = games.get(gameId);
    if (!setup) games.set(gameId, (setup = { id: gameId, overlays: [], panels: [] }));
    return setup;
  };
  for (const overlay of overlays) if (overlay.scope === "game") setupOf(overlay.workspaceId).overlays.push(strip(overlay));
  for (const panel of panels) if (panel.scope === "game") setupOf(panel.workspaceId).panels.push(strip(panel));
  for (const setup of games.values()) {
    const room = () => LIMITS.maxGameOverlays - setup.overlays.length - setup.panels.length;
    for (const overlay of general.overlays) if (room() > 0) setup.overlays.push(copyItem(overlay));
    for (const panel of general.panels) if (room() > 0) setup.panels.push(copyItem(panel));
  }
  return [{ id: EVERYWHERE, overlays: [], panels: [] }, general, ...games.values()];
}

export class GameOverlayStore {
  /** The file was of version 1 (Tavora 0.21.0 and before): start() takes its old keys away, and the file is written as the current version. */
  migrated = false;
  /** The file was of version 4 or before: it was moved to setups and is written as the current version at start. */
  moved = false;
  /** The Overlay layout's grid, its window's place and the last window size seen per game. */
  private gridSetting: GridSetting = DEFAULT_GRID;
  private seen = new Map<string, SeenSize>();
  private readonly queue = new SerialQueue();
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Never write the file this session: it couldn't be backed up before the move to setups, so it stays as it was. */
  private readOnly = false;

  private constructor(
    private readonly file: string,
    private setupList: Setup[],
    private hintShown: boolean,
    /** Whether a workspace is a game workspace ("game") or a personal one ("all"), for the source rules. */
    private readonly scopeOf: (workspaceId: string) => OverlayScope,
  ) {}

  /**
   * Loads what was kept. A file of version 4 or before is moved to setups (moveToSetups), after a copy of it went to
   * backups/before-overlay-setups; `moved` says so, and the service writes the move once start() ran (until then, a
   * start that stops half way does the same move again from the same file). A file of version 1 (Tavora 0.21.0 and
   * before) also has no scope, so `scopeOf` tells it from the workspace's kind, and the permanent panels over the game
   * it may hold (keys behind RESERVED_KEY_PREFIX) are not kept; `migrated` says so. Positions of a file of version 2 or
   * 1 were fractions of the game window and stay so (`legacy`) until the game's real window is seen (convertLegacy). A
   * file of a higher version (a newer Tavora wrote it) is set aside, not read.
   */
  static async load(userData: string, scopeOf: (workspaceId: string) => OverlayScope = () => "game"): Promise<GameOverlayStore> {
    const file = path.join(userData, GAME_OVERLAYS_FILE);
    const read = await readJsonOrSetAside<Partial<GameOverlayFile>>(file);
    const newer = typeof read?.version === "number" && read.version > FILE_VERSION;
    // Written by a newer Tavora: kept for that one, and never written over.
    if (newer) await setAside(file);
    const raw = newer || !isObject(read) ? null : read;
    // A file moved to the workspace names keeps what version it was until it is written again.
    const version = raw?.version === 4 && (raw.formerVersion === 1 || raw.formerVersion === 2) ? raw.formerVersion : raw?.version;
    const old = raw !== null && raw.version !== FILE_VERSION;
    const migrated = old && version !== 2 && version !== 3 && version !== 4;
    const store = new GameOverlayStore(file, old ? GameOverlayStore.readOld(raw, scopeOf, migrated) : GameOverlayStore.readSetups(raw), raw?.exclusiveHintShown === true, scopeOf);
    store.migrated = migrated;
    store.moved = old;
    const layout = isObject(raw?.layout) ? raw.layout : {};
    if (isGridSetting(layout.grid)) store.gridSetting = layout.grid;
    for (const [gameId, size] of Object.entries(isObject(layout.seen) ? layout.seen : {}).slice(0, MAX_SEEN)) {
      const valid = validSize(size);
      if (valid && validField(gameId)) store.seen.set(gameId, valid);
    }
    if (old) {
      try {
        await keepCopy(path.join(backupsDir(userData), BEFORE_SETUPS_DIR), GAME_OVERLAYS_FILE, await readFile(file));
      } catch (error) {
        // Without the copy, the old file is not written over: this start works on the move in memory only.
        console.error("[tavora] backing up game overlays before the setups failed; the file is left as it was", error);
        store.readOnly = true;
      }
    }
    return store;
  }

  /** The setups of a file of version 5: Everywhere and All games always, a game's at most once; items it can't use are skipped. */
  private static readSetups(raw: Partial<GameOverlayFile> | null): Setup[] {
    const setups: Setup[] = [
      { id: EVERYWHERE, overlays: [], panels: [] },
      { id: ALL_GAMES, overlays: [], panels: [] },
    ];
    const seen = new Set<string>();
    for (const entry of Array.isArray(raw?.setups) ? raw.setups : []) {
      if (!isObject(entry) || !validField(entry.id) || seen.has(entry.id as string)) continue;
      const id = entry.id as string;
      seen.add(id);
      let setup = setups.find((item) => item.id === id);
      if (!setup) setups.push((setup = { id, overlays: [], panels: [] }));
      const target = setup;
      const full = () => target.overlays.length + target.panels.length >= LIMITS.maxGameOverlays;
      for (const item of Array.isArray(entry.overlays) ? entry.overlays : []) {
        const overlay = readOverlay(item);
        if (overlay && !full() && !target.overlays.some((other) => sameOverlay(other, overlay))) target.overlays.push(overlay);
      }
      for (const item of Array.isArray(entry.panels) ? entry.panels : []) {
        const panel = readPanel(item);
        if (panel && !full() && !target.panels.some((other) => other.instanceId === panel.instanceId)) target.panels.push(panel);
      }
    }
    return setups;
  }

  /** The items of a file of version 4 or before, moved to setups. It kept at most eight of a game's own and eight general ones. */
  private static readOld(raw: Partial<GameOverlayFile>, scopeOf: (workspaceId: string) => OverlayScope, migrated: boolean): Setup[] {
    const scoped = (entry: unknown, workspaceId: string): OverlayScope => {
      const scope = isObject(entry) ? entry.scope : undefined;
      return scope === "all" || scope === "game" ? scope : scopeOf(workspaceId);
    };
    const counts = new Map<string, number>();
    const fits = (item: { scope: OverlayScope; workspaceId: string }) => {
      const bucket = item.scope === "all" ? ALL_GAMES : item.workspaceId;
      const count = counts.get(bucket) ?? 0;
      if (count >= LIMITS.maxGameOverlays) return false;
      counts.set(bucket, count + 1);
      return true;
    };
    const overlays: OldItem<GameOverlay>[] = [];
    for (const entry of Array.isArray(raw.overlays) ? raw.overlays : []) {
      const overlay = readOverlay(entry, migrated);
      if (!overlay || overlays.some((other) => sameOverlay(other, overlay))) continue;
      const item = { ...overlay, scope: scoped(entry, overlay.workspaceId) };
      if (fits(item)) overlays.push(item);
    }
    const panels: OldItem<InGamePanel>[] = [];
    for (const entry of Array.isArray(raw.panels) ? raw.panels : []) {
      const panel = readPanel(entry);
      if (!panel || panels.some((other) => other.instanceId === panel.instanceId)) continue;
      const item = { ...panel, scope: scoped(entry, panel.workspaceId) };
      if (fits(item)) panels.push(item);
    }
    return moveToSetups(overlays, panels);
  }

  // ── Setups and their items ───────────────────────────────────────────

  /** Every setup's id: Everywhere, All games, then the games' in the order they were made. */
  setupIds(): string[] {
    return this.setupList.map((setup) => setup.id);
  }

  hasSetup(setupId: string): boolean {
    return this.setupList.some((setup) => setup.id === setupId);
  }

  /** The games that have a setup of their own. */
  gameSetups(): string[] {
    return this.setupIds().filter(isGameSetup);
  }

  private setup(setupId: string): Setup | undefined {
    return this.setupList.find((setup) => setup.id === setupId);
  }

  overlaysIn(setupId: string): readonly GameOverlay[] {
    return this.setup(setupId)?.overlays ?? [];
  }

  panelsIn(setupId: string): readonly InGamePanel[] {
    return this.setup(setupId)?.panels ?? [];
  }

  /** How many items a setup has; LIMITS.maxGameOverlays at most. */
  count(setupId: string): number {
    const setup = this.setup(setupId);
    return setup ? setup.overlays.length + setup.panels.length : 0;
  }

  /** Every overlay in every setup: one in several setups is here once for each. */
  all(): readonly GameOverlay[] {
    return this.setupList.flatMap((setup) => setup.overlays);
  }

  /** Every panel in every setup, the same way. */
  panels(): readonly InGamePanel[] {
    return this.setupList.flatMap((setup) => setup.panels);
  }

  /** Whether no setup has anything. */
  get empty(): boolean {
    return this.setupList.every((setup) => setup.overlays.length === 0 && setup.panels.length === 0);
  }

  /** The setups an item is in. */
  setupsWith(ref: ItemRef): string[] {
    return this.setupList
      .filter((setup) => (ref.kind === "panel" ? setup.panels.some((panel) => panel.instanceId === ref.instanceId) : setup.overlays.some((overlay) => sameOverlay(overlay, ref.subject))))
      .map((setup) => setup.id);
  }

  /** The overlay as one setup has it, or (without a setup) as the first setup that has it does. */
  find(subject: GameOverlaySubject, setupId?: string): GameOverlay | undefined {
    const list = setupId === undefined ? this.all() : this.overlaysIn(setupId);
    return list.find((overlay) => sameOverlay(overlay, subject));
  }

  panelOf(instanceId: string, setupId?: string): InGamePanel | undefined {
    const list = setupId === undefined ? this.panels() : this.panelsIn(setupId);
    return list.find((panel) => panel.instanceId === instanceId);
  }

  /** Where a new item of a setup starts: below the others, so a second one doesn't hide the first. */
  private startRect(first: AnchoredRect, setupId: string): AnchoredRect {
    const row = this.count(setupId) % 4;
    return { ...first, y: Math.min(first.y + row * (first.height + 0.02), 1 - first.height) };
  }

  /**
   * Makes a game's setup; false when it has one. It starts with copies of what All games has (leaving `room` places
   * free for the item it is made for), so what shows over the game stays the same once it has a setup of its own.
   */
  addSetup(gameId: string, room = 0): boolean {
    if (!isGameSetup(gameId) || !validField(gameId) || this.hasSetup(gameId)) return false;
    const setup: Setup = { id: gameId, overlays: [], panels: [] };
    const general = this.setup(ALL_GAMES)!;
    const free = () => LIMITS.maxGameOverlays - room - setup.overlays.length - setup.panels.length;
    for (const overlay of general.overlays) if (free() > 0 && allowedIn(gameId, overlay.workspaceId, this.scopeOf(overlay.workspaceId))) setup.overlays.push(copyItem(overlay));
    for (const panel of general.panels) if (free() > 0 && allowedIn(gameId, panel.workspaceId, this.scopeOf(panel.workspaceId))) setup.panels.push(copyItem(panel));
    this.setupList.push(setup);
    this.saveSoon();
    return true;
  }

  /** A game's setup goes with what it holds (the workspace left the library); false when it had none. Everywhere and All games stay. */
  removeSetup(gameId: string): boolean {
    if (!isGameSetup(gameId) || !this.hasSetup(gameId)) return false;
    this.setupList = this.setupList.filter((setup) => setup.id !== gameId);
    this.saveSoon();
    return true;
  }

  /** The setup to add to, made first when it is a game's that has none; null when the item may not go there. */
  private target(setupId: string, workspaceId: string): Setup | null {
    if (!allowedIn(setupId, workspaceId, this.scopeOf(workspaceId))) return null;
    if (isGameSetup(setupId)) this.addSetup(setupId, 1);
    return this.setup(setupId) ?? null;
  }

  /** Adds an overlay to a setup with the usual settings, in the corner of its area; a setup may have LIMITS.maxGameOverlays items. */
  add(setupId: string, subject: GameOverlaySubject, first: AnchoredRect = DEFAULT_RECT): AddResult {
    const setup = this.target(setupId, subject.workspaceId);
    if (!setup) return "refused";
    if (setup.overlays.some((overlay) => sameOverlay(overlay, subject))) return "exists";
    if (this.count(setupId) >= LIMITS.maxGameOverlays) return "full";
    setup.overlays.push({ ...subject, mode: "always", opacity: 100, hideFromCapture: false, rect: this.startRect(first, setupId) });
    this.saveSoon();
    return "added";
  }

  /** Adds a panel to a setup; it counts toward the same limit as overlays. */
  addPanel(setupId: string, panel: Pick<InGamePanel, "owner" | "moduleId" | "workspaceId" | "instanceId">, first: AnchoredRect = DEFAULT_PANEL_ANCHORED): AddResult {
    const setup = this.target(setupId, panel.workspaceId);
    if (!setup) return "refused";
    if (setup.panels.some((other) => other.instanceId === panel.instanceId)) return "exists";
    if (this.count(setupId) >= LIMITS.maxGameOverlays) return "full";
    const { owner, moduleId, workspaceId, instanceId } = panel;
    setup.panels.push({ owner, moduleId, workspaceId, instanceId, rect: this.startRect(first, setupId), mode: "always", opacity: 100, hideFromCapture: false });
    this.saveSoon();
    return "added";
  }

  /**
   * Moves an item from one setup to another with its place and settings (Everywhere and All games, for items of a
   * personal workspace). "exists": it is in the other setup already, which keeps its own, and it leaves this one.
   */
  moveItem(ref: ItemRef, from: string, to: string): AddResult | "missing" {
    const source = this.setup(from);
    const workspaceId = ref.kind === "panel" ? this.panelOf(ref.instanceId, from)?.workspaceId : this.find(ref.subject, from)?.workspaceId;
    if (!source || workspaceId === undefined) return "missing";
    const setup = this.target(to, workspaceId);
    if (!setup || from === to) return "refused";
    if (ref.kind === "panel") {
      const panel = source.panels.find((item) => item.instanceId === ref.instanceId)!;
      const there = setup.panels.some((item) => item.instanceId === ref.instanceId);
      if (!there && this.count(to) >= LIMITS.maxGameOverlays) return "full";
      if (!there) setup.panels.push(copyItem(panel));
      source.panels = source.panels.filter((item) => item !== panel);
      this.saveSoon();
      return there ? "exists" : "added";
    }
    const overlay = source.overlays.find((item) => sameOverlay(item, ref.subject))!;
    const there = setup.overlays.some((item) => sameOverlay(item, ref.subject));
    if (!there && this.count(to) >= LIMITS.maxGameOverlays) return "full";
    if (!there) setup.overlays.push(copyItem(overlay));
    source.overlays = source.overlays.filter((item) => item !== overlay);
    this.saveSoon();
    return there ? "exists" : "added";
  }

  /**
   * Copies the items of one setup into a game's setup (the Overlay page's Copy to…), with their place and settings:
   * `replace` puts them where the game's own were, `add` puts them after those. An item that may not go there (a game
   * workspace's into another game, a panel that can't show over a game, `canShow` says), one the game's setup has
   * already (`add`) or one that does not fit the limit is left out and listed in `skipped`. A `replace` that has
   * nothing to put in changes nothing, so it never empties a setup. The game gets a setup of its own only when
   * something goes into it. Null when there is nothing to copy from or the target is not a game.
   */
  copySetup(from: string, to: string, mode: "replace" | "add", canShow: (item: GameOverlay | InGamePanel) => boolean): CopyOutcome | null {
    const source = this.setup(from);
    if (!source || !isGameSetup(to) || !validField(to) || from === to) return null;
    const skipped: CopyOutcome["skipped"] = [];
    const usable = <T extends GameOverlay | InGamePanel>(items: readonly T[]) =>
      items.filter((item) => {
        const reason = !allowedIn(to, item.workspaceId, this.scopeOf(item.workspaceId)) ? "game-only" : !canShow(item) ? "not-in-game" : null;
        if (reason) skipped.push({ reason, workspaceId: item.workspaceId });
        return reason === null;
      });
    const overlays = usable(source.overlays);
    const panels = usable(source.panels);
    const removed: CopyOutcome["removed"] = { overlays: [], panels: [] };
    if (overlays.length + panels.length === 0) return { copied: 0, skipped, removed };
    let target = this.setup(to);
    if (!target) this.setupList.push((target = { id: to, overlays: [], panels: [] }));
    if (mode === "replace") {
      removed.overlays = target.overlays;
      removed.panels = target.panels;
      target.overlays = [];
      target.panels = [];
    }
    const room = () => LIMITS.maxGameOverlays - target.overlays.length - target.panels.length;
    let copied = 0;
    const put = (item: GameOverlay | InGamePanel, there: boolean, push: () => void) => {
      if (there) skipped.push({ reason: "exists", workspaceId: item.workspaceId });
      else if (room() <= 0) skipped.push({ reason: "full", workspaceId: item.workspaceId });
      else {
        push();
        copied++;
      }
    };
    for (const overlay of overlays) put(overlay, target.overlays.some((other) => sameOverlay(other, overlay)), () => target.overlays.push(copyItem(overlay)));
    for (const panel of panels) put(panel, target.panels.some((other) => other.instanceId === panel.instanceId), () => target.panels.push(copyItem(panel)));
    this.saveSoon();
    return { copied, skipped, removed };
  }

  /** The items a change is for: the one of `setupId`, or without one, the item in every setup that has it. */
  private targets<T>(list: (setupId: string) => readonly T[], match: (item: T) => boolean, setupId?: string): T[] {
    const ids = setupId === undefined ? this.setupIds() : [setupId];
    return ids.flatMap((id) => list(id).filter(match));
  }

  /** Changes what the user set for an overlay (in one setup, or in all that have it); false when there is no such overlay. */
  update(subject: GameOverlaySubject, change: GameOverlayChange, setupId?: string): boolean {
    const overlays = this.targets((id) => this.overlaysIn(id), (overlay) => sameOverlay(overlay, subject), setupId);
    if (overlays.length === 0) return false;
    const rect = change.rect ? normalizeAnchored(change.rect) : null;
    for (const overlay of overlays) {
      applySettings(overlay, change);
      if (rect) {
        overlay.rect = { ...rect };
        delete overlay.legacy;
      }
    }
    this.saveSoon();
    return true;
  }

  /** Changes the live view's settings of a panel (in one setup, or in all that have it); false when no setup has the panel. */
  updatePanelView(instanceId: string, change: InGamePanelChange, setupId?: string): boolean {
    const panels = this.targets((id) => this.panelsIn(id), (panel) => panel.instanceId === instanceId, setupId);
    if (panels.length === 0) return false;
    for (const panel of panels) applySettings(panel, change);
    this.saveSoon();
    return true;
  }

  /** Puts the position of an item in one setup to `rect` (a move in the layer or on the canvas, Reset position); false when the setup hasn't it. */
  setRect(setupId: string, ref: ItemRef, rect: AnchoredRect): boolean {
    const target = ref.kind === "panel" ? this.panelOf(ref.instanceId, setupId) : this.find(ref.subject, setupId);
    const next = normalizeAnchored(rect);
    if (!target || !next) return false;
    target.rect = next;
    delete target.legacy;
    this.saveSoon();
    return true;
  }

  /** The item as one setup has it (a copy) and its place in the setup's list, or null when the setup hasn't it. */
  itemIn(setupId: string, ref: ItemRef): { item: GameOverlay | InGamePanel; index: number } | null {
    const list: readonly (GameOverlay | InGamePanel)[] = ref.kind === "panel" ? this.panelsIn(setupId) : this.overlaysIn(setupId);
    const index = ref.kind === "panel" ? this.panelsIn(setupId).findIndex((panel) => panel.instanceId === ref.instanceId) : this.overlaysIn(setupId).findIndex((overlay) => sameOverlay(overlay, ref.subject));
    return index < 0 ? null : { item: copyItem(list[index]!), index };
  }

  /**
   * Puts an item back into a setup exactly as it was (undo on the Overlay page), at its place in the setup's list; the same
   * rules as adding one: it must be allowed there, and the setup must have room.
   */
  restore(setupId: string, item: GameOverlay | InGamePanel, kind: ItemRef["kind"], index: number): AddResult {
    const setup = this.target(setupId, item.workspaceId);
    if (!setup) return "refused";
    const there = kind === "panel" ? setup.panels.some((panel) => panel.instanceId === (item as InGamePanel).instanceId) : setup.overlays.some((overlay) => sameOverlay(overlay, item as GameOverlay));
    if (there) return "exists";
    if (this.count(setupId) >= LIMITS.maxGameOverlays) return "full";
    const rect = normalizeAnchored(item.rect);
    if (!rect) return "refused";
    const copy = { ...copyItem(item), rect };
    if (kind === "panel") setup.panels.splice(Math.max(0, Math.min(index, setup.panels.length)), 0, copy as InGamePanel);
    else setup.overlays.splice(Math.max(0, Math.min(index, setup.overlays.length)), 0, copy as GameOverlay);
    this.saveSoon();
    return "added";
  }

  /** Makes an item of a setup what `item` says: its settings and its place, a legacy one too (undo on the Overlay page). False when the setup hasn't it. */
  replace(setupId: string, ref: ItemRef, item: ItemSettings): boolean {
    const target = ref.kind === "panel" ? this.panelOf(ref.instanceId, setupId) : this.find(ref.subject, setupId);
    const rect = normalizeAnchored(item.rect);
    if (!target || !rect) return false;
    applySettings(target, item);
    target.rect = rect;
    if (item.legacy) target.legacy = { ...item.legacy };
    else delete target.legacy;
    this.saveSoon();
    return true;
  }

  /** Removes the overlays matching `test` from their setups (the user's remove, a deleted workspace, a module that is gone); whether any went. */
  forget(test: (overlay: GameOverlay, setupId: string) => boolean): boolean {
    let any = false;
    for (const setup of this.setupList) {
      const kept = setup.overlays.filter((overlay) => !test(overlay, setup.id));
      if (kept.length === setup.overlays.length) continue;
      setup.overlays = kept;
      any = true;
    }
    if (any) this.saveSoon();
    return any;
  }

  /** The same for panels. */
  forgetPanels(test: (panel: InGamePanel, setupId: string) => boolean): boolean {
    let any = false;
    for (const setup of this.setupList) {
      const kept = setup.panels.filter((panel) => !test(panel, setup.id));
      if (kept.length === setup.panels.length) continue;
      setup.panels = kept;
      any = true;
    }
    if (any) this.saveSoon();
    return any;
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

  /**
   * The game's real window was seen: the positions still kept as fractions of the window, in the setup that shows over
   * it, are converted for this size, so each stays on the very same pixels. Whether any was.
   */
  convertLegacy(gameId: string, size: { width: number; height: number }): boolean {
    if (!isRealWindow(size)) return false;
    const setup = this.setup(gameSetupFor(gameId, (id) => this.hasSetup(id)));
    let any = false;
    for (const item of [...(setup?.overlays ?? []), ...(setup?.panels ?? [])]) {
      if (!item.legacy) continue;
      item.rect = migrateLegacy(item.legacy, size);
      delete item.legacy;
      any = true;
    }
    if (any) this.saveSoon();
    return any;
  }

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY_MS);
  }

  /** Writes game-overlays.json now; also called on quit so the last change is not lost. */
  save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.readOnly) return Promise.resolve();
    const stored = ({ rect, legacy }: Pick<ItemSettings, "rect" | "legacy">): StoredPosition => (legacy ? { rect: legacy } : { anchor: rect });
    const body: GameOverlayFile = {
      version: FILE_VERSION,
      exclusiveHintShown: this.hintShown,
      layout: { grid: this.gridSetting, seen: Object.fromEntries(this.seen) },
      setups: this.setupList.map((setup) => ({
        id: setup.id,
        overlays: setup.overlays.map(({ rect, legacy, ...item }) => ({ ...item, ...stored({ rect, ...(legacy ? { legacy } : {}) }) })),
        panels: setup.panels.map(({ rect, legacy, ...item }) => ({ ...item, ...stored({ rect, ...(legacy ? { legacy } : {}) }) })),
      })),
    };
    const text = `${JSON.stringify(body, null, 2)}\n`;
    return this.queue.run(() => writeFileAtomic(this.file, text)).catch((error: unknown) => console.error("[tavora] saving game overlays failed", error));
  }
}

/** Sets what a change has that is valid: the mode, an opacity Tavora offers, Hide from capture. */
function applySettings(item: ItemSettings, change: InGamePanelChange): void {
  if (change.mode === "always" || change.mode === "toggle") item.mode = change.mode;
  if (change.opacity !== undefined && OPACITIES.includes(change.opacity)) item.opacity = change.opacity;
  if (change.hideFromCapture !== undefined) item.hideFromCapture = change.hideFromCapture === true;
}
