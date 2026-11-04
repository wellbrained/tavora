// Changes to a spreadsheet, as functions on the document: the store runs them on the newest copy (again after
// another panel saved first), so they never depend on an older one. Rows, columns and sheets put in or taken out
// rewrite every formula that points at them, on every sheet.
import { cellName, parseCellName, parseRangeName, rangeName, type CellRange } from "./formula/refs";
import { dropSheetReferences, moveFormula, renameSheetReferences, shiftReferences } from "./formula/rewrite";
import { isFormula } from "./formula/values";
import { LIMITS, emptySheet, sheetById, type Sheet, type SpreadsheetData } from "./model";

/** Sets cells by name; null or "" clears one. */
export function setCells(sheet: Sheet, entries: Iterable<readonly [string, string | null]>): void {
  for (const [name, raw] of entries) {
    if (raw === null || raw === "") delete sheet.cells[name];
    else sheet.cells[name] = raw;
  }
}

export function clearRange(sheet: Sheet, range: CellRange): string[] {
  const names: string[] = [];
  for (const name of Object.keys(sheet.cells)) {
    const at = parseCellName(name)!;
    if (at.row >= range.top && at.row <= range.bottom && at.col >= range.left && at.col <= range.right) {
      delete sheet.cells[name];
      names.push(name);
    }
  }
  return names;
}

// ── Rows and columns

type Axis = "row" | "col";

/** Moves an index past a change: rows put in (count > 0) before `at`, or taken out from `at`. Null when it was taken out. */
function shiftIndex(index: number, at: number, count: number): number | null {
  if (count > 0) return index >= at ? index + count : index;
  const removed = -count;
  if (index < at) return index;
  if (index < at + removed) return null;
  return index - removed;
}

/** A range past the change: grown, moved, shrunk, or null when it was taken out whole. */
export function shiftRange(range: CellRange, axis: Axis, at: number, count: number): CellRange | null {
  const [low, high] = axis === "row" ? [range.top, range.bottom] : [range.left, range.right];
  let newLow: number;
  let newHigh: number;
  if (count > 0) {
    newLow = low >= at ? low + count : low;
    newHigh = high >= at ? high + count : high;
  } else {
    const end = at - count;
    if (low >= at && high < end) return null;
    newLow = low < at ? low : low >= end ? low + count : at;
    newHigh = high < at ? high : high >= end ? high + count : at - 1;
  }
  return axis === "row" ? { ...range, top: newLow, bottom: newHigh } : { ...range, left: newLow, right: newHigh };
}

function shiftSizes(sizes: { [index: string]: number }, at: number, count: number): { [index: string]: number } {
  const out: { [index: string]: number } = {};
  for (const [key, size] of Object.entries(sizes)) {
    const index = shiftIndex(Number(key), at, count);
    if (index !== null) out[index] = size;
  }
  return out;
}

/**
 * Puts in (`count` > 0, before `at`) or takes out (`count` < 0, from `at`) rows or columns of a sheet. Cells, formats,
 * looks, sizes, the filter and the live view move with them, and every formula on every sheet is rewritten.
 */
export function shiftSheet(doc: SpreadsheetData, sheetId: string, axis: Axis, at: number, count: number): void {
  const sheet = sheetById(doc, sheetId);
  if (!sheet || count === 0) return;
  const cells: { [name: string]: string } = {};
  for (const [name, raw] of Object.entries(sheet.cells)) {
    const cell = parseCellName(name)!;
    const index = shiftIndex(axis === "row" ? cell.row : cell.col, at, count);
    if (index === null) continue;
    const row = axis === "row" ? index : cell.row;
    const col = axis === "col" ? index : cell.col;
    if (row >= LIMITS.rows || col >= LIMITS.cols) continue;
    cells[cellName(row, col)] = raw;
  }
  sheet.cells = cells;
  const moveRules = <T extends { range: string }>(rules: T[]): T[] =>
    rules.flatMap((rule) => {
      const range = parseRangeName(rule.range);
      const moved = range && shiftRange(range, axis, at, count);
      return moved ? [{ ...rule, range: rangeName(moved) }] : [];
    });
  sheet.formats = moveRules(sheet.formats);
  sheet.styles = moveRules(sheet.styles);
  if (axis === "row") sheet.rowHeights = shiftSizes(sheet.rowHeights, at, count);
  else sheet.colWidths = shiftSizes(sheet.colWidths, at, count);
  if (axis === "col" && sheet.filter) {
    const columns: typeof sheet.filter.columns = {};
    for (const [key, filter] of Object.entries(sheet.filter.columns)) {
      const index = shiftIndex(Number(key), at, count);
      if (index !== null) columns[index] = filter;
    }
    sheet.filter = { ...sheet.filter, columns };
  }
  if (doc.live?.sheet === sheetId) {
    const range = parseRangeName(doc.live.range);
    const moved = range && shiftRange(range, axis, at, count);
    doc.live = moved ? { ...doc.live, range: rangeName(moved) } : null;
  }
  for (const other of doc.sheets) {
    for (const [name, raw] of Object.entries(other.cells)) {
      if (!isFormula(raw)) continue;
      const next = shiftReferences(raw, { sheet: other.name }, sheet.name, axis, at, count);
      if (next !== raw) other.cells[name] = next;
    }
  }
}

// ── Sheets

export function addSheet(doc: SpreadsheetData, id: string, name: string, at = doc.sheets.length): boolean {
  if (doc.sheets.length >= LIMITS.sheets || sheetById(doc, id)) return false;
  doc.sheets.splice(Math.max(0, Math.min(at, doc.sheets.length)), 0, emptySheet(id, name));
  return true;
}

/** Renames a sheet; formulas on every sheet follow it. */
export function renameSheet(doc: SpreadsheetData, id: string, name: string): void {
  const sheet = sheetById(doc, id);
  if (!sheet || sheet.name === name) return;
  const before = sheet.name;
  sheet.name = name;
  for (const other of doc.sheets) {
    for (const [cell, raw] of Object.entries(other.cells)) {
      if (!isFormula(raw)) continue;
      const next = renameSheetReferences(raw, before, name);
      if (next !== raw) other.cells[cell] = next;
    }
  }
}

/** Takes a sheet out (never the last one); formulas pointing at it show #REF!. */
export function deleteSheet(doc: SpreadsheetData, id: string): void {
  const sheet = sheetById(doc, id);
  if (!sheet || doc.sheets.length <= 1) return;
  doc.sheets = doc.sheets.filter((other) => other.id !== id);
  if (doc.live?.sheet === id) doc.live = null;
  for (const other of doc.sheets) {
    for (const [cell, raw] of Object.entries(other.cells)) {
      if (!isFormula(raw)) continue;
      const next = dropSheetReferences(raw, sheet.name);
      if (next !== raw) other.cells[cell] = next;
    }
  }
}

/** Puts the sheets in the order of these ids; ids it doesn't know are ignored, sheets it leaves out stay at the end. */
export function orderSheets(doc: SpreadsheetData, ids: readonly string[]): void {
  const rank = new Map(ids.map((id, index) => [id, index]));
  doc.sheets = [...doc.sheets].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}

// ── Copying cells

/**
 * Cells of a block written somewhere else (paste, fill): formulas move along by the distance, so their relative
 * references keep pointing at the same neighbours.
 */
export function movedRaw(raw: string, rows: number, cols: number): string {
  return isFormula(raw) ? moveFormula(raw, rows, cols) : raw;
}
