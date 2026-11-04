// Excel files in and out, through ExcelJS (MIT), which is only loaded when one is opened or saved. In: every sheet
// with values, formulas (English, as Excel stores them), basic formats, bold/italic/align/wrap, sizes, frozen panes,
// dropdown lists, and colours mapped to the nearest of the six. Functions we don't have stay as they are and show
// #NAME?. Out: the same, with the six colours as Tavora Dark has them.
import type { Workbook as ExcelWorkbook, Worksheet, Cell } from "exceljs";
import { cellName, parseCellName, parseRangeName } from "./formula/refs";
import { isError, parseStoredDate, rawValue, storedDate, storedNumber, type Scalar } from "./formula/values";
import { DARK, hexRgb, type Rgb } from "./palette";
import { TooBig } from "./model";
import { COLORS, LIMITS, emptySheet, formatAt, styleAt, type CellFormat, type CellStyle, type ColorName, type Sheet, type SpreadsheetData } from "./model";


async function excel(): Promise<typeof import("exceljs")> {
  const module = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") } & typeof import("exceljs");
  return module.default ?? module;
}

// ── Colours

const argb = ([r, g, b]: Rgb) => `FF${[r, g, b].map((part) => Math.round(part).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

function hsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const light = (max + min) / 2;
  if (max === min) return [0, 0, light];
  const d = max - min;
  const sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60 : max === gn ? ((bn - rn) / d + 2) * 60 : ((rn - gn) / d + 4) * 60;
  return [hue, sat, light];
}

/**
 * The nearest of the six for an Excel colour, or null for black, white and near them (the plain text and paper).
 * Greys become muted; others go by hue.
 */
export function nearestColor(argbText: string | undefined, kind: "text" | "fill"): ColorName | null {
  if (!argbText || !/^[0-9a-f]{6,8}$/i.test(argbText)) return null;
  const rgb = hexRgb(argbText);
  const [hue, sat, light] = hsl(rgb);
  if (sat < 0.18) {
    if (kind === "text") return light > 0.25 && light < 0.8 ? "muted-foreground" : null;
    return light > 0.15 && light < 0.92 ? "muted-foreground" : null;
  }
  if (kind === "fill" && light > 0.97) return null;
  let best: ColorName = "primary";
  let distance = Infinity;
  for (const name of COLORS) {
    if (name === "muted-foreground") continue;
    const [otherHue] = hsl(DARK[name]);
    const gap = Math.min(Math.abs(hue - otherHue), 360 - Math.abs(hue - otherHue));
    if (gap < distance) {
      distance = gap;
      best = name;
    }
  }
  return best;
}

// ── In

const XLFN = /_xlfn\.|_xlws\./gi;
const EPOCH_MS = Date.UTC(1899, 11, 30);

function dateToStored(date: Date): string {
  const serial = (date.getTime() - EPOCH_MS) / 86_400_000;
  return storedDate(serial, Math.abs(serial - Math.round(serial)) > 1e-6);
}

function formatFromNumFmt(numFmt: string | undefined): CellFormat | null {
  if (!numFmt || numFmt === "General") return null;
  if (numFmt === "@") return { type: "text" };
  const plain = numFmt.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  const decimals = /\.(0+)/.exec(plain)?.[1]?.length ?? 0;
  if (plain.includes("%")) return { type: "percent", decimals };
  if (/[dmyh]/i.test(plain)) return { type: "date" };
  if (/[0#]/.test(plain)) return { type: "number", decimals, thousands: /#,##|0,0/.test(plain) };
  return null;
}

function styleFromCell(cell: Cell): CellStyle {
  const style: CellStyle = {};
  if (cell.font?.bold) style.bold = true;
  if (cell.font?.italic) style.italic = true;
  const align = cell.alignment?.horizontal;
  if (align === "left" || align === "center" || align === "right") style.align = align;
  if (cell.alignment?.wrapText) style.wrap = true;
  const color = nearestColor(cell.font?.color?.argb, "text");
  if (color) style.color = color;
  const fill = cell.fill;
  if (fill?.type === "pattern" && fill.pattern === "solid") {
    const fillColor = nearestColor(fill.fgColor?.argb, "fill");
    if (fillColor) style.fill = fillColor;
  }
  return style;
}

function rawFromCell(cell: Cell): string | null {
  const formula = (cell as unknown as { formula?: string }).formula;
  if (typeof formula === "string" && formula.trim()) return `=${formula.replace(XLFN, "").replace(/^=/, "")}`;
  const value = cell.value as unknown;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return storedNumber(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return dateToStored(value);
  if (typeof value === "string") return quoteText(value);
  if (typeof value === "object") {
    const object = value as { richText?: { text: string }[]; text?: unknown; hyperlink?: string; error?: string; result?: unknown };
    if (Array.isArray(object.richText)) return quoteText(object.richText.map((part) => part.text).join(""));
    if (typeof object.hyperlink === "string") return quoteText(typeof object.text === "string" ? object.text : object.hyperlink);
    if (typeof object.error === "string") return quoteText(object.error);
  }
  return null;
}

/** Text that would read as something else (a number, a date) keeps its leading '. */
function quoteText(text: string): string | null {
  if (text === "") return null;
  const read = rawValue(text);
  return typeof read === "string" && !text.startsWith("'") && !text.startsWith("=") ? text : `'${text}`;
}

