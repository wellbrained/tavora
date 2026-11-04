// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseHtmlTable, parseTsv, readClipboard, toTsv, writeClipboard, TAVORA_TYPE } from "./clipboard";
import { readCsv, writeCsv } from "./csv";
import { displayValue, inputToStored, parseLocalDate, parseLocalNumber, storedToInput } from "./display";
import { Workbook } from "./formula/engine";
import { dateSerial } from "./formula/values";
import { History, diff, replay } from "./history";
import { formatAt, newSpreadsheet, parseSpreadsheet, setFormat, setStyle, styleAt, type SpreadsheetData } from "./model";
import { addSheet, deleteSheet, renameSheet, setCells, shiftSheet } from "./ops";
import { fillCells, hiddenRows, sortOrder, sortedCells } from "./table";

const texts = { yes: "TRUE", no: "FALSE" };
const AUTO = { type: "auto" } as const;

function doc(cells: Record<string, string>, more: Record<string, Record<string, string>> = {}): SpreadsheetData {
  const data = newSpreadsheet("Test", "Sheet1", "2026-11-04T00:00:00.000Z");
  data.sheets[0]!.cells = { ...cells };
  for (const [name, sheetCells] of Object.entries(more)) {
    addSheet(data, `id-${name}`, name);
    data.sheets.at(-1)!.cells = { ...sheetCells };
  }
  return data;
}
const values = (data: SpreadsheetData) => new Workbook(data.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, cells: sheet.cells })));

describe("saved data", () => {
  it("opens a document from a newer copy and keeps what it doesn't know", () => {
    const raw = {
      version: 2,
      name: "Farm",
      future: { keep: true },
      sheets: [{ id: "a", name: "Items", cells: { A1: "Iron", B2: "=A1", bad: "x" }, formats: [{ range: "B1:B9", format: { type: "sparkle", glow: 1 } }], tint: "x", frozen: { rows: 1 } }],
      live: { sheet: "a", range: "A1:B5" },
    };
    const parsed = parseSpreadsheet(raw);
    expect(parsed.future).toEqual({ keep: true });
    expect(parsed.version).toBe(2);
    expect(parsed.sheets[0]!.tint).toBe("x");
    expect(parsed.sheets[0]!.cells).toEqual({ A1: "Iron", B2: "=A1" });
    // A format it doesn't know shows as Automatic and stays in the data.
    expect(formatAt(parsed.sheets[0]!, 3, 1)).toMatchObject({ type: "auto", glow: 1 });
    expect(parsed.sheets[0]!.frozen).toEqual({ rows: 1, cols: 0 });
    expect(parsed.live).toEqual({ sheet: "a", range: "A1:B5" });
  });

  it("makes an empty spreadsheet for a missing document", () => {
    const parsed = parseSpreadsheet(null);
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.version).toBe(1);
  });

  it("keeps formats and looks short", () => {
    const sheet = doc({}).sheets[0]!;
    setStyle(sheet, { top: 0, left: 0, bottom: 0, right: 0 }, { bold: true });
    setStyle(sheet, { top: 0, left: 0, bottom: 4, right: 1 }, { italic: true });
    expect(styleAt(sheet, 0, 0)).toEqual({ bold: true, italic: true });
    setStyle(sheet, { top: 0, left: 0, bottom: 9, right: 9 }, { bold: false, italic: false });
    // Nothing older turns them on any more, so no rule is needed for "off".
    expect(styleAt(sheet, 0, 0)).toEqual({});
    expect(sheet.styles).toHaveLength(0);
    setFormat(sheet, { top: 0, left: 0, bottom: 9, right: 0 }, { type: "checkbox" });
    setFormat(sheet, { top: 0, left: 0, bottom: 9, right: 0 }, { type: "percent", decimals: 1 });
    expect(sheet.formats).toHaveLength(1);
    expect(formatAt(sheet, 3, 0)).toEqual({ type: "percent", decimals: 1 });
  });
});

