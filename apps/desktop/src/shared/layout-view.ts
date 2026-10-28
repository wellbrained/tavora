// What the Overlay page shows and what it may ask the main process to do. The page is two pieces of Tavora's own (the
// page in the main window with the sidebar and the toolbar, and the layer on the canvas that takes the mouse); both get
// the same LayoutView and answer with LayoutMessages, which the main process checks (parseLayoutMessage) before it acts.
import { GRID_SETTINGS, isGridSetting, type Canvas, type GridSetting } from "./layout-math";
import type { AnchoredRect, Rect } from "./overlay-anchor";

/** The picker entries of the All games and Everywhere setups (the others are games, by their workspace id). */
export const LAYOUT_ALL_GAMES = "$all";
export const LAYOUT_EVERYWHERE = "$everywhere";

/** What an item's actions are aimed at: an overlay (by its subject) or a panel in game (by its id). */
export type LayoutTarget =
  | { kind: "overlay"; owner: string; moduleId: string; workspaceId: string; key: string }
  | { kind: "panel"; instanceId: string };

export interface LayoutItemView {
  /** Stable text for the item, to select it and to name it in messages. */
  id: string;
  target: LayoutTarget;
  /** What the hotkey dialog is asked with (the key of the item). */
  keyTarget: { owner: string; moduleId: string; workspaceId: string; key: string };
  /** The module's name with the key, or the panel's name. */
  name: string;
  /** The workspace it comes from ("Notes · Satisfactory" is the name and this). */
  from: string;
  moduleId: string;
  kind: "overlay" | "panel";
  /** A personal workspace's item can move between Everywhere and All games: the setup it can move to, else null. */
  moveTo: "$everywhere" | "$all" | null;
  /** The position as saved: an anchor and offsets and a size in units of the game window's height. */
  rect: AnchoredRect;
  /** Where it sits on the canvas, in canvas units (1080 high). */
  placed: Rect;
  mode: "always" | "toggle";
  opacity: 100 | 75 | 50 | 25;
  hideFromCapture: boolean;
  hotkey: { accelerator: string; taken: boolean } | null;
  /** Its page is drawn live on the canvas; without, the canvas shows a box with the name. */
  live: boolean;
  /** Live, but its page has been given nothing to show (its panel isn't running, or shows nothing now). */
  idle: boolean;
  /** Toggle mode and not switched on right now: shown faded. */
  off: boolean;
  /** The eye in the list: hidden on the canvas only, kept over the game. */
  hiddenOnCanvas: boolean;
}

/**
 * Still pictures of the live pages and of the layer, in window pixels, while a list or menu is open over the canvas:
 * the shell draws them where the native views are, then the views step aside, so nothing on the canvas changes.
 */
export interface LayoutStills {
  items: { id: string; bounds: Rect; url: string }[];
  layer: { bounds: Rect; url: string } | null;
}

/** Why a source can't be added to the setup shown (null: it can). */
export type SourceBlock = "in-setup" | "game-only" | "not-in-game" | "full";

/** One panel of some workspace, listed in the Sources. */
export interface LayoutSourceView {
  /** The panel's instance id. */
  id: string;
  name: string;
  moduleId: string;
  /** The workspace it is in. */
  from: string;
  /** For a game workspace's panel, that game's name (it can only go into that game's setup). */
  game: string | null;
  block: SourceBlock | null;
}

export interface LayoutView {
  /** The overlay setups: Everywhere, All games, then the games that have one, in name order. */
  games: { id: string; name: string }[];
  /** Every panel from every workspace. */
  sources: LayoutSourceView[];
  /** Items one setup may hold. */
  limit: number;
  /** The setup shown. */
  gameId: string;
  /** Canvas units: 1080 high, as wide as the game window's shape. */
  canvas: Canvas;
  /** Whether the game window's size was seen; false means the shape of the main screen is used. */
  seen: boolean;
  grid: GridSetting;
  /** One grid cell in canvas units (0 with the grid off). */
  cell: number;
  /** The smallest size an item can have, in canvas units. */
  minSize: number;
  selection: string | null;
  items: LayoutItemView[];
  /** The game's picture (a Tavora-internal address), or null. */
  picture: string | null;
  /** The game is running and Tavora has seen its window, so a picture can be taken. */
  canTakePicture: boolean;
  /** Why Take picture is off: the game is not running ("start"), or it runs but its window was not seen yet ("switch"); null when it can be taken. */
  pictureHint: "start" | "switch" | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Game overlays are off in Settings: the layout still works, but nothing shows over the game. */
  enabled: boolean;
  /** A short sentence for the user (the game isn't running, a picture can't be used); null when there is none. */
  notice: string | null;
}