/** Same-looking cells down a column, as few ranges as can be. */
function compress<T>(cells: Map<string, T>, keyOf: (value: T) => string): { range: string; value: T }[] {
  const byCol = new Map<number, { row: number; value: T; key: string }[]>();
  for (const [name, value] of cells) {
    const at = parseCellName(name)!;
    const list = byCol.get(at.col) ?? [];
    list.push({ row: at.row, value, key: keyOf(value) });
    byCol.set(at.col, list);
  }
  const out: { range: string; value: T }[] = [];
  for (const [col, list] of byCol) {
    list.sort((a, b) => a.row - b.row);
    let start = list[0]!;
    let end = start;
    for (const item of [...list.slice(1), null]) {
      if (item && item.key === start.key && item.row === end.row + 1) {
        end = item;
        continue;
      }
      out.push({ range: start.row === end.row ? cellName(start.row, col) : `${cellName(start.row, col)}:${cellName(end.row, col)}`, value: start.value });
      if (item) start = end = item;
    }
  }
  return out;
}

/** The sheets of an xlsx, refused whole when one is over a limit. */
export async function readXlsx(bytes: Uint8Array, sheetName: (index: number) => string): Promise<Sheet[]> {
  const Excel = await excel();
  const book: ExcelWorkbook = new Excel.Workbook();
  await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const worksheets = book.worksheets;
  if (worksheets.length > LIMITS.sheets) throw new TooBig("sheets");
  for (const ws of worksheets) {
    if (ws.rowCount > LIMITS.rows) throw new TooBig("rows");
    if (ws.columnCount > LIMITS.cols) throw new TooBig("cols");
  }
  const names = new Set<string>();
  return worksheets.map((ws, index) => {
    let name = (ws.name || sheetName(index)).slice(0, LIMITS.name);
    while (names.has(name.toLowerCase())) name = `${name.slice(0, LIMITS.name - 3)} ${index + 1}`;
    names.add(name.toLowerCase());
    return readWorksheet(ws, `s${index + 1}`, name);
  });
}

function readWorksheet(ws: Worksheet, id: string, name: string): Sheet {
  const sheet = emptySheet(id, name);
  const formats = new Map<string, CellFormat>();
  const styles = new Map<string, CellStyle>();
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (row.height && row.height > 21) sheet.rowHeights[rowNumber - 1] = Math.min(400, Math.round((row.height * 96) / 72));
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const at = cellName(rowNumber - 1, colNumber - 1);
      const raw = rawFromCell(cell);
      if (raw !== null) sheet.cells[at] = raw;
      let format = formatFromNumFmt(cell.numFmt);
      const value = cell.value as { hyperlink?: string } | null;
      if (value && typeof value === "object" && typeof value.hyperlink === "string" && /^https?:\/\//i.test(value.hyperlink)) {
        format = { type: "link" };
        sheet.cells[at] = value.hyperlink;
      }
      const validation = cell.dataValidation;
      if (validation?.type === "list" && validation.formulae?.[0] && /^".*"$/.test(String(validation.formulae[0]))) {
        const options = String(validation.formulae[0]).slice(1, -1).split(",").map((option) => option.trim()).filter(Boolean);
        if (options.length) format = { type: "dropdown", options: options.slice(0, 50).map((option) => ({ value: option, color: null })) };
      }
      if (format && !(format.type === "date" && raw && !parseStoredDate(raw) && typeof rawValue(raw) !== "number")) formats.set(at, format);
      const style = styleFromCell(cell);
      if (Object.keys(style).length) styles.set(at, style);
    });
  });
  sheet.formats = compress(formats, (format) => JSON.stringify(format)).map(({ range, value }) => ({ range, format: value as Sheet["formats"][number]["format"] }));
  sheet.styles = compress(styles, (style) => JSON.stringify(style)).map(({ range, value }) => ({ range, style: value as Sheet["styles"][number]["style"] }));
  (ws.columns ?? []).forEach((column, index) => {
    if (column?.width && index < LIMITS.cols) sheet.colWidths[index] = Math.max(24, Math.min(800, Math.round(column.width * 7 + 5)));
  });
  const view = ws.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
  if (view?.state === "frozen") sheet.frozen = { rows: Math.min(50, view.ySplit ?? 0), cols: Math.min(20, view.xSplit ?? 0) };
  return sheet;
}

