// What a frame's toolbar can hold and how the right-click menu on a frame decides what it shows. Every menu row that can be
// a button has an id here; the user pins the ones they want in the toolbar (one setting, not per frame), and the main
// process keeps it with the rest of the Overlay page's preferences.
import type { ArrangeTo } from "./layout-stack";
import type { AlignEdge } from "./layout-math";

/** Every action a frame's menu can run, including the rows inside its Arrange and Align on screen submenus. */
export const FRAME_ACTIONS = [
  "settings",
  "copy",
  "arrange",
  "front",
  "forward",
  "backward",
  "back",
  "align",
  "align-left",
  "align-center",
  "align-right",
  "align-top",
  "align-middle",
  "align-bottom",
  "lock",
  "hide",
  "reset",
  "reset-size",
  "remove",
] as const;
export type FrameActionId = (typeof FRAME_ACTIONS)[number];

/** The menu rows that can be a toolbar button (Customize toolbar… lists them), in menu order. Remove is last. */
export const TOOLBAR_ACTIONS = ["settings", "copy", "arrange", "align", "lock", "hide", "reset", "reset-size", "remove"] as const satisfies readonly FrameActionId[];
export type ToolbarActionId = (typeof TOOLBAR_ACTIONS)[number];

/** The rows that open a submenu: as a button they carry a small arrow that opens the same submenu. */
export const GROUP_ACTIONS = ["copy", "arrange", "align"] as const satisfies readonly ToolbarActionId[];
export const isGroupAction = (id: string): id is (typeof GROUP_ACTIONS)[number] => (GROUP_ACTIONS as readonly string[]).includes(id);

/** The toolbar as it was before the menu: Settings, Hide on canvas, Reset position, Reset size | Remove. */
export const DEFAULT_PINS: readonly ToolbarActionId[] = ["settings", "hide", "reset", "reset-size", "remove"];

/** The user's choice: whether the toolbar shows at all, and which actions are in it. */
export interface ToolbarSetting {
  show: boolean;
  pins: ToolbarActionId[];
}

export const DEFAULT_TOOLBAR: ToolbarSetting = { show: true, pins: [...DEFAULT_PINS] };

export const ARRANGE_ACTIONS = { front: "front", forward: "forward", backward: "backward", back: "back" } as const satisfies Record<ArrangeTo, FrameActionId>;
export const ALIGN_ACTIONS = {
  "align-left": "left",
  "align-center": "center",
  "align-right": "right",
  "align-top": "top",
  "align-middle": "middle",
  "align-bottom": "bottom",
} as const satisfies Partial<Record<FrameActionId, AlignEdge>>;

export const isToolbarAction = (value: unknown): value is ToolbarActionId => typeof value === "string" && (TOOLBAR_ACTIONS as readonly string[]).includes(value);

/** A list of buttons as the toolbar wants it: known actions only, each once, in the menu's order (Remove last). Null when it isn't a list. */
export function normalizePins(value: unknown): ToolbarActionId[] | null {
  if (!Array.isArray(value)) return null;
  const wanted = new Set(value.filter(isToolbarAction));
  return TOOLBAR_ACTIONS.filter((id) => wanted.has(id));
}

/** The setting as saved, with the default for whatever is missing or not understood. */
export function normalizeToolbar(value: unknown): ToolbarSetting {
  const raw = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return { show: raw.show === false ? false : true, pins: normalizePins(raw.pins) ?? [...DEFAULT_PINS] };
}

/** The buttons with one action added or taken away. */
export function togglePin(pins: readonly ToolbarActionId[], id: ToolbarActionId): ToolbarActionId[] {
  return normalizePins(pins.includes(id) ? pins.filter((one) => one !== id) : [...pins, id])!;
}

/** What a selection allows: the frames it holds and whether any is locked, hidden or the only one. */
export interface Selection {
  count: number;
  /** Any frame of it is locked (it can't be moved, resized, reset or aligned). */
  anyLocked: boolean;
  /** Every frame of it is locked. */
  allLocked: boolean;
  /** Every frame of it is hidden on the canvas. */
  allHidden: boolean;
}

export function selectionOf(items: readonly { locked: boolean; hiddenOnCanvas: boolean }[]): Selection {
  return { count: items.length, anyLocked: items.some((item) => item.locked), allLocked: items.length > 0 && items.every((item) => item.locked), allHidden: items.length > 0 && items.every((item) => item.hiddenOnCanvas) };
}

/** Whether an action is offered for the selection (Settings is for one frame); the rest work on any number. */
export const offered = (id: FrameActionId, selection: Selection): boolean => (id === "settings" ? selection.count === 1 : true);

/** Whether an offered action is switched off for the selection: a locked frame can't be moved or resized, so position and size actions wait for the unlock. */
export const disabled = (id: FrameActionId, selection: Selection): boolean => (id === "reset" || id === "reset-size" || id.startsWith("align")) && selection.anyLocked;
