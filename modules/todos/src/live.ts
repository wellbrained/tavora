// The live view: what the panel hands to Tavora (panel.setLive) so the overlay page can show the list read-only
// over the game while the full panel is closed. Pure functions, so the rules are easy to test.
import type { JsonValue } from "@tavora/sdk";
import { depths, type TodoList } from "./todos";

/** The fonts the live view offers, all bundled (fonts.css) so they work offline. The first is the default. */
export const LIVE_FONTS = [
  { id: "inter", name: "Inter", stack: '"Inter Variable", system-ui, sans-serif' },
  { id: "saira", name: "Saira", stack: '"Saira Variable", system-ui, sans-serif' },
  { id: "titillium", name: "Titillium Web", stack: '"Titillium Web", system-ui, sans-serif' },
  { id: "barlow", name: "Barlow Condensed", stack: '"Barlow Condensed", system-ui, sans-serif' },
  { id: "nunito", name: "Nunito", stack: '"Nunito Variable", system-ui, sans-serif' },
  { id: "atkinson", name: "Atkinson Hyperlegible", stack: '"Atkinson Hyperlegible", system-ui, sans-serif' },
  { id: "cinzel", name: "Cinzel", stack: '"Cinzel Variable", Georgia, serif' },
] as const;
export type LiveFont = (typeof LIVE_FONTS)[number]["id"];

/** Text sizes in px; medium is the size the live view always had. */
export const LIVE_SIZES = { xs: 12, s: 14, m: 16, l: 20, xl: 24 } as const;
export type LiveSize = keyof typeof LIVE_SIZES;

/** What sits between groups: nothing, a line, or the group's name. */
export const LIVE_HEADERS = ["none", "line", "name"] as const;
export type LiveHeaders = (typeof LIVE_HEADERS)[number];

/** Colors offered for the text and the plate; any other #rrggbb works too. */
export const LIVE_COLORS = ["#ffffff", "#facc15", "#fb923c", "#f87171", "#f472b6", "#a78bfa", "#60a5fa", "#2dd4bf", "#4ade80", "#000000"];

/** How the live view looks; stored per panel. */
export interface LiveLook {
  [key: string]: JsonValue;
  font: LiveFont;
  size: LiveSize;
  bold: boolean;
  /** Text color, #rrggbb. */
  color: string;
  /** A dark outline around the text, so it stays readable on bright scenes. */
  outline: boolean;
  headers: LiveHeaders;
  /** Finished to-dos stay in the list, ticked and struck through. */
  showFinished: boolean;
  /** Plate color, #rrggbb. */
  backgroundColor: string;
  /** Plate opacity in percent, 0-100. */
  background: number;
  /** Padding around the list in px, 0-25. */
  padding: number;
}

export const LIVE_DEFAULTS: LiveLook = {
  font: "inter",
  size: "m",
  bold: false,
  color: "#ffffff",
  outline: true,
  headers: "name",
  showFinished: false,
  backgroundColor: "#000000",
  background: 35,
  padding: 8,
};
export const LIVE_RANGE = { background: [0, 100], padding: [0, 25] } as const;

/** Rows and text stay small: Tavora accepts at most 16 KB, and 30 rows of 100 characters stay below that. */
export const LIVE_MAX = { rows: 30, text: 100 } as const;

export interface LiveTaskRow {
  [key: string]: JsonValue;
  kind: "task";
  text: string;
  pinned: boolean;
  done: boolean;
  /** "2/5" for a to-do with sub-to-dos, else null. */
  progress: string | null;
  /** How far it is indented: 0 for a to-do of its own, 1 for a sub-to-do, and so on. Pinned rows are never indented. */
  depth: number;
}

/** The start of a group, or of the current objectives; drawn as `look.headers` says. */
export interface LiveGroupRow {
  [key: string]: JsonValue;
  kind: "group";
  text: string;
}

export type LiveRow = LiveTaskRow | LiveGroupRow;

export interface LiveState {
  [key: string]: JsonValue;
  rows: LiveRow[];
  /** To-dos that did not fit into the rows. */
  more: number;
  /** "+{count} more" in the panel's language, for the overlay to fill in. */
  moreText: string;
  look: LiveLook;
}

/** Texts in the panel's language the live view needs. */
export interface LiveTexts {
  /** "+{count} more". */
  more: string;
  /** The heading over pinned to-dos. */
  objectives: string;
}

const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T => options.find((option) => option === value) ?? fallback;
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
const hex = (value: unknown, fallback: string): string => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);

