// The pure parts of TabStrip: where a dragged tab lands, which tab to open when one closes, what a rename accepts, and
// which tabs don't fit the row. The dock's panel tabs use the last ones too, so both count hidden tabs alike.
import { checkName, DEFAULT_NAME_LIMIT, type NameProblem } from "../../name-check";

export interface StripTab {
  id: string;
  label: string;
  /** Shows a close button; Delete, Backspace and a middle click close it too. */
  closable?: boolean;
  /** Double-click and F2 rename it in place. */
  renamable?: boolean;
}

/** The ids with `id` moved next to `target`: before it, or after it with `after`. Unchanged for an unknown id or the tab itself. */
export function moveTab(ids: readonly string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return [...ids];
  const rest = ids.filter((other) => other !== id);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** The ids with `id` one place to the left (-1) or right (1); unchanged at either end. */
export function stepTab(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const index = ids.indexOf(id);
  const target = ids[index + step];
  return index < 0 || target === undefined ? [...ids] : moveTab(ids, id, target, step === 1);
}

/** The tab to open when `id` closes: the one after it, else the one before; null when it was the only one. */
export function neighbourAfterClose(ids: readonly string[], id: string): string | null {
  const index = ids.indexOf(id);
  if (index < 0) return null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/** The tab a pointer at `x` is over (the nearest one past either end), and whether it is over that tab's right half. */
export function dropPlace(boxes: readonly { id: string; left: number; right: number }[], x: number): { target: string; after: boolean } | null {
  if (!boxes.length) return null;
  const first = boxes[0]!;
  const last = boxes[boxes.length - 1]!;
  if (x <= first.left) return { target: first.id, after: false };
  if (x >= last.right) return { target: last.id, after: true };
  const over = boxes.find((box) => x >= box.left && x < box.right) ?? last;
  return { target: over.id, after: x >= (over.left + over.right) / 2 };
}

export type RenameResult = { kind: "unchanged" } | { kind: "invalid"; problem: Exclude<NameProblem, null> } | { kind: "rename"; label: string };

/** What a finished rename means: nothing (same name), a name that is not accepted, or the trimmed new name. */
export function checkRename(before: string, text: string, max = DEFAULT_NAME_LIMIT): RenameResult {
  const problem = checkName(text, max);
  if (problem) return { kind: "invalid", problem };
  const label = text.trim();
  return label === before ? { kind: "unchanged" } : { kind: "rename", label };
}

/** A box across the row: a tab, or the row itself. */
export interface RowSpan {
  left: number;
  right: number;
}

/** How far a tab may stick out of the row and still count as in view: a pixel, so rounding never shows a control. */
const SLACK = 1;

/**
 * The tabs not entirely in the row, in tab order, and whether some are hidden before it (scrolled away to the left) or
 * after it.
 */
export function tabsOutOfView(row: RowSpan, tabs: readonly (RowSpan & { id: string })[]): { hidden: string[]; before: boolean; after: boolean } {
  let before = false;
  let after = false;
  const hidden: string[] = [];
  for (const tab of tabs) {
    const left = tab.left < row.left - SLACK;
    const right = tab.right > row.right + SLACK;
    if (!left && !right) continue;
    hidden.push(tab.id);
    if (left) before = true;
    if (right) after = true;
  }
  return { hidden, before, after };
}

/** How far to scroll the row (added to `scrollLeft`) so the tab is in it; 0 when it is. A tab wider than the row shows its start. */
export function revealBy(row: RowSpan, tab: RowSpan): number {
  if (tab.right > row.right + SLACK) return Math.min(tab.right - row.right, tab.left - row.left);
  if (tab.left < row.left - SLACK) return tab.left - row.left;
  return 0;
}

/** The tab before (-1) or after (1) `id`; null at either end or for an unknown id. */
export function neighbourTab(ids: readonly string[], id: string | undefined, step: -1 | 1): string | null {
  const index = id === undefined ? -1 : ids.indexOf(id);
  if (index < 0) return null;
  return ids[index + step] ?? null;
}
