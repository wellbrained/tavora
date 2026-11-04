// What the user types and sees, in their language, and the stored form behind it. "1,5" in German and "1.5" in
// English are both stored as 1.5; "4.11.2026" and "11/4/2026" both as 2026-11-04. Switching the language changes
// only how it looks.
import { formulaToShown, formulaToStored, type Lang } from "./formula/locale";
import { dateSerial, isError, isFormula, parseStoredDate, serialDate, storedDate, storedDateKind, storedNumber, type Scalar, type ValueHint } from "./formula/values";
import type { CellFormat } from "./model";

const localeOf = (lang: Lang) => (lang === "de" ? "de-DE" : "en-US");

/** A number typed in a language: "1.234,5" or "1,5" in German, "1,234.5" in English; null when it isn't one. */
export function parseLocalNumber(input: string, lang: Lang): number | null {
  const text = input.trim().replace(/\s/g, "");
  if (!text) return null;
  const [group, decimal] = lang === "de" ? [".", ","] : [",", "."];
  const escaped = (char: string) => `\\${char}`;
  const grouped = new RegExp(`^[-+]?\\d{1,3}(?:${escaped(group)}\\d{3})+(?:${escaped(decimal)}\\d+)?$`);
  const plain = new RegExp(`^[-+]?(?:\\d+(?:${escaped(decimal)}\\d*)?|${escaped(decimal)}\\d+)(?:[eE][-+]?\\d+)?$`);
  let normal: string | null = null;
  if (grouped.test(text)) normal = text.split(group).join("").replace(decimal, ".");
  else if (plain.test(text)) normal = text.replace(decimal, ".");
  // German users paste English decimals too ("1.5" can't be a German thousands number).
  else if (lang === "de" && /^[-+]?\d+\.\d+$/.test(text) && !/^[-+]?\d{1,3}\.\d{3}$/.test(text)) normal = text;
  if (normal === null) return null;
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}

/** A date typed in a language (4.11.2026, 4.11.26, 4.11. in German; 11/4/2026 in English; 2026-11-04 in both). */
export function parseLocalDate(input: string, lang: Lang, today = new Date()): number | null {
  const text = input.trim();
  const iso = parseStoredDate(text);
  if (iso !== null) return iso;
  const match = lang === "de" ? /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(text) : /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (!match) return null;
  const [day, month] = lang === "de" ? [Number(match[1]), Number(match[2])] : [Number(match[2]), Number(match[1])];
  let year = match[3] === undefined ? today.getFullYear() : Number(match[3]);
  if (match[3]?.length === 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const serial = dateSerial(year, month, day);
  return serialDate(serial).getUTCDate() === day ? serial : null;
}

export interface StoredInput {
  /** What to store; "" clears the cell. */
  raw: string;
  /** A format the typing asked for on a cell that has none ("50 %" makes it a percent). */
  format?: CellFormat;
}

const TRUE_WORDS = ["true", "wahr"];
const FALSE_WORDS = ["false", "falsch"];

/** What a cell stores for what was typed into it, by its format. */
export function inputToStored(input: string, format: CellFormat, lang: Lang): StoredInput {
  if (input === "") return { raw: "" };
  if (format.type === "text") return { raw: needsQuote(input) ? `'${input}` : input };
  if (isFormula(input)) return { raw: formulaToStored(input, lang) };
  if (input.startsWith("'")) return { raw: input };
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  if (TRUE_WORDS.includes(lower)) return { raw: "TRUE" };
  if (FALSE_WORDS.includes(lower)) return { raw: "FALSE" };
  if (format.type === "checkbox") {
    if (["1", "x", "✓"].includes(lower)) return { raw: "TRUE" };
    if (["0", "-"].includes(lower)) return { raw: "FALSE" };
  }
  const percent = /^(.*?)\s*%$/.exec(trimmed);
  if (percent) {
    const number = parseLocalNumber(percent[1]!, lang);
    if (number !== null) return { raw: storedNumber(number / 100), ...(format.type === "auto" ? { format: { type: "percent", decimals: decimalsOf(percent[1]!) } as CellFormat } : {}) };
  }
  const number = parseLocalNumber(trimmed, lang);
  if (number !== null) return { raw: storedNumber(format.type === "percent" ? number / 100 : number) };
  const date = parseLocalDate(trimmed, lang);
  if (date !== null) return { raw: storedDate(date) };
  return { raw: needsQuote(input) ? `'${input}` : input };
}

const decimalsOf = (text: string) => Math.min(4, /[.,](\d+)$/.exec(text.trim())?.[1]?.length ?? 0);

/** Text that would be read as something else when stored as it is (a number, a date, TRUE, a formula). */
function needsQuote(text: string): boolean {
  return text.startsWith("'") || text.startsWith("=") || /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text) || text === "TRUE" || text === "FALSE" || storedDateKind(text) !== undefined;
}

/** What editing a cell starts with: its formula, number or date in the language. */
export function storedToInput(raw: string | undefined, format: CellFormat, lang: Lang): string {
  if (!raw) return "";
  if (isFormula(raw)) return formulaToShown(raw, lang);
  if (raw.startsWith("'")) return format.type === "text" ? raw.slice(1) : raw;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(raw)) {
    const value = Number(raw);
    if (format.type === "percent") return `${localNumber(value * 100, lang)}${lang === "de" ? " %" : "%"}`;
    return localNumber(value, lang);
  }
  const kind = storedDateKind(raw);
  if (kind) return formatDate(parseStoredDate(raw)!, kind === "datetime", lang);
  return raw;
}

/** A number in the language, without thousands separators, as many decimals as it has (up to 10). */
export function localNumber(value: number, lang: Lang): string {
  return new Intl.NumberFormat(localeOf(lang), { useGrouping: false, maximumFractionDigits: 10 }).format(value);
}

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(lang: Lang, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) numberFormats.set(key, (format = new Intl.NumberFormat(localeOf(lang), options)));
  return format;
}

export function formatDate(serial: number, withTime: boolean, lang: Lang): string {
  const date = serialDate(serial);
  const options: Intl.DateTimeFormatOptions = lang === "de" ? { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" } : { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" };
  if (withTime) Object.assign(options, { hour: "2-digit", minute: "2-digit" });
  return new Intl.DateTimeFormat(localeOf(lang), options).format(date);
}

export interface DisplayTexts {
  yes: string;
  no: string;
}

/** What a cell shows in the grid. */
export function displayValue(value: Scalar, hint: ValueHint, format: CellFormat, lang: Lang, texts: DisplayTexts): string {
  if (value === null) return "";
  if (isError(value)) return value.error;
  if (typeof value === "boolean") return value ? texts.yes : texts.no;
  if (typeof value === "string") return value;
  switch (format.type) {
    case "number":
      return numberFormat(lang, { useGrouping: format.thousands, minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals }).format(value);
    case "percent":
      return numberFormat(lang, { style: "percent", minimumFractionDigits: format.decimals, maximumFractionDigits: format.decimals }).format(value);
    case "date":
      return formatDate(value, hint === "datetime", lang);
    case "text":
      return storedNumber(value);
    default:
      if (hint) return formatDate(value, hint === "datetime", lang);
      return numberFormat(lang, { useGrouping: false, maximumSignificantDigits: 11 }).format(value);
  }
}

/** A value as it goes out to other apps: the shown text for numbers, plain text otherwise. */
export function plainValue(value: Scalar): string {
  if (value === null) return "";
  if (isError(value)) return value.error;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return storedNumber(value);
  return value;
}
