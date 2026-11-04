// Copy and paste with Excel, Google Sheets and other Tavora panels. Out go tab-separated text and an HTML table of
// the values (bold kept), plus the stored cells for Tavora, so formulas pasted in another spreadsheet move along.
// In comes whichever is best: Tavora's own cells, an HTML table, or tab-separated text with quoted cells.

export const TAVORA_TYPE = "application/x-tavora-cells";

export interface CopiedCell {
  /** What other apps get. */
  text: string;
  /** The stored form, for Tavora (a formula keeps working when pasted). */
  raw: string | null;
  bold: boolean;
  italic: boolean;
}

/** Cells on their way in: either Tavora's stored cells, or texts from another app to read like typing. */
export interface PastedCells {
  rows: PastedCell[][];
  /** Where the cells were copied from, when Tavora copied them: formulas move by the distance. */
  from: { top: number; left: number } | null;
}

export interface PastedCell {
  /** Stored as it is (from Tavora, or a number Excel gave as one). */
  raw?: string;
  /** Typed text, read in the user's language. */
  text?: string;
  bold?: boolean;
  italic?: boolean;
}

interface TavoraPayload {
  v: 1;
  top: number;
  left: number;
  cells: { raw: string | null; bold?: boolean; italic?: boolean }[][];
}

// ── Out

/** One cell of tab-separated text, quoted when it holds a tab, a line break or a quote (as Excel does). */
function tsvCell(text: string): string {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(tsvCell).join("\t")).join("\n");
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHtml(rows: readonly (readonly CopiedCell[])[]): string {
  const body = rows
    .map((row) => `<tr>${row.map((cell) => {
      const style = [cell.bold ? "font-weight:bold" : "", cell.italic ? "font-style:italic" : ""].filter(Boolean).join(";");
      const text = escapeHtml(cell.text).replace(/\n/g, "<br>");
      return `<td${style ? ` style="${style}"` : ""}>${text}</td>`;
    }).join("")}</tr>`)
    .join("");
  return `<table><tbody>${body}</tbody></table>`;
}

/** Fills a copy or cut event with all three forms. */
export function writeClipboard(data: DataTransfer, rows: readonly (readonly CopiedCell[])[], from: { top: number; left: number }): void {
  data.setData("text/plain", toTsv(rows.map((row) => row.map((cell) => cell.text))));
  data.setData("text/html", toHtml(rows));
  const payload: TavoraPayload = { v: 1, top: from.top, left: from.left, cells: rows.map((row) => row.map((cell) => ({ raw: cell.raw, ...(cell.bold ? { bold: true } : {}), ...(cell.italic ? { italic: true } : {}) }))) };
  try {
    data.setData(TAVORA_TYPE, JSON.stringify(payload));
  } catch {
    // A browser that refuses own types still gets the text and the table.
  }
}

// ── In

/** Tab-separated text as rows of cells, with Excel's quoting ("a<tab>b" in quotes, "" for a quote). */
export function parseTsv(text: string): string[][] {
  return parseDelimited(text.replace(/\r\n?/g, "\n").replace(/\n$/, ""), "\t");
}

/** Rows of a delimited text: quoted fields may hold the delimiter, line breaks and "" for a quote. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let at = 0;
  let fieldStart = true;
  while (at < text.length) {
    const char = text[at]!;
    if (quoted) {
      if (char === '"') {
        if (text[at + 1] === '"') {
          field += '"';
          at += 2;
          continue;
        }
        quoted = false;
        at++;
        continue;
      }
      field += char;
      at++;
      continue;
    }
    if (char === '"' && fieldStart) {
      quoted = true;
      fieldStart = false;
      at++;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      fieldStart = true;
      at++;
      continue;
    }
    if (char === "\n" || char === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStart = true;
      at += char === "\r" && text[at + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += char;
    fieldStart = false;
    at++;
  }
  if (field !== "" || row.length || !fieldStart) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The first table of an HTML clipboard (Excel, Google Sheets, a web page), with bold and italic. */
export function parseHtmlTable(html: string): PastedCell[][] | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table");
  if (!table) return null;
  // Excel puts the looks in classes in a style sheet.
  const classLooks = new Map<string, { bold: boolean; italic: boolean }>();
  for (const style of doc.querySelectorAll("style")) {
    for (const match of (style.textContent ?? "").matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const body = match[2]!.toLowerCase();
      classLooks.set(match[1]!, { bold: /font-weight:\s*(bold|[6-9]00)/.test(body), italic: /font-style:\s*italic/.test(body) });
    }
  }
  const rows: PastedCell[][] = [];
  for (const tr of table.querySelectorAll("tr")) {
    const row: PastedCell[] = [];
    for (const td of tr.querySelectorAll("td, th")) {
      const element = td as HTMLElement;
      const inline = (element.getAttribute("style") ?? "").toLowerCase();
      const fromClass = [...element.classList].map((name) => classLooks.get(name)).find(Boolean);
      const bold = td.tagName === "TH" || !!element.querySelector("b, strong") || /font-weight:\s*(bold|[6-9]00)/.test(inline) || !!fromClass?.bold;
      const italic = !!element.querySelector("i, em") || /font-style:\s*italic/.test(inline) || !!fromClass?.italic;
      for (const br of element.querySelectorAll("br")) br.replaceWith("\n");
      const text = (element.textContent ?? "").replace(/ /g, " ");
      const cell: PastedCell = { text, ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) };
      // Excel gives the plain number in x:num, Google Sheets in data-sheets-value: language-free, so better than the text.
      const excelNumber = element.getAttribute("x:num");
      const sheetsValue = element.getAttribute("data-sheets-value");
      if (excelNumber && Number.isFinite(Number(excelNumber))) cell.raw = String(Number(excelNumber));
      else if (sheetsValue) {
        try {
          const value = JSON.parse(sheetsValue) as Record<string, unknown>;
          if (typeof value["3"] === "number") cell.raw = String(value["3"]);
          else if (typeof value["4"] === "number" || typeof value["4"] === "boolean") cell.raw = value["4"] ? "TRUE" : "FALSE";
        } catch {
          // Not what we thought; the text will do.
        }
      }
      const span = Math.max(1, Math.min(200, Number(element.getAttribute("colspan")) || 1));
      row.push(cell);
      for (let extra = 1; extra < span; extra++) row.push({ text: "" });
    }
    rows.push(row);
  }
  return rows.length ? rows : null;
}

/** What a paste event brings, best form first. */
export function readClipboard(data: DataTransfer): PastedCells | null {
  const own = data.getData(TAVORA_TYPE);
  if (own) {
    try {
      const payload = JSON.parse(own) as TavoraPayload;
      if (payload.v === 1 && Array.isArray(payload.cells)) {
        return {
          from: { top: payload.top, left: payload.left },
          rows: payload.cells.map((row) => row.map((cell) => ({ raw: cell.raw ?? "", ...(cell.bold ? { bold: true } : {}), ...(cell.italic ? { italic: true } : {}) }))),
        };
      }
    } catch {
      // Fall back to the other forms.
    }
  }
  const html = data.getData("text/html");
  const table = html ? parseHtmlTable(html) : null;
  if (table) return { rows: table, from: null };
  const text = data.getData("text/plain");
  if (!text) return null;
  return { rows: parseTsv(text).map((row) => row.map((cell) => ({ text: cell }))), from: null };
}
