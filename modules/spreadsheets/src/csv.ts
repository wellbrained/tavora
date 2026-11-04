// CSV in and out, our own small reader and writer. In: commas, semicolons (German Excel) or tabs, found from the
// first line; quoted fields with delimiters, line breaks and ""; a byte-order mark is dropped. Out: in the user's
// language, as their Excel opens it (English: "," and 1.5, German: ";" and 1,5), with a byte-order mark.
import { parseDelimited } from "./clipboard";
import type { Lang } from "./formula/locale";

export interface CsvTable {
  rows: string[][];
  /** The language its numbers are written in: a semicolon file is German. */
  lang: Lang;
}

/** The delimiter of a CSV: the one found most often in its first line, outside quotes. */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  let best = ",";
  for (const [char, count] of counts) if (count > counts.get(best)!) best = char;
  return best;
}

export function readCsv(input: string, fallback: Lang): CsvTable {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows = parseDelimited(text, delimiter);
  // A file that ends with a line break has no empty last row.
  while (rows.length && rows[rows.length - 1]!.every((cell) => cell === "")) rows.pop();
  return { rows, lang: delimiter === ";" ? "de" : delimiter === "," ? "en" : fallback };
}

function csvCell(text: string, delimiter: string): string {
  return text.includes(delimiter) || /[\n\r"]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(rows: readonly (readonly string[])[], lang: Lang): string {
  const delimiter = lang === "de" ? ";" : ",";
  return `﻿${rows.map((row) => row.map((cell) => csvCell(cell, delimiter)).join(delimiter)).join("\r\n")}\r\n`;
}
