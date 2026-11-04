// The ready-made spreadsheets of New spreadsheet, made in the app's language: headers, a few example rows, formulas,
// a checkbox or dropdown column and a live-view range, so they show at once what the module can do.
import { dateSerial, storedDate } from "./formula/values";
import { DOC_VERSION, emptySheet, setFormat, setStyle, type Sheet, type SpreadsheetData } from "./model";

export const TEMPLATES = ["blank", "farming", "drops", "gear"] as const;
export type TemplateId = (typeof TEMPLATES)[number];

/** The words of a template, by key (`tpl.farming.name` and so on), in the language it is made in. */
export type TemplateText = (key: string) => string;

const bold = (sheet: Sheet, range: string) => {
  const [top, left, bottom, right] = corners(range);
  setStyle(sheet, { top, left, bottom, right }, { bold: true });
};
const corners = (range: string): [number, number, number, number] => {
  const match = /^([A-Z])(\d+):([A-Z])(\d+)$/.exec(range)!;
  return [Number(match[2]) - 1, match[1]!.charCodeAt(0) - 65, Number(match[4]) - 1, match[3]!.charCodeAt(0) - 65];
};
const area = (range: string) => {
  const [top, left, bottom, right] = corners(range);
  return { top, left, bottom, right };
};

function headed(id: string, name: string, headers: string[]): Sheet {
  const sheet = emptySheet(id, name);
  headers.forEach((header, col) => (sheet.cells[`${String.fromCharCode(65 + col)}1`] = header));
  bold(sheet, `A1:${String.fromCharCode(64 + headers.length)}1`);
  sheet.header = true;
  sheet.frozen = { rows: 1, cols: 0 };
  return sheet;
}

/** A new spreadsheet from a template. `today` is a day number, for the dates of the drop log. */
export function buildTemplate(id: TemplateId, t: TemplateText, createdAt: string, today: number): SpreadsheetData {
  const doc: SpreadsheetData = { version: DOC_VERSION, name: t(`tpl.${id}.name`), sheets: [], live: null, createdAt };
  if (id === "blank") {
    doc.sheets.push(emptySheet("s1", t("tpl.blank.sheet")));
    return doc;
  }
  if (id === "farming") {
    const sheet = headed("s1", t("tpl.farming.sheet"), [t("tpl.farming.item"), t("tpl.farming.need"), t("tpl.farming.have"), t("tpl.farming.missing"), t("tpl.farming.done")]);
    const rows: [string, number, number, boolean][] = [
      [t("tpl.farming.row1"), 40, 12, false],
      [t("tpl.farming.row2"), 25, 25, true],
      [t("tpl.farming.row3"), 100, 64, false],
      [t("tpl.farming.row4"), 12, 3, false],
      [t("tpl.farming.row5"), 5, 0, false],
    ];
    rows.forEach(([item, need, have, done], index) => {
      const row = index + 2;
      Object.assign(sheet.cells, { [`A${row}`]: item, [`B${row}`]: String(need), [`C${row}`]: String(have), [`D${row}`]: `=MAX(0,B${row}-C${row})`, [`E${row}`]: done ? "TRUE" : "FALSE" });
    });
    Object.assign(sheet.cells, { A8: t("tpl.farming.total"), D8: "=SUM(D2:D6)", E8: '=COUNTIF(E2:E6,TRUE)&"/"&COUNTA(A2:A6)' });
    bold(sheet, "A8:E8");
    setFormat(sheet, area("E2:E6"), { type: "checkbox" });
    setStyle(sheet, area("B1:E8"), { align: "right" });
    setStyle(sheet, area("E1:E6"), { align: "center" });
    setStyle(sheet, area("D2:D6"), { color: "warning" });
    sheet.colWidths = { 0: 160 };
    doc.sheets.push(sheet);
    doc.live = { sheet: "s1", range: "A1:E6" };
    return doc;
  }
  if (id === "drops") {
    const sheet = headed("s1", t("tpl.drops.sheet"), [t("tpl.drops.date"), t("tpl.drops.boss"), t("tpl.drops.runs"), t("tpl.drops.drops"), t("tpl.drops.rate")]);
    const bosses = [t("tpl.drops.boss1"), t("tpl.drops.boss2"), t("tpl.drops.boss3")];
    const rows: [number, number, number, number][] = [
      [3, 0, 5, 1],
      [2, 1, 8, 2],
      [1, 0, 3, 0],
      [0, 2, 10, 3],
    ];
    rows.forEach(([daysAgo, boss, runs, drops], index) => {
      const row = index + 2;
      Object.assign(sheet.cells, { [`A${row}`]: storedDate(today - daysAgo), [`B${row}`]: bosses[boss]!, [`C${row}`]: String(runs), [`D${row}`]: String(drops), [`E${row}`]: `=IFERROR(D${row}/C${row},0)` });
    });
    Object.assign(sheet.cells, { A7: t("tpl.drops.total"), C7: "=SUM(C2:C5)", D7: "=SUM(D2:D5)", E7: "=IFERROR(D7/C7,0)" });
    bold(sheet, "A7:E7");
    setFormat(sheet, area("A2:A6"), { type: "date" });
    setFormat(sheet, area("B2:B6"), { type: "dropdown", options: [{ value: bosses[0]!, color: "success" }, { value: bosses[1]!, color: "warning" }, { value: bosses[2]!, color: "destructive" }] });
    setFormat(sheet, area("E2:E7"), { type: "percent", decimals: 0 });
    setStyle(sheet, area("C1:E7"), { align: "right" });
    sheet.colWidths = { 0: 110, 1: 130 };
    doc.sheets.push(sheet);
    doc.live = { sheet: "s1", range: "A1:E7" };
    return doc;
  }
  const sheet = headed("s1", t("tpl.gear.sheet"), [t("tpl.gear.stat"), t("tpl.gear.current"), t("tpl.gear.new"), t("tpl.gear.difference"), t("tpl.gear.better")]);
  const rows: [string, number, number][] = [
    [t("tpl.gear.row1"), 120, 135],
    [t("tpl.gear.row2"), 80, 72],
    [t("tpl.gear.row3"), 0.05, 0.08],
    [t("tpl.gear.row4"), 1.2, 1.25],
  ];
  rows.forEach(([stat, current, next], index) => {
    const row = index + 2;
    Object.assign(sheet.cells, { [`A${row}`]: stat, [`B${row}`]: String(current), [`C${row}`]: String(next), [`D${row}`]: `=C${row}-B${row}`, [`E${row}`]: `=D${row}>0` });
  });
  Object.assign(sheet.cells, { A7: t("tpl.gear.total"), E7: '=COUNTIF(E2:E5,TRUE)&"/4"' });
  bold(sheet, "A7:E7");
  setFormat(sheet, area("B4:D4"), { type: "percent", decimals: 0 });
  setFormat(sheet, area("E2:E5"), { type: "checkbox" });
  setStyle(sheet, area("B1:D7"), { align: "right" });
  setStyle(sheet, area("E1:E7"), { align: "center" });
  sheet.colWidths = { 0: 140 };
  doc.sheets.push(sheet);
  doc.live = { sheet: "s1", range: "A1:E7" };
  return doc;
}

/** Today as a day number, in local time. */
export function todaySerial(now = new Date()): number {
  return dateSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