describe("rows, columns and sheets", () => {
  it("rewrite formulas on every sheet when rows go in or out", () => {
    const data = doc({ A1: "1", A2: "2", A3: "=SUM(A1:A2)", B3: "=A2*2" }, { Gear: { A1: "=Sheet1!A2+1" } });
    shiftSheet(data, "s1", "row", 1, 2);
    expect(data.sheets[0]!.cells).toEqual({ A1: "1", A4: "2", A5: "=SUM(A1:A4)", B5: "=A4*2" });
    expect(data.sheets[1]!.cells.A1).toBe("=Sheet1!A4+1");
    shiftSheet(data, "s1", "row", 3, -1);
    expect(data.sheets[0]!.cells).toEqual({ A1: "1", A4: "=SUM(A1:A3)", B4: "=#REF!*2" });
    expect(data.sheets[1]!.cells.A1).toBe("=#REF!+1");
  });

  it("move formats, sizes and the filter with columns", () => {
    const data = doc({ B1: "x" });
    const sheet = data.sheets[0]!;
    setFormat(sheet, { top: 0, left: 1, bottom: 9, right: 1 }, { type: "checkbox" });
    sheet.colWidths = { 1: 140 };
    sheet.filter = { columns: { 1: { hidden: ["x"], contains: "", min: null, max: null, checked: null } } };
    data.live = { sheet: "s1", range: "A1:C5" };
    shiftSheet(data, "s1", "col", 0, 1);
    expect(sheet.cells).toEqual({ C1: "x" });
    expect(sheet.formats[0]!.range).toBe("C1:C10");
    expect(sheet.colWidths).toEqual({ 2: 140 });
    expect(Object.keys(sheet.filter.columns)).toEqual(["2"]);
    expect(data.live.range).toBe("B1:D5");
  });

  it("keep references to a renamed sheet, also with spaces and quotes", () => {
    const data = doc({ A1: "=Gear!B2*2" }, { Gear: { B2: "21" } });
    renameSheet(data, "id-Gear", "Boss runs");
    expect(data.sheets[0]!.cells.A1).toBe("='Boss runs'!B2*2");
    expect(values(data).value("s1", 0, 0)).toBe(42);
    renameSheet(data, "id-Gear", "Nik's runs");
    expect(data.sheets[0]!.cells.A1).toBe("='Nik''s runs'!B2*2");
    expect(values(data).value("s1", 0, 0)).toBe(42);
  });

  it("turn references to a deleted sheet into #REF!, and undo brings sheet, cells and formulas back exactly", () => {
    const data = doc({ A1: "=Gear!B2*2" }, { Gear: { B2: "21" } });
    const before = structuredClone(data);
    deleteSheet(data, "id-Gear");
    expect(data.sheets).toHaveLength(1);
    expect(data.sheets[0]!.cells.A1).toBe("=#REF!*2");
    const changes = diff(before, data);
    const { skipped } = replay(data, changes, "undo");
    expect(skipped).toBe(0);
    expect(data).toEqual(before);
    expect(values(data).value("s1", 0, 0)).toBe(42);
  });

  it("undo puts inserted rows back exactly", () => {
    const data = doc({ A1: "1", A2: "=A1+1", A3: "=SUM(A1:A2)" });
    const before = structuredClone(data);
    shiftSheet(data, "s1", "row", 1, 1);
    replay(data, diff(before, data), "undo");
    expect(data).toEqual(before);
  });
});

