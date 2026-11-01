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
  /** The other setups this item may be moved to (Move to…): a personal workspace's item any of them, a game's own only that game's. */
  moveTargets: { id: string; name: string }[];
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
  /** Live, but its page has been given nothing to show: "stopped" when its panel isn't running, "empty" when it runs and shows nothing now. */
  idle: "stopped" | "empty" | null;
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

/** One thing a panel listed with overlay.setSources, a row under the panel in the Sources. */
export interface LayoutSourceChild {
  /** The overlay key it shows from. */
  key: string;
  /** The item's name, or the line a group shows. */
  name: string;
  /** A group of linked things shown as one line. */
  group: boolean;
  /** The item of the setup it is, else null. */
  item: string | null;
  /** Why it can't go into the setup shown (null: it can; "in-setup": it is there). */
  block: SourceBlock | null;
}

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
  /**
   * What the panel can show on its own, in the module's order (overlay.setSources); null when it never said. A panel with a
   * list is a header only: its things are added one by one, the panel as a whole is not.
   */
  children: LayoutSourceChild[] | null;
}

export interface LayoutView {
  /** The overlay setups: Everywhere, All games, then the games that have one, in name order. */
  games: { id: string; name: string }[];
  /** Every panel from every workspace. */
  sources: LayoutSourceView[];
  /** The games Copy to… lists: every game workspace but the setup shown, with the frames its own setup has (0 when it has none). */
  copyTargets: { id: string; name: string; frames: number }[];
  /** Items one setup may hold. */
  limit: number;
  /** The setup shown. */
  gameId: string;
  /** Canvas units: 1080 high, as wide as the game window's shape. */
  canvas: Canvas;
  /** Whether the game window's size was seen; false means the shape of the main screen is used. */
  seen: boolean;
  /** "Preview as": the shape the canvas is shown in. Only a preview: saved positions are anchored and never change with it. */
  preview: { choice: string; options: { id: string; label: string }[] };
  grid: GridSetting;
  /** One grid cell in canvas units (0 with the grid off). */
  cell: number;
  /** The smallest size an item can have, in canvas units. */
  minSize: number;
  /** The selected item while exactly one is selected, else null. */
  selection: string | null;
  /** Every selected item, in the order they were picked (several: Ctrl or Shift and a click, or a box drawn on the canvas). */
  selected: string[];
  items: LayoutItemView[];
  /** The setup's picture (a Tavora-internal address), or null. Any setup can have one: a game's, or Everywhere's and All games'. */
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
  /** What the last Copy to… did, with the game it went to (the note offers to show it); null when there is no such note. */
  copied: { gameId: string; text: string } | null;
}

/** Where one frame is on the canvas, in canvas units. */
export interface PlacedRect {
  id: string;
  rect: Rect;
}

/** What the Settings box sets on the selected frames (each one in the setup shown). */
export interface LayoutItemChange {
  mode?: "always" | "toggle";
  opacity?: 100 | 75 | 50 | 25;
  hideFromCapture?: boolean;
}

/** A message about one item (`id`) or several (`ids`, one undo step for all). */
type OneOrMany<T extends string> = { type: T; id: string } | { type: T; ids: string[] };

export type LayoutMessage =
  | { type: "game"; gameId: string }
  /** A panel from the Sources goes into the setup shown. */
  /** `key`: the thing of the panel to add (one of its `children`); without it, the panel as a whole (only one that listed nothing). */
  | { type: "add-source"; id: string; key?: string }
  /** Move to…: the item goes to another setup with its place and settings. */
  | { type: "move"; id: string; to: string }
  | { type: "grid"; grid: GridSetting }
  /** Preview the canvas in another shape (one of `preview.options`), for this setup. */
  | { type: "preview"; choice: string }
  /** Copy the frames of the setup shown into a game's setup: `replace` puts them where its own were, `add` after them. */
  | { type: "copy-setup"; to: string; mode: "replace" | "add" }
  /** One item selected (null: none), or exactly these. */
  | { type: "select"; id: string | null }
  | { type: "select"; ids: string[] }
  /** The canvas area in the window (shell only), in DIPs from the window's top left; null while it can't be drawn. */
  | { type: "bounds"; bounds: Rect | null }
  /** A list or menu is open over the canvas, so the live pages step aside (shell only). */
  | { type: "cover"; covered: boolean }
  /** Items are being dragged: where they are now, in canvas units. */
  | { type: "drag"; id: string; rect: Rect }
  | { type: "drag"; rects: PlacedRect[] }
  /** The drag stopped without a drop (pointer lost, focus lost, page loaded again): nothing was moved. */
  | { type: "drag-end" }
  /** Items were dropped (or nudged): where they are, in canvas units. Several move as one undo step, each keeping its anchors. */
  | { type: "commit"; id: string; rect: Rect }
  | { type: "commit"; rects: PlacedRect[] }
  | { type: "undo" }
  | { type: "redo" }
  | ({ hidden: boolean } & OneOrMany<"canvas-hidden">)
  /** Reset position: back to where a new item starts, at the size it has. */
  | OneOrMany<"reset">
  /** Reset size: back to the size a new item gets, where it is. */
  | OneOrMany<"reset-size">
  /** Del on the canvas and the toolbar's Remove: the items leave the setup shown, as Remove in their settings does. */
  | OneOrMany<"remove">
  /** The Settings box: Show, Opacity and Hide from capture for the selected items, as one undo step. */
  | { type: "set"; ids: string[]; change: LayoutItemChange }
  /** The toolbar's Settings: the settings of what the item shows (its panel, until a module can be asked for more). */
  | { type: "settings"; id: string }
  /** Back to the workspace. */
  | { type: "done" }
  | { type: "take-picture" }
  | { type: "choose-picture" }
  | { type: "remove-picture" }
  | { type: "dismiss-notice" };

