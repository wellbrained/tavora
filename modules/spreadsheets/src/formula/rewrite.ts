// Keeps formulas pointing at the right cells when the sheet changes around them: rows or columns put in or taken out,
// a sheet renamed or deleted, a formula copied somewhere else. Works on the formula's tokens, so everything that isn't
// a reference stays exactly as typed. A reference to something that is gone becomes #REF!.
import { join, tokenize, type RefPoint, type RefToken, type Token } from "./lexer";
import { columnName, quoteSheet } from "./refs";

/** Where a formula sits, and the sheet names a reference may use. */
export interface FormulaPlace {
  /** The name of the sheet the formula is on (a reference without a sheet means this one). */
  sheet: string;
}

const same = (a: string | undefined, b: string) => a !== undefined && a.toLowerCase() === b.toLowerCase();

function pointText(point: RefPoint): string {
  const col = point.col === null ? "" : `${point.absCol ? "$" : ""}${columnName(point.col)}`;
  const row = point.row === null ? "" : `${point.absRow ? "$" : ""}${point.row + 1}`;
  return col + row;
}

/** A reference written out again, with the sheet as given. */
export function refText(sheet: string | undefined, a: RefPoint, b?: RefPoint): string {
  const prefix = sheet === undefined ? "" : `${quoteSheet(sheet)}!`;
  return prefix + pointText(a) + (b ? `:${pointText(b)}` : "");
}

function rewrite(formula: string, change: (token: RefToken) => string | null): string {
  if (!formula.startsWith("=")) return formula;
  const tokens: Token[] = tokenize(formula.slice(1));
  let touched = false;
  const next = tokens.map((token) => {
    if (token.type !== "ref") return token;
    const text = change(token);
    if (text === null || text === token.text) return token;
    touched = true;
    return { ...token, text } as Token;
  });
  return touched ? `=${join(next)}` : formula;
}

/**
 * Rows (or columns) put in (`count` > 0, before index `at`) or taken out (`count` < 0, from `at`) on sheet `target`.
 * Absolute and relative references both move, as in Excel; a range grows or shrinks, and one wholly taken out turns
 * into #REF!, as does a cell that was taken out.
 */
export function shiftReferences(formula: string, place: FormulaPlace, target: string, axis: "row" | "col", at: number, count: number): string {
  return rewrite(formula, (token) => {
    const sheet = token.sheet ?? place.sheet;
    if (!same(sheet, target)) return null;
    const get = (point: RefPoint) => (axis === "row" ? point.row : point.col);
    const set = (point: RefPoint, value: number): RefPoint => (axis === "row" ? { ...point, row: value } : { ...point, col: value });
    if (count > 0) {
      const move = (point: RefPoint) => {
        const index = get(point);
        return index === null || index < at ? point : set(point, index + count);
      };
      return refText(token.sheet, move(token.a), token.b && move(token.b));
    }
    const removed = -count;
    const end = at + removed;
    if (!token.b) {
      const index = get(token.a);
      if (index === null) return null;
      if (index >= at && index < end) return "#REF!";
      return index >= end ? refText(token.sheet, set(token.a, index - removed)) : null;
    }
    const first = get(token.a);
    const last = get(token.b);
    if (first === null || last === null) return null;
    const low = Math.min(first, last);
    const high = Math.max(first, last);
    if (low >= at && high < end) return "#REF!";
    // Each end moves up past what was removed, or to its edge when it was inside it.
    const newLow = low < at ? low : low >= end ? low - removed : at;
    const newHigh = high < at ? high : high >= end ? high - removed : at - 1;
    const [a, b] = first <= last ? [token.a, token.b] : [token.b, token.a];
    return refText(token.sheet, set(a, newLow), set(b, newHigh));
  });
}

/** A sheet renamed: references to it use the new name (quoted when it needs to be). */
export function renameSheetReferences(formula: string, from: string, to: string): string {
  return rewrite(formula, (token) => (same(token.sheet, from) ? refText(to, token.a, token.b) : null));
}

/** A sheet deleted: references to it become #REF!. */
export function dropSheetReferences(formula: string, name: string): string {
  return rewrite(formula, (token) => (same(token.sheet, name) ? "#REF!" : null));
}

/**
 * A formula copied `rows` down and `cols` across (paste, fill): relative parts move with it, $ parts stay. A
 * reference pushed off the sheet becomes #REF!.
 */
export function moveFormula(formula: string, rows: number, cols: number): string {
  if (rows === 0 && cols === 0) return formula;
  return rewrite(formula, (token) => {
    let broken = false;
    const move = (point: RefPoint): RefPoint => {
      const row = point.row === null || point.absRow ? point.row : point.row + rows;
      const col = point.col === null || point.absCol ? point.col : point.col + cols;
      if ((row !== null && row < 0) || (col !== null && col < 0)) broken = true;
      return { ...point, row, col };
    };
    const a = move(token.a);
    const b = token.b && move(token.b);
    return broken ? "#REF!" : refText(token.sheet, a, b);
  });
}

/** The sheet names a formula points at (for loading checks and tests). */
export function referencedSheets(formula: string): string[] {
  if (!formula.startsWith("=")) return [];
  return [...new Set(tokenize(formula.slice(1)).flatMap((token) => (token.type === "ref" && token.sheet !== undefined ? [token.sheet] : [])))];
}