describe("undo next to another panel", () => {
  it("keeps a newer value another panel wrote, and says so", () => {
    const data = doc({ A1: "1", B1: "2" });
    const history = new History();
    const before = structuredClone(data);
    setCells(data.sheets[0]!, [["A1", "10"], ["B1", "20"]]);
    history.record("Edit", before, data);
    // Another panel changes A1 again.
    data.sheets[0]!.cells.A1 = "99";
    const step = history.takeUndo()!;
    const { done, skipped } = replay(data, step.changes, "undo");
    expect(skipped).toBe(1);
    expect(data.sheets[0]!.cells).toEqual({ A1: "99", B1: "2" });
    history.pushRedo({ ...step, changes: done });
    const redo = history.takeRedo()!;
    replay(data, redo.changes, "redo");
    expect(data.sheets[0]!.cells).toEqual({ A1: "99", B1: "20" });
  });

  it("keeps at most 100 steps", () => {
    const history = new History();
    const data = doc({});
    for (let i = 0; i < 120; i++) {
      const before = structuredClone(data);
      data.sheets[0]!.cells.A1 = String(i);
      history.record("Edit", before, data);
    }
    let steps = 0;
    while (history.takeUndo()) steps++;
    expect(steps).toBe(100);
  });
});

describe("typing in a language", () => {
  it("reads numbers the German and the English way", () => {
    expect(parseLocalNumber("1,5", "de")).toBe(1.5);
    expect(parseLocalNumber("1.234,5", "de")).toBe(1234.5);
    expect(parseLocalNumber("1.5", "de")).toBe(1.5);
    expect(parseLocalNumber("1,234.5", "en")).toBe(1234.5);
    expect(parseLocalNumber("1,5", "en")).toBeNull();
    expect(parseLocalNumber("abc", "en")).toBeNull();
  });

  it("reads dates", () => {
    expect(parseLocalDate("4.11.2026", "de")).toBe(dateSerial(2026, 11, 4));
    expect(parseLocalDate("04.11.26", "de")).toBe(dateSerial(2026, 11, 4));
    expect(parseLocalDate("11/4/2026", "en")).toBe(dateSerial(2026, 11, 4));
    expect(parseLocalDate("2026-11-04", "de")).toBe(dateSerial(2026, 11, 4));
    expect(parseLocalDate("31.2.2026", "de")).toBeNull();
  });

  it("stores what is typed without the language", () => {
    expect(inputToStored("1,5", AUTO, "de").raw).toBe("1.5");
    expect(inputToStored("=ROUND(A1;2)", AUTO, "de").raw).toBe("=ROUND(A1,2)");
    expect(inputToStored("=ROUND(A1,2)", AUTO, "de").raw).toBe("=ROUND(A1,2)");
    expect(inputToStored("4.11.2026", AUTO, "de").raw).toBe("2026-11-04");
    expect(inputToStored("50 %", AUTO, "de")).toEqual({ raw: "0.5", format: { type: "percent", decimals: 0 } });
    expect(inputToStored("50", { type: "percent", decimals: 0 }, "en").raw).toBe("0.5");
    expect(inputToStored("wahr", AUTO, "de").raw).toBe("TRUE");
    expect(inputToStored("x", { type: "checkbox" }, "en").raw).toBe("TRUE");
    expect(inputToStored("007", { type: "text" }, "en").raw).toBe("'007");
    expect(inputToStored("Iron ore", AUTO, "en").raw).toBe("Iron ore");
    expect(inputToStored("2026-11-04", { type: "text" }, "en").raw).toBe("'2026-11-04");
  });

  it("shows stored cells in the language, and back without change", () => {
    expect(storedToInput("1.5", AUTO, "de")).toBe("1,5");
    expect(storedToInput("=ROUND(A1*1.5,2)", AUTO, "de")).toBe("=ROUND(A1*1,5;2)");
    expect(storedToInput("2026-11-04", AUTO, "de")).toBe("04.11.2026");
    expect(storedToInput("2026-11-04", AUTO, "en")).toBe("11/4/2026");
    expect(storedToInput("0.25", { type: "percent", decimals: 0 }, "de")).toBe("25 %");
    for (const raw of ["1.5", "=SUM(A1:A3,2.5)", "2026-11-04", "Iron", "TRUE"]) {
      for (const lang of ["en", "de"] as const) expect(inputToStored(storedToInput(raw, AUTO, lang), AUTO, lang).raw).toBe(raw);
    }
  });

  it("switching the language changes how it looks, not what is stored", () => {
    expect(displayValue(1234.5, undefined, AUTO, "de", texts)).toBe("1234,5");
    expect(displayValue(1234.5, undefined, AUTO, "en", texts)).toBe("1234.5");
    expect(displayValue(1234.5, undefined, { type: "number", decimals: 2, thousands: true }, "de", texts)).toBe("1.234,50");
    expect(displayValue(0.125, undefined, { type: "percent", decimals: 1 }, "en", texts)).toBe("12.5%");
    expect(displayValue(dateSerial(2026, 11, 4), "date", AUTO, "de", texts)).toBe("04.11.2026");
  });
});