/** The ids a message is about: its `ids`, or its one `id`. */
export const idsOf = (message: { id: string } | { ids: string[] }): string[] => ("ids" in message ? message.ids : [message.id]);

/** The rectangles a drag or a drop is about. */
export const rectsOf = (message: { id: string; rect: Rect } | { rects: PlacedRect[] }): PlacedRect[] => ("rects" in message ? message.rects : [{ id: message.id, rect: message.rect }]);

/** The most ids one message may name. */
const MAX_IDS = 64;

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

/** A list of item ids, or null. */
function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_IDS || !value.every((id) => text(id))) return null;
  return [...new Set(value as string[])];
}

/** One `id` or a list of `ids`, as the message has it; null when it has neither. */
function oneOrMany(raw: Record<string, unknown>): { id: string } | { ids: string[] } | null {
  if (raw.ids !== undefined) {
    const ids = parseIds(raw.ids);
    return ids ? { ids } : null;
  }
  return text(raw.id) ? { id: raw.id } : null;
}

function parseChange(value: unknown): LayoutItemChange | null {
  if (!isObject(value)) return null;
  const change: LayoutItemChange = {};
  if (value.mode !== undefined) {
    if (value.mode !== "always" && value.mode !== "toggle") return null;
    change.mode = value.mode;
  }
  if (value.opacity !== undefined) {
    if (value.opacity !== 100 && value.opacity !== 75 && value.opacity !== 50 && value.opacity !== 25) return null;
    change.opacity = value.opacity;
  }
  if (value.hideFromCapture !== undefined) {
    if (typeof value.hideFromCapture !== "boolean") return null;
    change.hideFromCapture = value.hideFromCapture;
  }
  return Object.keys(change).length ? change : null;
}

/** What a renderer sent, or null when it is not a message the layout knows. */
export function parseLayoutMessage(raw: unknown): LayoutMessage | null {
  if (!isObject(raw) || typeof raw.type !== "string") return null;
  switch (raw.type) {
    case "game":
      return text(raw.gameId, 128) ? { type: "game", gameId: raw.gameId } : null;
    case "add-source":
      if (!text(raw.id)) return null;
      if (raw.key === undefined) return { type: "add-source", id: raw.id };
      return text(raw.key, 64) ? { type: "add-source", id: raw.id, key: raw.key } : null;
    case "move":
      return text(raw.id) && text(raw.to, 128) ? { type: "move", id: raw.id, to: raw.to } : null;
    case "grid":
      return isGridSetting(raw.grid) ? { type: "grid", grid: raw.grid } : null;
    case "preview":
      return text(raw.choice, 64) ? { type: "preview", choice: raw.choice } : null;
    case "copy-setup":
      return text(raw.to, 128) && (raw.mode === "replace" || raw.mode === "add") ? { type: "copy-setup", to: raw.to, mode: raw.mode } : null;
    case "select": {
      if (raw.ids !== undefined) {
        const ids = parseIds(raw.ids);
        return ids ? { type: "select", ids } : null;
      }
      return raw.id === null ? { type: "select", id: null } : text(raw.id) ? { type: "select", id: raw.id } : null;
    }
    case "bounds": {
      if (raw.bounds === null) return { type: "bounds", bounds: null };
      const bounds = parseRect(raw.bounds);
      return bounds ? { type: "bounds", bounds } : null;
    }
    case "cover":
      return typeof raw.covered === "boolean" ? { type: "cover", covered: raw.covered } : null;
    case "drag":
    case "commit": {
      if (raw.rects !== undefined) {
        if (!Array.isArray(raw.rects) || raw.rects.length === 0 || raw.rects.length > MAX_IDS) return null;
        const rects: PlacedRect[] = [];
        for (const entry of raw.rects) {
          const rect = isObject(entry) ? parseRect(entry.rect) : null;
          if (!rect || !isObject(entry) || !text(entry.id) || rects.some((other) => other.id === entry.id)) return null;
          rects.push({ id: entry.id, rect });
        }
        return { type: raw.type as "drag" | "commit", rects } as LayoutMessage;
      }
      const rect = parseRect(raw.rect);
      return text(raw.id) && rect ? ({ type: raw.type as "drag" | "commit", id: raw.id, rect } as LayoutMessage) : null;
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
    case "canvas-hidden": {
      const target = oneOrMany(raw);
      return target && typeof raw.hidden === "boolean" ? { type: "canvas-hidden", hidden: raw.hidden, ...target } : null;
    }
    case "reset":
    case "reset-size":
    case "remove": {
      const target = oneOrMany(raw);
      return target ? ({ type: raw.type as "remove" | "reset" | "reset-size", ...target } as LayoutMessage) : null;
    }
    case "set": {
      const ids = parseIds(raw.ids);
      const change = parseChange(raw.change);
      return ids && change ? { type: "set", ids, change } : null;
    }
    case "settings":
      return text(raw.id) ? { type: "settings", id: raw.id } : null;
    default:
      return null;
  }
}

/** The labels of the grid menu, in order. */
export const GRID_CHOICES = GRID_SETTINGS;
