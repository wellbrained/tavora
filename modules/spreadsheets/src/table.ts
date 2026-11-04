// Fill, sort and filter: what the fill handle writes, the order a sort leaves rows in, and the rows a filter hides.
// Pure, on stored cells and worked-out values, so the rules are easy to test.
import type { FillPlan } from "@tavora/official-ui/components/ui/data-grid";
import { cellName } from "./formula/refs";
import { compare, isError, isFormula, parseStoredDate, rawValue, storedDate, storedNumber, type Scalar } from "./formula/values";
import { movedRaw } from "./ops";
import type { ColumnFilter, SheetFilter } from "./model";

type RawAt = (row: number, col: number) => string | undefined;

/**
 * The cells a fill writes, by name (null clears). `series` continues numbers (1, 2 → 3, 4), dates (one day on, or the
 * step between two) and text ending in a number (Run 1 → Run 2); anything else, and `copy`, repeats the source.
 * Formulas move along, so their relative references follow.
 */
export function fillCells(plan: FillPlan, rawAt: RawAt, mode: "series" | "copy"): [string, string | null][] {
  const { source, target, direction } = plan;
  const vertical = direction === "down" || direction === "up";
  const forward = direction === "down" || direction === "right";
  const lines = vertical ? range(source.left, source.right) : range(source.top, source.bottom);
  const along = vertical ? range(source.top, source.bottom) : range(source.left, source.right);
  const targets = vertical ? range(target.top, target.bottom) : range(target.left, target.right);
  const out: [string, string | null][] = [];
  for (const line of lines) {
    const raws = along.map((at) => (vertical ? rawAt(at, line) : rawAt(line, at)));
    const series = mode === "series" ? seriesOf(raws, forward) : null;
    for (const at of targets) {
      // How many steps past the source's edge, 1 for the first filled cell.
      const step = forward ? at - along[along.length - 1]! : along[0]! - at;
      const row = vertical ? at : line;
      const col = vertical ? line : at;
      let raw: string | undefined;
      if (series) raw = series(step);
      else {
        // The source repeats; going up or left, its last cell comes first.
        const index = (step - 1) % along.length;
        const from = forward ? along[index]! : along[along.length - 1 - index]!;
        const sourceRaw = vertical ? rawAt(from, line) : rawAt(line, from);
        raw = sourceRaw === undefined ? undefined : movedRaw(sourceRaw, vertical ? row - from : 0, vertical ? 0 : col - from);
      }
      out.push([cellName(row, col), raw ?? null]);
    }
  }
  return out;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A rule that continues the source, or null when it should be copied. */
function seriesOf(raws: (string | undefined)[], forward: boolean): ((step: number) => string) | null {
  if (raws.some((raw) => raw === undefined || isFormula(raw))) return null;
  const values = raws as string[];
  // Going up or left, the series runs the other way: the source read from its far end.
  const ordered = forward ? values : [...values].reverse();
  // Dates: a day on, or the step between the first two.
  const dates = ordered.map(parseStoredDate);
  if (dates.every((date) => date !== null)) {
    const days = dates as number[];
    const stepDays = days.length > 1 ? (days[days.length - 1]! - days[0]!) / (days.length - 1) : forward ? 1 : -1;
    return (step) => storedDate(days[days.length - 1]! + stepDays * step);
  }
  const numbers = ordered.map((raw) => rawValue(raw));
  if (numbers.every((value) => typeof value === "number")) {
    if (numbers.length < 2) return null;
    const list = numbers as number[];
    const stepSize = (list[list.length - 1]! - list[0]!) / (list.length - 1);
    return (step) => storedNumber(list[list.length - 1]! + stepSize * step);
  }
  // "Run 1", "Run 2": the number at the end goes on.
  const tails = ordered.map((raw) => /^(.*?)(\d+)$/.exec(raw));
  if (tails.every((tail) => tail !== null) && tails.every((tail) => tail![1] === tails[0]![1])) {
    const list = tails.map((tail) => Number(tail![2]));
    const stepSize = list.length > 1 ? Math.round((list[list.length - 1]! - list[0]!) / (list.length - 1)) : forward ? 1 : -1;
    const prefix = tails[0]![1]!;
    const width = /^0\d/.test(tails[tails.length - 1]![2]!) ? tails[tails.length - 1]![2]!.length : 0;
    return (step) => {
      const next = Math.max(0, list[list.length - 1]! + stepSize * step);
      return prefix + String(next).padStart(width, "0");
    };
  }
  return null;
}

// ── Sort

export interface SortKey {
  col: number;
  descending: boolean;
}

/**
 * The new order of rows `top`..`bottom` (by their old index) for sort keys, by worked-out values. Empty cells go last
 * either way; equal rows keep their order.
 */
export function sortOrder(top: number, bottom: number, keys: readonly SortKey[], valueAt: (row: number, col: number) => Scalar): number[] {
  const rows = range(top, bottom);
  const cache = new Map<string, Scalar>();
  const get = (row: number, col: number) => {
    const key = `${row}:${col}`;
    if (!cache.has(key)) cache.set(key, valueAt(row, col));
    return cache.get(key)!;
  };
  return rows.sort((a, b) => {
    for (const { col, descending } of keys) {
      const left = get(a, col);
      const right = get(b, col);
      const leftEmpty = left === null || left === "";
      const rightEmpty = right === null || right === "";
      if (leftEmpty || rightEmpty) {
        if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
        continue;
      }
      if (isError(left) || isError(right)) {
        if (isError(left) !== isError(right)) return isError(left) ? 1 : -1;
        continue;
      }
      const order = compare(left, right);
      if (order !== 0) return descending ? -order : order;
    }
    return a - b;
  });
}

/**
 * The cells after a sort: each row's cells (columns `left`..`right`) move to their new place, formulas moved by the
 * rows they travelled.
 */
export function sortedCells(order: readonly number[], top: number, left: number, right: number, rawAt: RawAt): [string, string | null][] {
  const out: [string, string | null][] = [];
  order.forEach((from, index) => {
    const to = top + index;
    for (let col = left; col <= right; col++) {
      const raw = rawAt(from, col);
      out.push([cellName(to, col), raw === undefined ? null : movedRaw(raw, to - from, 0)]);
    }
  });
  return out;
}

// ── Filter

export const emptyColumnFilter = (): ColumnFilter => ({ hidden: [], contains: "", min: null, max: null, checked: null });

export const isActive = (filter: ColumnFilter): boolean => filter.hidden.length > 0 || filter.contains !== "" || filter.min !== null || filter.max !== null || filter.checked !== null;

/** Whether one cell gets through a column's filter, by what it shows and its value. */
export function passes(filter: ColumnFilter, shown: string, value: Scalar): boolean {
  if (filter.hidden.includes(shown)) return false;
  if (filter.contains && !shown.toLowerCase().includes(filter.contains.toLowerCase())) return false;
  if (filter.min !== null || filter.max !== null) {
    if (typeof value !== "number") return false;
    if (filter.min !== null && value < filter.min) return false;
    if (filter.max !== null && value > filter.max) return false;
  }
  if (filter.checked !== null && (value === true) !== filter.checked) return false;
  return true;
}

/** The rows a filter hides, below the header row, up to the last used row. */
export function hiddenRows(filter: SheetFilter | null, firstRow: number, rows: number, shownAt: (row: number, col: number) => string, valueAt: (row: number, col: number) => Scalar): Set<number> {
  const hidden = new Set<number>();
  if (!filter) return hidden;
  const active = Object.entries(filter.columns).filter(([, column]) => isActive(column));
  if (!active.length) return hidden;
  for (let row = firstRow; row < rows; row++) {
    for (const [key, column] of active) {
      const col = Number(key);
      if (!passes(column, shownAt(row, col), valueAt(row, col))) {
        hidden.add(row);
        break;
      }
    }
  }
  return hidden;
}