describe("fill", () => {
  const rawAt = (cells: Record<string, string>) => (row: number, col: number) => cells[`${String.fromCharCode(65 + col)}${row + 1}`];

  it("continues 1, 2 and dates, copies the rest", () => {
    const cells = { A1: "1", A2: "2", B1: "2026-11-04", C1: "Iron", D1: "Run 1", E1: "=A1*2" };
    expect(fillCells({ source: { top: 0, left: 0, bottom: 1, right: 0 }, target: { top: 2, left: 0, bottom: 4, right: 0 }, direction: "down" }, rawAt(cells), "series")).toEqual([
      ["A3", "3"],
      ["A4", "4"],
      ["A5", "5"],
    ]);
    expect(fillCells({ source: { top: 0, left: 1, bottom: 0, right: 1 }, target: { top: 1, left: 1, bottom: 2, right: 1 }, direction: "down" }, rawAt(cells), "series").map(([, raw]) => raw)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(fillCells({ source: { top: 0, left: 2, bottom: 0, right: 2 }, target: { top: 1, left: 2, bottom: 2, right: 2 }, direction: "down" }, rawAt(cells), "series").map(([, raw]) => raw)).toEqual(["Iron", "Iron"]);
    expect(fillCells({ source: { top: 0, left: 3, bottom: 0, right: 3 }, target: { top: 1, left: 3, bottom: 2, right: 3 }, direction: "down" }, rawAt(cells), "series").map(([, raw]) => raw)).toEqual(["Run 2", "Run 3"]);
    expect(fillCells({ source: { top: 0, left: 4, bottom: 0, right: 4 }, target: { top: 1, left: 4, bottom: 2, right: 4 }, direction: "down" }, rawAt(cells), "series").map(([, raw]) => raw)).toEqual(["=A2*2", "=A3*2"]);
  });

  it("copies with Ctrl+D, and goes up too", () => {
    const cells = { A1: "1", A2: "2" };
    expect(fillCells({ source: { top: 0, left: 0, bottom: 1, right: 0 }, target: { top: 2, left: 0, bottom: 4, right: 0 }, direction: "down" }, rawAt(cells), "copy").map(([, raw]) => raw)).toEqual(["1", "2", "1"]);
    const up = { A5: "5", A6: "6" };
    expect(fillCells({ source: { top: 4, left: 0, bottom: 5, right: 0 }, target: { top: 2, left: 0, bottom: 3, right: 0 }, direction: "up" }, rawAt(up), "series")).toEqual([
      ["A3", "3"],
      ["A4", "4"],
    ]);
  });
});

describe("sort and filter", () => {
  it("sorts by several columns, empty cells last, formulas moved with their rows", () => {
    const data = doc({ A1: "Item", A2: "b", B2: "2", A3: "a", B3: "9", A4: "b", B4: "1", B5: "5", C2: "=B2*2", C3: "=B3*2", C4: "=B4*2", C5: "=B5*2" });
    const wb = values(data);
    const order = sortOrder(1, 4, [{ col: 0, descending: false }, { col: 1, descending: true }], (row, col) => wb.value("s1", row, col));
    expect(order).toEqual([2, 1, 3, 4]);
    const cells = Object.fromEntries(sortedCells(order, 1, 0, 2, (row, col) => data.sheets[0]!.cells[`${String.fromCharCode(65 + col)}${row + 1}`]));
    expect(cells).toMatchObject({ A2: "a", B2: "9", C2: "=B2*2", A3: "b", B3: "2", C3: "=B3*2", A5: null, B5: "5", C5: "=B5*2" });
  });

  it("hides rows that don't get through, below the header", () => {
    const shown: Record<string, string> = { "1:0": "Iron", "2:0": "Copper", "3:0": "Iron ore", "1:1": "TRUE", "2:1": "FALSE", "3:1": "TRUE" };
    const filter = { columns: { 0: { hidden: [], contains: "iron", min: null, max: null, checked: null }, 1: { hidden: [], contains: "", min: null, max: null, checked: true } } };
    const hidden = hiddenRows(filter, 1, 4, (row, col) => shown[`${row}:${col}`] ?? "", (row, col) => (col === 1 ? shown[`${row}:${col}`] === "TRUE" : (shown[`${row}:${col}`] ?? null)));
    expect([...hidden]).toEqual([2]);
  });
});

describe("clipboard", () => {
  it("reads tab-separated text with quoted cells holding tabs and line breaks", () => {
    expect(parseTsv('a\t"b\tc"\n"line\none"\t"say ""hi"""\r\n')).toEqual([
      ["a", "b\tc"],
      ["line\none", 'say "hi"'],
    ]);
    expect(toTsv([["a", "b\tc"], ["x\ny", ""]])).toBe('a\t"b\tc"\n"x\ny"\t');
  });

  it("reads an Excel table with numbers and bold from classes", () => {
    const html = `<html><head><style>.xl65{font-weight:700;}</style></head><body><table><tr><td class="xl65">Item</td><td x:num="1.5">1,5</td></tr><tr><td><b>Bold</b></td><td data-sheets-value='{"1":3,"3":42}'>42</td></tr></table></body></html>`;
    expect(parseHtmlTable(html)).toEqual([
      [{ text: "Item", bold: true }, { text: "1,5", raw: "1.5" }],
      [{ text: "Bold", bold: true }, { text: "42", raw: "42" }],
    ]);
  });

  it("goes out as text, a table and Tavora's own cells, and comes back as Tavora's", () => {
    const store = new Map<string, string>();
    const data = { setData: (type: string, value: string) => store.set(type, value), getData: (type: string) => store.get(type) ?? "" } as unknown as DataTransfer;
    writeClipboard(data, [[{ text: "2", raw: "=A1*2", bold: true, italic: false }]], { top: 0, left: 1 });
    expect(store.get("text/plain")).toBe("2");
    expect(store.get("text/html")).toContain("font-weight:bold");
    expect(store.has(TAVORA_TYPE)).toBe(true);
    expect(readClipboard(data)).toEqual({ from: { top: 0, left: 1 }, rows: [[{ raw: "=A1*2", bold: true }]] });
  });
});

describe("CSV", () => {
  it("reads commas, quotes, line breaks and a byte-order mark", () => {
    const table = readCsv('﻿Item,Note\r\n"Iron, ore","say ""hi""\nthere"\r\n', "en");
    expect(table).toEqual({ rows: [["Item", "Note"], ["Iron, ore", 'say "hi"\nthere']], lang: "en" });
  });

  it("reads German semicolon files as German", () => {
    expect(readCsv("Item;Menge\nEisen;1,5\n", "en")).toEqual({ rows: [["Item", "Menge"], ["Eisen", "1,5"]], lang: "de" });
  });

  it("writes in the language, quoting what needs it", () => {
    expect(writeCsv([["a;b", "1,5"]], "de")).toBe('﻿"a;b";1,5\r\n');
    expect(writeCsv([["a,b", 'x"y']], "en")).toBe('﻿"a,b","x""y"\r\n');
  });
});
