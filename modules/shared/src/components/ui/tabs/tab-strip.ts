// The pure parts of TabStrip: where a dragged tab lands, which tab to open when one closes, and what a rename accepts.
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
