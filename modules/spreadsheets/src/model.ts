// A spreadsheet as it is saved: one store document with its sheets, their filled cells (in the stored, language-free
// form), formats and looks by range, sizes, frozen rows and columns, the filter, and the live-view range. Reading
// keeps every field it doesn't know (a newer copy may have written them), and never renames one.
import type { JsonValue } from "@tavora/sdk";
import { parseRangeName, rangeName, type CellRange } from "./formula/refs";

export const DOC_VERSION = 1;
export const LIMITS = { sheets: 50, rows: 20_000, cols: 200, bytes: 4 * 1024 * 1024, name: 60 } as const;
/** An import over a limit, refused before anything changed. */
export class TooBig extends Error {
  constructor(readonly limit: "sheets" | "rows" | "cols" | "bytes") {
    super(`too big: ${limit}`);
  }
}

/** The document ids of spreadsheets; the rest of the module's store is left alone. */
export const DOC_PREFIX = "sheet-";

/** The six theme colours a cell's text or fill can take, kept by name so they work in every theme. */
export const COLORS = ["primary", "destructive", "warning", "success", "info", "muted-foreground"] as const;
export type ColorName = (typeof COLORS)[number];
export const isColor = (value: unknown): value is ColorName => COLORS.includes(value as ColorName);

export interface DropdownOption {
  [key: string]: JsonValue;
  value: string;
  color: ColorName | null;
}

export type CellFormat =
  | { type: "auto" }
  | { type: "number"; decimals: number; thousands: boolean }
  | { type: "percent"; decimals: number }
  | { type: "text" }
  | { type: "checkbox" }
  | { type: "dropdown"; options: DropdownOption[] }
  | { type: "date" }
  | { type: "link" };
export type FormatType = CellFormat["type"];
export const FORMAT_TYPES: readonly FormatType[] = ["auto", "number", "percent", "text", "checkbox", "dropdown", "date", "link"];

export type Align = "left" | "center" | "right";
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  align?: Align;
  wrap?: boolean;
  color?: ColorName;
  fill?: ColorName;
}
export type StyleKey = keyof CellStyle;

export interface FormatRule {
  [key: string]: JsonValue;
  range: string;
  format: CellFormat & { [key: string]: JsonValue };
}

export interface StyleRule {
  [key: string]: JsonValue;
  range: string;
  style: CellStyle & { [key: string]: JsonValue };
}

/** What one column of the filter lets through; a row shows when every column lets it. */
export interface ColumnFilter {
  [key: string]: JsonValue;
  /** Shown texts that are ticked off in the values list. */
  hidden: string[];
  /** Only texts that contain this (any case). */
  contains: string;
  min: number | null;
  max: number | null;
  /** Only ticked (true) or not ticked (false) checkboxes. */
  checked: boolean | null;
}

export interface SheetFilter {
  [key: string]: JsonValue;
  /** By column index. */
  columns: { [col: string]: ColumnFilter };
}

export interface Sheet {
  [key: string]: JsonValue;
  id: string;
  name: string;
  /** Filled cells only, by name ("B2"): numbers as "1.5", dates as "2026-11-04", TRUE/FALSE, "'" before text that looks like more, "=" formulas in English form. */
  cells: { [name: string]: string };
  /** Later rules win. */
  formats: FormatRule[];
  styles: StyleRule[];
  colWidths: { [col: string]: number };
  rowHeights: { [row: string]: number };
  frozen: { rows: number; cols: number };
  /** The first row names the columns: it stays put when sorting and holds the filter's ▾. */
  header: boolean;
  filter: SheetFilter | null;
}

/** A range of a sheet, such as the live view's. */
export interface SheetRange {
  [key: string]: JsonValue;
  sheet: string;
  range: string;
}

export interface SpreadsheetData {
  [key: string]: JsonValue;
  version: number;
  name: string;
  sheets: Sheet[];
  /** What the live view shows when a panel hasn't picked its own range. */
  live: SheetRange | null;
  createdAt: string;
}

type Raw = { [key: string]: JsonValue };
const isObject = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const count = (value: unknown, max: number): number => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0);

function parseFormat(raw: unknown): (CellFormat & { [key: string]: JsonValue }) | null {
  if (!isObject(raw)) return null;
  const extra = raw as { [key: string]: JsonValue };
  switch (raw.type) {
    case "auto":
    case "text":
    case "checkbox":
    case "date":
    case "link":
      return { ...extra, type: raw.type };
    case "number":
      return { ...extra, type: "number", decimals: count(raw.decimals, 10), thousands: raw.thousands === true };
    case "percent":
      return { ...extra, type: "percent", decimals: count(raw.decimals, 10) };
    case "dropdown": {
      const options = (Array.isArray(raw.options) ? raw.options : []).filter(isObject).map((option) => ({ ...(option as { [key: string]: JsonValue }), value: text(option.value), color: isColor(option.color) ? option.color : null }));
      return { ...extra, type: "dropdown", options: options.filter((option) => option.value !== "") };
    }
    default:
      // A format a newer copy knows: shown as Automatic here, and kept.
      return typeof raw.type === "string" ? ({ ...extra, type: "auto" } as CellFormat & { [key: string]: JsonValue }) : null;
  }
}

