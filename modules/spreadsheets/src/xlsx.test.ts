import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { Workbook } from "./formula/engine";
import { formatAt, newSpreadsheet, setFormat, setStyle, styleAt, TooBig } from "./model";
import { nearestColor, readXlsx, writeXlsx } from "./xlsx";

async function bytesOf(build: (book: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  build(book);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe("xlsx import", () => {
  it("reads every sheet with values, formulas, formats, looks and frozen panes", async () => {
    const bytes = await bytesOf((book) => {
      const items = book.addWorksheet("Items", { views: [{ state: "frozen", ySplit: 1, xSplit: 0 }] });
      items.getCell("A1").value = "Item";
      items.getCell("A1").font = { bold: true, color: { argb: "FFFF0000" } };
      items.getCell("A2").value = "Iron";
      items.getCell("B2").value = 1.5;
      items.getCell("C2").value = { formula: "B2*2", result: 3 };
      items.getCell("D2").value = 0.25;
      items.getCell("D2").numFmt = "0%";
      items.getCell("E2").value = new Date(Date.UTC(2026, 10, 4));
      items.getCell("E2").numFmt = "dd.mm.yyyy";
      items.getCell("F2").value = { formula: "_xlfn.XLOOKUP(A2,A2:A3,B2:B3)", result: 1.5 };
      items.getCell("G2").value = { formula: "WEIRDFUNC(1)", result: 0 };
      items.getCell("H2").value = "007";
      items.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00B050" } };
      items.getColumn(1).width = 20;
      const runs = book.addWorksheet("Boss runs");
      runs.getCell("A1").value = { formula: "Items!B2+1", result: 2.5 };
    });
    const sheets = await readXlsx(bytes, (index) => `Sheet${index + 1}`);
    expect(sheets.map((sheet) => sheet.name)).toEqual(["Items", "Boss runs"]);
    const [items, runs] = sheets;
    expect(items!.cells).toMatchObject({ A1: "Item", A2: "Iron", B2: "1.5", C2: "=B2*2", D2: "0.25", E2: "2026-11-04", F2: "=XLOOKUP(A2,A2:A3,B2:B3)", G2: "=WEIRDFUNC(1)", H2: "'007" });
    expect(items!.frozen).toEqual({ rows: 1, cols: 0 });
    expect(items!.colWidths[0]).toBe(145);
    expect(styleAt(items!, 0, 0)).toEqual({ bold: true, color: "destructive" });
    expect(styleAt(items!, 1, 1)).toEqual({ fill: "success" });
    expect(formatAt(items!, 1, 3)).toEqual({ type: "percent", decimals: 0 });
    expect(formatAt(items!, 1, 4)).toEqual({ type: "date" });
    const wb = new Workbook(sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, cells: sheet.cells })));
    expect(wb.value(runs!.id, 0, 0)).toBe(2.5);
    expect(wb.value(items!.id, 1, 5)).toBe(1.5);
    // A function we don't have stays as written and shows #NAME?.
    expect(wb.value(items!.id, 1, 6)).toEqual({ error: "#NAME?" });
  });

  it("refuses a file over a limit before anything changes", async () => {
    const tooLong = await bytesOf((book) => (book.addWorksheet("Big").getCell(20_001, 1).value = 1));
    await expect(readXlsx(tooLong, () => "x")).rejects.toEqual(new TooBig("rows"));
    const tooWide = await bytesOf((book) => (book.addWorksheet("Wide").getCell(1, 201).value = 1));
    await expect(readXlsx(tooWide, () => "x")).rejects.toEqual(new TooBig("cols"));
  });

  it("maps colours to the nearest of the six, and leaves black, white and near them alone", () => {
    expect(nearestColor("FFFF0000", "text")).toBe("destructive");
    expect(nearestColor("FF0070C0", "text")).toBe("info");
    expect(nearestColor("FFFFC000", "fill")).toBe("warning");
    expect(nearestColor("FF808080", "text")).toBe("muted-foreground");
    expect(nearestColor("FF000000", "text")).toBeNull();
    expect(nearestColor("FFFFFFFF", "fill")).toBeNull();
    expect(nearestColor(undefined, "fill")).toBeNull();
  });
});

describe("xlsx export", () => {
  it("writes values, formulas with their results, formats and looks, and reads back the same", async () => {
    const doc = newSpreadsheet("Farm", "Items", "2026-11-04T00:00:00.000Z");
    const sheet = doc.sheets[0]!;
    sheet.cells = { A1: "Item", B1: "1.5", C1: "=B1*2", D1: "TRUE", E1: "2026-11-04", F1: "'007" };
    sheet.frozen = { rows: 1, cols: 0 };
    setStyle(sheet, { top: 0, left: 0, bottom: 0, right: 0 }, { bold: true, color: "info" });
    setFormat(sheet, { top: 0, left: 3, bottom: 0, right: 3 }, { type: "checkbox" });
    setFormat(sheet, { top: 0, left: 1, bottom: 0, right: 1 }, { type: "number", decimals: 2, thousands: true });
    const wb = new Workbook([{ id: sheet.id, name: sheet.name, cells: sheet.cells }]);
    const bytes = await writeXlsx(doc, (id, row, col) => wb.value(id, row, col));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes.buffer as ArrayBuffer);
    const ws = book.getWorksheet("Items")!;
    expect(ws.getCell("C1").value).toEqual({ formula: "B1*2", result: 3 });
    expect(ws.getCell("B1").numFmt).toBe("#,##0.00");
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("F1").value).toBe("007");
    const back = await readXlsx(bytes, () => "x");
    expect(back[0]!.cells).toMatchObject({ A1: "Item", B1: "1.5", C1: "=B1*2", D1: "TRUE", E1: "2026-11-04", F1: "'007" });
    expect(styleAt(back[0]!, 0, 0)).toEqual({ bold: true, color: "info" });
    expect(back[0]!.frozen).toEqual({ rows: 1, cols: 0 });
  });
});