/** A look from stored panel state: anything missing or out of range falls back or is pulled into range. */
export function parseLook(raw: { [key: string]: unknown } | null | undefined): LiveLook {
  const d = LIVE_DEFAULTS;
  return {
    font: oneOf(
      LIVE_FONTS.map((font) => font.id),
      raw?.font,
      d.font,
    ),
    size: oneOf(Object.keys(LIVE_SIZES) as LiveSize[], raw?.size, d.size),
    bold: bool(raw?.bold, d.bold),
    color: hex(raw?.color, d.color),
    outline: bool(raw?.outline, d.outline),
    headers: oneOf(LIVE_HEADERS, raw?.headers, d.headers),
    showFinished: bool(raw?.showFinished, d.showFinished),
    backgroundColor: hex(raw?.backgroundColor, d.backgroundColor),
    background: clamp(raw?.background, LIVE_RANGE.background, d.background),
    padding: clamp(raw?.padding, LIVE_RANGE.padding, d.padding),
  };
}

/** How the panel itself shows to-dos: font and text size; stored per panel. */
export interface PanelLook {
  [key: string]: JsonValue;
  font: LiveFont;
  size: LiveSize;
}

export const PANEL_LOOK_DEFAULTS: PanelLook = { font: "inter", size: "m" };

/** Text size and line height in px for each panel size; medium is the size the panel always had. */
export const PANEL_SIZES: Record<LiveSize, readonly [number, number]> = { xs: [12, 16], s: [13, 18], m: [14, 20], l: [16, 22], xl: [18, 26] };

/** A panel look from stored panel state; anything unknown falls back to the default. */
export function parsePanelLook(raw: { [key: string]: unknown } | null | undefined): PanelLook {
  return {
    font: oneOf(
      LIVE_FONTS.map((font) => font.id),
      raw?.font,
      PANEL_LOOK_DEFAULTS.font,
    ),
    size: oneOf(Object.keys(LIVE_SIZES) as LiveSize[], raw?.size, PANEL_LOOK_DEFAULTS.size),
  };
}

export function fontStack(id: LiveFont): string {
  return LIVE_FONTS.find((font) => font.id === id)?.stack ?? LIVE_FONTS[0].stack;
}

/** One line, at most `LIVE_MAX.text` characters (counted as characters, not UTF-16 units). */
export function shorten(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > LIVE_MAX.text ? `${chars.slice(0, LIVE_MAX.text - 1).join("").trimEnd()}…` : line;
}

/**
 * The live state for a panel: to-dos of the groups this panel shows (not folded away), pinned first, then in list
 * order with sub-to-dos indented under their parent. Pinned ones count wherever they are, as in the panel's
 * objectives, and are not repeated below. Finished to-dos, and everything under them, are left out unless the look
 * shows them; a to-do with sub-to-dos shows how many are done. With headers, each part starts with its name.
 */
export function buildLiveState(list: TodoList, collapsed: readonly string[], look: LiveLook, texts: LiveTexts): LiveState {
  const headers = look.headers !== "none";
  const pinned: LiveRow[] = [];
  const rest: LiveRow[] = [];
  for (const group of list.groups) {
    const shown = !collapsed.includes(group.id);
    const depth = depths(group.tasks);
    const rows: LiveRow[] = [];
    // Tasks under a hidden one are hidden with it (tasks come parent first).
    const hidden = new Set<string>();
    for (const task of group.tasks) {
      const gone = (task.done && !look.showFinished) || (task.parentId !== null && hidden.has(task.parentId));
      if (gone) hidden.add(task.id);
      if (gone || (!task.pinned && !shown)) continue;
      const text = shorten(task.title);
      if (!text) continue;
      const steps = group.tasks.filter((other) => other.parentId === task.id);
      const progress = steps.length ? `${steps.filter((step) => step.done).length}/${steps.length}` : null;
      const row = { kind: "task", text, pinned: task.pinned, done: task.done, progress } as const;
      if (task.pinned) pinned.push({ ...row, depth: 0 });
      else rows.push({ ...row, depth: depth.get(task.id) ?? 0 });
    }
    if (rows.length && headers) rest.push({ kind: "group", text: shorten(group.name) });
    rest.push(...rows);
  }
  if (pinned.length && headers) pinned.unshift({ kind: "group", text: shorten(texts.objectives) });
  const all = [...pinned, ...rest];
  const rows = all.slice(0, LIVE_MAX.rows);
  // A heading with nothing after it is left out; "+N more" counts to-dos only.
  if (rows.at(-1)?.kind === "group") rows.pop();
  const tasks = (some: LiveRow[]) => some.filter((row) => row.kind === "task").length;
  return { rows, more: tasks(all) - tasks(rows), moreText: texts.more, look };
}

/** Wraps `send` so it runs at most once per `ms`: the first call straight away, a burst ends with its last state. */
export function throttle<A extends unknown[]>(send: (...args: A) => void, ms: number): { (...args: A): void; cancel(): void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  const run = () => {
    timer = undefined;
    last = Date.now();
    const args = pending!;
    pending = undefined;
    send(...args);
  };
  const throttled = (...args: A) => {
    pending = args;
    if (timer !== undefined) return;
    const wait = last + ms - Date.now();
    if (wait <= 0) run();
    else timer = setTimeout(run, wait);
  };
  throttled.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  return throttled;
}
