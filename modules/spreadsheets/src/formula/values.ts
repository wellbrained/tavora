// What a cell holds once it is worked out, and how a stored cell turns into it. Stored cells are language-free:
// "1.5" is a number, "2026-11-04" a date, "TRUE" a yes, "'007" the text 007, "=…" a formula.

export type ErrorCode = "#DIV/0!" | "#REF!" | "#NAME?" | "#VALUE!" | "#N/A" | "#NUM!" | "#NULL!" | "#CYCLE!";

export interface CellError {
  error: ErrorCode;
}

/** A cell's value: a number (dates are day numbers, as in Excel), text, yes/no, an error, or nothing. */
export type Scalar = number | string | boolean | CellError | null;

export const err = (error: ErrorCode): CellError => ({ error });
export const isError = (value: unknown): value is CellError => typeof value === "object" && value !== null && "error" in value;

/** How a worked-out number is best shown when the cell has no format of its own. */
export type ValueHint = "date" | "datetime" | undefined;

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/** Excel's day 0, 30 December 1899, in milliseconds. */
const EPOCH = Date.UTC(1899, 11, 30);
const DAY = 86_400_000;

/** The day number of a date (with the time of day as a fraction). */
export const dateSerial = (year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0): number =>
  (Date.UTC(year, month - 1, day, hours, minutes, seconds) - EPOCH) / DAY;

/** The date of a day number, in UTC. */
export const serialDate = (serial: number): Date => new Date(EPOCH + Math.round(serial * DAY));

/** A day number as a stored date: "2026-11-04", or "2026-11-04T14:30" with a time. */
export function storedDate(serial: number, withTime = false): string {
  const date = serialDate(serial);
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return withTime ? `${day}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}` : day;
}

/** Whether a stored cell is a date ("2026-11-04"), and with a time. */
export function storedDateKind(raw: string): ValueHint {
  const match = ISO_DATE.exec(raw);
  if (!match) return undefined;
  return match[4] !== undefined ? "datetime" : "date";
}

/** A stored date's day number, or null. */
export function parseStoredDate(raw: string): number | null {
  const match = ISO_DATE.exec(raw);
  if (!match) return null;
  const [, y, m, d, hh = "0", mm = "0", ss = "0"] = match;
  const [year, month, day] = [Number(y), Number(m), Number(d)];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const serial = dateSerial(year, month, day, Number(hh), Number(mm), Number(ss));
  // 2026-02-31 rolls over to March: not a date.
  return serialDate(serial).getUTCDate() === day ? serial : null;
}

export const isFormula = (raw: string): boolean => raw.startsWith("=") && raw.length > 1;

/** The value of a stored cell that is not a formula. */
export function rawValue(raw: string | undefined): Scalar {
  if (raw === undefined || raw === "") return null;
  if (raw.startsWith("'")) return raw.slice(1);
  if (NUMBER.test(raw)) return Number(raw);
  if (raw === "TRUE") return true;
  if (raw === "FALSE") return false;
  const date = parseStoredDate(raw);
  if (date !== null) return date;
  return raw;
}

/** The stored form of a plain number: no locale, no exponent for everyday sizes, no float noise. */
export function storedNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Object.is(value, -0)) return "0";
  return String(Number(value.toPrecision(15)));
}

// ── Turning values into what a calculation needs ──

/** A value as a number: text that is a number counts, an empty cell is 0, TRUE is 1. */
export function toNumber(value: Scalar): number | CellError {
  if (value === null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (isError(value)) return value;
  const text = value.trim();
  if (text === "") return 0;
  if (NUMBER.test(text)) return Number(text);
  const date = parseStoredDate(text);
  if (date !== null) return date;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)%$/.test(text)) return Number(text.slice(0, -1)) / 100;
  return err("#VALUE!");
}

export function toText(value: Scalar): string | CellError {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (isError(value)) return value;
  return storedNumber(value);
}

export function toBool(value: Scalar): boolean | CellError {
  if (value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (isError(value)) return value;
  const upper = value.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return err("#VALUE!");
}

/** Excel's order for comparing: numbers, then text (any case), then FALSE, TRUE. */
function rank(value: Scalar): number {
  if (typeof value === "number" || value === null) return 0;
  if (typeof value === "string") return 1;
  return 2;
}

/** Below 0 when a comes first, 0 when equal, above 0 after; for comparisons, sorting and lookups. */
export function compare(a: Scalar, b: Scalar): number {
  // An empty cell is 0 next to a number, "" next to text, FALSE next to yes/no.
  const left = a === null ? (typeof b === "string" ? "" : typeof b === "boolean" ? false : 0) : a;
  const right = b === null ? (typeof a === "string" ? "" : typeof a === "boolean" ? false : 0) : b;
  const difference = rank(left as Scalar) - rank(right as Scalar);
  if (difference !== 0) return difference;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") return left.localeCompare(right, undefined, { sensitivity: "accent", numeric: false });
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return 0;
}