function parseStyle(raw: unknown): (CellStyle & { [key: string]: JsonValue }) | null {
  if (!isObject(raw)) return null;
  const style: CellStyle & { [key: string]: JsonValue } = { ...(raw as { [key: string]: JsonValue }) };
  for (const key of ["bold", "italic", "wrap"] as const) if (key in style && typeof style[key] !== "boolean") delete style[key];
  if ("align" in style && !["left", "center", "right"].includes(style.align as string)) delete style.align;
  for (const key of ["color", "fill"] as const) if (key in style && !isColor(style[key])) delete style[key];
  return style;
}

function sizes(raw: unknown, min: number, max: number): { [index: string]: number } {
  const out: { [index: string]: number } = {};
  if (!isObject(raw)) return out;
  for (const [key, value] of Object.entries(raw)) if (/^\d+$/.test(key) && typeof value === "number" && Number.isFinite(value)) out[key] = Math.max(min, Math.min(max, Math.round(value)));
  return out;
}

function parseFilter(raw: unknown): SheetFilter | null {
  if (!isObject(raw) || !isObject(raw.columns)) return null;
  const columns: { [col: string]: ColumnFilter } = {};
  for (const [key, value] of Object.entries(raw.columns)) {
    if (!/^\d+$/.test(key) || !isObject(value)) continue;
    columns[key] = {
      ...(value as { [key: string]: JsonValue }),
      hidden: (Array.isArray(value.hidden) ? value.hidden : []).filter((item): item is string => typeof item === "string"),
      contains: text(value.contains),
      min: typeof value.min === "number" && Number.isFinite(value.min) ? value.min : null,
      max: typeof value.max === "number" && Number.isFinite(value.max) ? value.max : null,
      checked: typeof value.checked === "boolean" ? value.checked : null,
    };
  }
  return { ...(raw as { [key: string]: JsonValue }), columns };
}

export function parseSheet(raw: unknown, index: number): Sheet {
  const sheet = isObject(raw) ? raw : {};
  const cells: { [name: string]: string } = {};
  if (isObject(sheet.cells)) for (const [name, value] of Object.entries(sheet.cells)) if (/^[A-Z]{1,3}\d{1,5}$/.test(name) && typeof value === "string" && value !== "") cells[name] = value;
  const frozen = isObject(sheet.frozen) ? sheet.frozen : {};
  return {
    ...(sheet as { [key: string]: JsonValue }),
    id: text(sheet.id) || `s${index + 1}`,
    name: text(sheet.name) || `Sheet${index + 1}`,
    cells,
    formats: (Array.isArray(sheet.formats) ? sheet.formats : []).filter(isObject).flatMap((rule) => {
      const format = parseFormat(rule.format);
      return format && parseRangeName(text(rule.range)) ? [{ ...(rule as { [key: string]: JsonValue }), range: text(rule.range), format }] : [];
    }),
    styles: (Array.isArray(sheet.styles) ? sheet.styles : []).filter(isObject).flatMap((rule) => {
      const style = parseStyle(rule.style);
      return style && parseRangeName(text(rule.range)) ? [{ ...(rule as { [key: string]: JsonValue }), range: text(rule.range), style }] : [];
    }),
    colWidths: sizes(sheet.colWidths, 24, 800),
    rowHeights: sizes(sheet.rowHeights, 20, 400),
    frozen: { rows: count(frozen.rows, 50), cols: count(frozen.cols, 20) },
    header: sheet.header === true,
    filter: parseFilter(sheet.filter),
  };
}

/** A stored spreadsheet (or nothing yet: an empty one with one sheet). */
export function parseSpreadsheet(raw: JsonValue | null): SpreadsheetData {
  const doc = isObject(raw) ? raw : {};
  const sheets = (Array.isArray(doc.sheets) ? doc.sheets : []).map(parseSheet);
  // Two sheets can't share an id; a later one gets its own.
  const ids = new Set<string>();
  for (const [index, sheet] of sheets.entries()) {
    if (ids.has(sheet.id)) sheet.id = `${sheet.id}-${index}`;
    ids.add(sheet.id);
  }
  const live = isObject(doc.live) && typeof doc.live.sheet === "string" && parseRangeName(text(doc.live.range)) ? { ...(doc.live as { [key: string]: JsonValue }), sheet: doc.live.sheet, range: text(doc.live.range) } : null;
  return {
    ...(doc as { [key: string]: JsonValue }),
    version: typeof doc.version === "number" ? Math.max(DOC_VERSION, doc.version) : DOC_VERSION,
    name: text(doc.name),
    sheets: sheets.length ? sheets : [emptySheet("s1", "Sheet1")],
    live,
    createdAt: text(doc.createdAt),
  };
}