// ── Out

function excelValue(value: Scalar): number | string | boolean | Date | { error: string } | undefined {
  if (value === null) return undefined;
  if (isError(value)) return value.error === "#CYCLE!" ? undefined : { error: value.error };
  return value;
}

function numFmt(format: CellFormat): string | undefined {
  switch (format.type) {
    case "number":
      return `${format.thousands ? "#,##0" : "0"}${format.decimals ? `.${"0".repeat(format.decimals)}` : ""}`;
    case "percent":
      return `0${format.decimals ? `.${"0".repeat(format.decimals)}` : ""}%`;
    case "date":
      return "mm-dd-yy";
    case "text":
      return "@";
    default:
      return undefined;
  }
}

/** A light tint of a colour over white, as a cell fill shows it in Tavora. */
const tint = (rgb: Rgb): Rgb => rgb.map((part) => part * 0.3 + 255 * 0.7) as Rgb;

/** A whole spreadsheet as xlsx bytes; `valueAt` gives each formula's worked-out value, so Excel shows it before it recalculates. */
export async function writeXlsx(doc: SpreadsheetData, valueAt: (sheetId: string, row: number, col: number) => Scalar): Promise<Uint8Array> {
  const Excel = await excel();
  const book: ExcelWorkbook = new Excel.Workbook();
  book.creator = "Tavora";
  for (const sheet of doc.sheets) {
    const ws = book.addWorksheet(sheet.name.slice(0, 31), sheet.frozen.rows || sheet.frozen.cols ? { views: [{ state: "frozen", xSplit: sheet.frozen.cols, ySplit: sheet.frozen.rows }] } : {});
    for (const [name, raw] of Object.entries(sheet.cells)) {
      const at = parseCellName(name)!;
      const cell = ws.getCell(at.row + 1, at.col + 1);
      const format = formatAt(sheet, at.row, at.col);
      if (raw.startsWith("=")) cell.value = { formula: raw.slice(1), result: excelValue(valueAt(sheet.id, at.row, at.col)) } as never;
      else if (format.type === "link" && /^https?:\/\//i.test(raw)) cell.value = { text: raw, hyperlink: raw };
      else {
        const date = parseStoredDate(raw);
        const value = rawValue(raw);
        cell.value = date !== null ? new Date(EPOCH_MS + Math.round(date * 86_400_000)) : (excelValue(value) as never);
        if (date !== null && format.type === "auto") cell.numFmt = "mm-dd-yy";
      }
    }
    // Formats and looks per cell of their ranges (only cells inside the used part, so whole columns stay cheap).
    const used = { rows: 0, cols: 0 };
    for (const name of Object.keys(sheet.cells)) {
      const at = parseCellName(name)!;
      used.rows = Math.max(used.rows, at.row + 1);
      used.cols = Math.max(used.cols, at.col + 1);
    }
    const touched = new Set<string>();
    for (const rule of [...sheet.formats, ...sheet.styles]) {
      const range = parseRangeName(rule.range);
      if (!range) continue;
      for (let row = range.top; row <= Math.min(range.bottom, used.rows + 20); row++) for (let col = range.left; col <= Math.min(range.right, used.cols + 5); col++) touched.add(`${row}:${col}`);
    }
    for (const key of touched) {
      const [row, col] = key.split(":").map(Number) as [number, number];
      const cell = ws.getCell(row + 1, col + 1);
      const format = formatAt(sheet, row, col);
      const fmt = numFmt(format);
      if (fmt) cell.numFmt = fmt;
      if (format.type === "dropdown" && format.options.length) cell.dataValidation = { type: "list", allowBlank: true, formulae: [`"${format.options.map((option) => option.value.replace(/[",]/g, " ")).join(",")}"`] };
      const style = styleAt(sheet, row, col);
      if (style.bold || style.italic || style.color) cell.font = { ...(style.bold ? { bold: true } : {}), ...(style.italic ? { italic: true } : {}), ...(style.color ? { color: { argb: argb(DARK[style.color]) } } : {}) };
      if (style.align || style.wrap) cell.alignment = { ...(style.align ? { horizontal: style.align } : {}), ...(style.wrap ? { wrapText: true } : {}) };
      if (style.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(tint(DARK[style.fill])) } };
    }
    for (const [col, width] of Object.entries(sheet.colWidths)) ws.getColumn(Number(col) + 1).width = Math.max(1, (width - 5) / 7);
    for (const [row, height] of Object.entries(sheet.rowHeights)) ws.getRow(Number(row) + 1).height = (height * 72) / 96;
  }
  const buffer = await book.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
