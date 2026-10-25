// The live view: what the panel hands to Tavora (panel.setLive) so the overlay page can show the list read-only
// over the game while the full panel is closed. Pure functions, so the rules are easy to test.
import type { JsonValue } from "@tavora/sdk";
import type { TodoList } from "./todos";

/** How the plate behind the list looks; stored per panel. */
export interface LiveLook {
  /** Background opacity in percent, 0-100. */
  background: number;
  /** Padding around the list in px, 0-25. */
  padding: number;
}

export const LIVE_DEFAULTS: LiveLook = { background: 33, padding: 8 };
export const LIVE_RANGE = { background: [0, 100], padding: [0, 25] } as const;

/** Rows and text stay small: Tavora accepts at most 16 KB, and 30 rows of 100 characters are far below that. */
export const LIVE_MAX = { rows: 30, text: 100 } as const;

export interface LiveRow {
  [key: string]: JsonValue;
  text: string;
  pinned: boolean;
  /** "2/5" for a to-do with steps, else null. */
  progress: string | null;
}

export interface LiveState {
  [key: string]: JsonValue;
  rows: LiveRow[];
  /** Open to-dos that did not fit into the rows. */
  more: number;
  /** "+{count} more" in the panel's language, for the overlay to fill in. */
  moreText: string;
  background: number;
  padding: number;
}

const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** A look from stored panel state: anything missing or out of range falls back or is pulled into range. */
export function parseLook(raw: { background?: unknown; padding?: unknown } | null | undefined): LiveLook {
  return {
    background: clamp(raw?.background, LIVE_RANGE.background, LIVE_DEFAULTS.background),
    padding: clamp(raw?.padding, LIVE_RANGE.padding, LIVE_DEFAULTS.padding),
  };
}

/** One line, at most `LIVE_MAX.text` characters (counted as characters, not UTF-16 units). */
export function shorten(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(line);
  return chars.length > LIVE_MAX.text ? `${chars.slice(0, LIVE_MAX.text - 1).join("").trimEnd()}…` : line;
}

/**
 * The live state for a panel: open to-dos of the groups this panel shows (not folded away), pinned first, then in
 * list order. Pinned ones count wherever they are, as in the panel's objectives. Finished to-dos and sub-to-dos are
 * left out; a to-do with steps shows how many are done.
 */
export function buildLiveState(list: TodoList, collapsed: readonly string[], look: LiveLook, moreText: string): LiveState {
  const pinned: LiveRow[] = [];
  const rest: LiveRow[] = [];
  for (const group of list.groups) {
    const shown = !collapsed.includes(group.id);
    for (const task of group.tasks) {
      if (task.done || (!shown && !task.pinned)) continue;
      // A sub-to-do is part of its parent's progress; it gets its own row only when pinned.
      if (task.parentId && !task.pinned) continue;
      const steps = group.tasks.filter((other) => other.parentId === task.id);
      const text = shorten(task.title);
      if (!text) continue;
      (task.pinned ? pinned : rest).push({
        text,
        pinned: task.pinned,
        progress: steps.length ? `${steps.filter((step) => step.done).length}/${steps.length}` : null,
      });
    }
  }
  const all = [...pinned, ...rest];
  return {
    rows: all.slice(0, LIVE_MAX.rows),
    more: Math.max(0, all.length - LIVE_MAX.rows),
    moreText,
    background: look.background,
    padding: look.padding,
  };
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
