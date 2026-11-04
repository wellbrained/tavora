// Cell names (A1), ranges (B2:D9) and sheet prefixes (Gear!, 'Boss runs'!), read and written. Rows and columns count
// from 0 inside the module; only the names start at A and 1.
// Column names are written out here, not taken from the kit's grid, so the overlay page (no Vue) stays small. They
// match DataGrid's headers (geometry.ts there).

/** "A" for 0, "Z" for 25, "AA" for 26. */
export function columnName(index: number): string {
  let name = "";
  let rest = Math.floor(index) + 1;
  while (rest > 0) {
    name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

/** 0 for "A", 26 for "AA"; -1 when it isn't a column name. */
export function columnIndex(name: string): number {
  if (!/^[A-Za-z]{1,4}$/.test(name)) return -1;
  let index = 0;
  for (const letter of name.toUpperCase()) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

export interface CellAddress {
  row: number;
  col: number;
}

export interface CellRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** "B2" for row 1, column 1. */
export const cellName = (row: number, col: number): string => `${columnName(col)}${row + 1}`;

/** Row and column of "B2" (any case, `$` allowed), or null. */
export function parseCellName(name: string): CellAddress | null {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(name.trim());
  if (!match) return null;
  const col = columnIndex(match[1]!);
  const row = Number(match[2]) - 1;
  return col < 0 || row < 0 ? null : { row, col };
}

/** "B2:D9", or "B2" for one cell. */
export function rangeName(range: CellRange): string {
  const start = cellName(range.top, range.left);
  return range.top === range.bottom && range.left === range.right ? start : `${start}:${cellName(range.bottom, range.right)}`;
}

/** A range from "B2:D9" or "B2", corners in any order; null when it isn't one. */
export function parseRangeName(name: string): CellRange | null {
  const [a, b, extra] = name.split(":");
  if (extra !== undefined || !a) return null;
  const start = parseCellName(a);
  const end = b === undefined ? start : parseCellName(b);
  if (!start || !end) return null;
  return { top: Math.min(start.row, end.row), left: Math.min(start.col, end.col), bottom: Math.max(start.row, end.row), right: Math.max(start.col, end.col) };
}

export const rangeContains = (range: CellRange, row: number, col: number): boolean =>
  row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;

export const rangesOverlap = (a: CellRange, b: CellRange): boolean => a.top <= b.bottom && b.top <= a.bottom && a.left <= b.right && b.left <= a.right;

/** A sheet name as a formula writes it: bare when it is a plain word, else in single quotes with ' doubled. */
export function quoteSheet(name: string): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(TRUE|FALSE)$/i.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

/** A cell's name for people: "B2" on its own sheet, "Gear!B2" on another. */
export function cellLabel(row: number, col: number, sheet?: string): string {
  return sheet === undefined ? cellName(row, col) : `${quoteSheet(sheet)}!${cellName(row, col)}`;
}