export function emptySheet(id: string, name: string): Sheet {
  return { id, name, cells: {}, formats: [], styles: [], colWidths: {}, rowHeights: {}, frozen: { rows: 0, cols: 0 }, header: false, filter: null };
}

export function newSpreadsheet(name: string, sheetName: string, createdAt: string): SpreadsheetData {
  return { version: DOC_VERSION, name, sheets: [emptySheet("s1", sheetName)], live: null, createdAt };
}

/** How big a document is when saved, in bytes. */
export const documentBytes = (doc: SpreadsheetData): number => new TextEncoder().encode(JSON.stringify(doc)).length;

// ── Formats and looks by cell

const parsedRanges = new WeakMap<object, (CellRange | null)[]>();
function rangesOf(rules: readonly { range: string }[]): (CellRange | null)[] {
  let ranges = parsedRanges.get(rules);
  if (!ranges) parsedRanges.set(rules, (ranges = rules.map((rule) => parseRangeName(rule.range))));
  return ranges;
}

const AUTO: CellFormat = { type: "auto" };

/** A cell's format: the last rule covering it wins. */
export function formatAt(sheet: Sheet, row: number, col: number): CellFormat {
  const ranges = rangesOf(sheet.formats);
  for (let i = sheet.formats.length - 1; i >= 0; i--) {
    const range = ranges[i];
    if (range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right) return sheet.formats[i]!.format;
  }
  return AUTO;
}

/** A cell's look: every rule covering it, later ones on top. */
export function styleAt(sheet: Sheet, row: number, col: number): CellStyle {
  const ranges = rangesOf(sheet.styles);
  let style: CellStyle = {};
  for (let i = 0; i < sheet.styles.length; i++) {
    const range = ranges[i];
    if (range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right) style = { ...style, ...(sheet.styles[i]!.style as CellStyle) };
  }
  return style;
}

const covers = (outer: CellRange, inner: CellRange) => outer.top <= inner.top && outer.left <= inner.left && outer.bottom >= inner.bottom && outer.right >= inner.right;

/** Gives a range a format; older rules it covers whole are dropped, so the list doesn't grow with every click. */
export function setFormat(sheet: Sheet, range: CellRange, format: CellFormat): void {
  sheet.formats = sheet.formats.filter((rule) => {
    const old = parseRangeName(rule.range);
    return !old || !covers(range, old);
  });
  if (format.type !== "auto" || sheet.formats.some((rule) => rangesOverlapName(rule.range, range))) sheet.formats.push({ range: rangeName(range), format: { ...format } as FormatRule["format"] });
}

function rangesOverlapName(name: string, range: CellRange): boolean {
  const other = parseRangeName(name);
  return !!other && other.top <= range.bottom && range.top <= other.bottom && other.left <= range.right && range.left <= other.right;
}

/** Changes some of a range's looks; older rules it covers whole lose those looks (and go when nothing is left). */
export function setStyle(sheet: Sheet, range: CellRange, change: CellStyle): void {
  const keys = Object.keys(change) as StyleKey[];
  sheet.styles = sheet.styles.flatMap((rule) => {
    const old = parseRangeName(rule.range);
    if (!old || !covers(range, old)) return [rule];
    const style = { ...rule.style };
    for (const key of keys) delete style[key];
    return Object.keys(style).length ? [{ ...rule, style }] : [];
  });
  const kept = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined && value !== false)) as CellStyle;
  // Turning something off only needs a rule where an older one still turns it on.
  const needed = Object.keys(kept).length > 0 || keys.some((key) => sheet.styles.some((rule) => key in rule.style && rangesOverlapName(rule.range, range)));
  if (needed) sheet.styles.push({ range: rangeName(range), style: { ...change } as StyleRule["style"] });
}

// ── Finding sheets

export const sheetById = (doc: SpreadsheetData, id: string): Sheet | undefined => doc.sheets.find((sheet) => sheet.id === id);
export const sheetByName = (doc: SpreadsheetData, name: string): Sheet | undefined => doc.sheets.find((sheet) => sheet.name.toLowerCase() === name.toLowerCase());

/** The first free "Sheet3"-style name. */
export function freeSheetName(doc: SpreadsheetData, base: string): string {
  for (let n = doc.sheets.length + 1; ; n++) if (!sheetByName(doc, `${base}${n}`)) return `${base}${n}`;
}

/** How far a sheet is used: one past its last filled row and column. */
export function usedSize(sheet: Sheet): { rows: number; cols: number } {
  let rows = 0;
  let cols = 0;
  for (const name of Object.keys(sheet.cells)) {
    const at = /^([A-Z]+)(\d+)$/.exec(name);
    if (!at) continue;
    rows = Math.max(rows, Number(at[2]));
    let col = 0;
    for (const letter of at[1]!) col = col * 26 + letter.charCodeAt(0) - 64;
    cols = Math.max(cols, col);
  }
  return { rows, cols };
}