export type LayoutMessage =
  | { type: "game"; gameId: string }
  /** Add overlay for a game workspace (the dropdown), and show it. */
  /** A panel from the Sources goes into the setup shown. */
  | { type: "add-source"; id: string }
  /** A personal item moves to the other of Everywhere and All games. */
  | { type: "move"; id: string }
  | { type: "grid"; grid: GridSetting }
  | { type: "select"; id: string | null }
  /** The canvas area in the window (shell only), in DIPs from the window's top left; null while it can't be drawn. */
  | { type: "bounds"; bounds: Rect | null }
  /** A list or menu is open over the canvas, so the live pages step aside (shell only). */
  | { type: "cover"; covered: boolean }
  /** An item is being dragged: where it is now, in canvas units. */
  | { type: "drag"; id: string; rect: Rect }
  /** The drag stopped without a drop (pointer lost, focus lost, page loaded again): nothing was moved. */
  | { type: "drag-end" }
  /** An item was dropped (or nudged): where it is, in canvas units. */
  | { type: "commit"; id: string; rect: Rect }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "canvas-hidden"; id: string; hidden: boolean }
  /** Reset position: back to where a new item starts, at the size it has. */
  | { type: "reset"; id: string }
  /** Reset size: back to the size a new item gets, where it is. */
  | { type: "reset-size"; id: string }
  /** Back to the workspace. */
  | { type: "done" }
  | { type: "take-picture" }
  | { type: "choose-picture" }
  | { type: "remove-picture" }
  | { type: "dismiss-notice" };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 300): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const coordinate = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 100_000;

/** A rectangle with plain numbers, or null. */
export function parseRect(value: unknown): Rect | null {
  if (!isObject(value)) return null;
  const { x, y, width, height } = value;
  if (!coordinate(x) || !coordinate(y) || !coordinate(width) || !coordinate(height) || width < 0 || height < 0) return null;
  return { x, y, width, height };
}

/** What a renderer sent, or null when it is not a message the layout knows. */
export function parseLayoutMessage(raw: unknown): LayoutMessage | null {
  if (!isObject(raw) || typeof raw.type !== "string") return null;
  switch (raw.type) {
    case "game":
      return text(raw.gameId, 128) ? { type: "game", gameId: raw.gameId } : null;
    case "add-source":
    case "move":
      return text(raw.id) ? { type: raw.type, id: raw.id } : null;
    case "grid":
      return isGridSetting(raw.grid) ? { type: "grid", grid: raw.grid } : null;
    case "select":
      return raw.id === null ? { type: "select", id: null } : text(raw.id) ? { type: "select", id: raw.id } : null;
    case "bounds": {
      if (raw.bounds === null) return { type: "bounds", bounds: null };
      const bounds = parseRect(raw.bounds);
      return bounds ? { type: "bounds", bounds } : null;
    }
    case "cover":
      return typeof raw.covered === "boolean" ? { type: "cover", covered: raw.covered } : null;
    case "drag":
    case "commit": {
      const rect = parseRect(raw.rect);
      return text(raw.id) && rect ? { type: raw.type, id: raw.id, rect } : null;
    }
    case "undo":
    case "redo":
    case "drag-end":
    case "take-picture":
    case "choose-picture":
    case "remove-picture":
    case "dismiss-notice":
    case "done":
      return { type: raw.type };
    case "canvas-hidden":
      return text(raw.id) && typeof raw.hidden === "boolean" ? { type: "canvas-hidden", id: raw.id, hidden: raw.hidden } : null;
    case "reset":
    case "reset-size":
      return text(raw.id) ? { type: raw.type, id: raw.id } : null;
    default:
      return null;
  }
}

/** The labels of the grid menu, in order. */
export const GRID_CHOICES = GRID_SETTINGS;
