// The calculator's sums: reading an expression such as "12*(3+4)%" without eval, and the rules for typing one key
// at a time. Expressions use the plain signs + - * /, with √ before a number or bracket and ² after one; the panel
// shows them as + − × ÷.

export type Outcome =
  | { ok: true; value: number }
  | { ok: false; reason: "incomplete" | "divide" | "invalid" | "tooBig" | "negativeRoot" };

type Token = { kind: "number"; value: number } | { kind: "op"; value: string };

const NUMBER = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i;

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  let rest = text.replace(/\s+/g, "");
  while (rest) {
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      rest = rest.slice(number[0].length);
    } else if ("+-*/%()√²".includes(rest[0]!)) {
      tokens.push({ kind: "op", value: rest[0]! });
      rest = rest.slice(1);
    } else return null;
  }
  return tokens;
}

class Incomplete extends Error {}
class DivideByZero extends Error {}
class NegativeRoot extends Error {}

/** Works out an expression. Brackets left open are closed at the end, as most calculators do. */
export function evaluate(text: string): Outcome {
  const read = tokenize(text);
  if (!read) return { ok: false, reason: "invalid" };
  const tokens = read;
  if (!tokens.length) return { ok: false, reason: "incomplete" };
  let at = 0;
  const peek = () => tokens[at];
  const isOp = (value: string) => peek()?.kind === "op" && peek()!.value === value;

  function expression(): number {
    let value = term();
    while (isOp("+") || isOp("-")) {
      const plus = tokens[at++]!.value === "+";
      const start = at;
      let right = term();
      // 200 + 10% adds 10% of 200, as on a pocket calculator.
      if (at - start >= 2 && tokens[at - 1]!.value === "%" && isPercentOnly(start, at)) right *= value;
      value = plus ? value + right : value - right;
    }
    return value;
  }

  /** Whether the tokens from start to end are one number with % after it, such as 10% or 10%%. */
  function isPercentOnly(start: number, end: number): boolean {
    return tokens[start]!.kind === "number" && tokens.slice(start + 1, end).every((token) => token.value === "%");
  }

  function term(): number {
    let value = factor();
    for (;;) {
      if (isOp("*")) {
        at++;
        value *= factor();
      } else if (isOp("/")) {
        at++;
        const divisor = factor();
        if (divisor === 0) throw new DivideByZero();
        value /= divisor;
      } else if (isOp("(") || isOp("√")) value *= factor(); // 2(3+4) is 2 × (3+4)
      else return value;
    }
  }

  function factor(): number {
    if (isOp("-")) return at++, -factor();
    if (isOp("+")) return at++, factor();
    let value = primary();
    while (isOp("%") || isOp("²")) value = tokens[at++]!.value === "%" ? value / 100 : value * value;
    return value;
  }

  function primary(): number {
    const token = tokens[at++];
    if (!token) throw new Incomplete();
    if (token.kind === "number") return token.value;
    if (token.value === "√") {
      const value = primary();
      if (value < 0) throw new NegativeRoot();
      return Math.sqrt(value);
    }
    if (token.value !== "(") throw new SyntaxError();
    const value = expression();
    if (isOp(")")) at++;
    else if (peek()) throw new SyntaxError();
    return value;
  }

  try {
    const value = expression();
    if (at < tokens.length) return { ok: false, reason: "invalid" };
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: "tooBig" };
  } catch (error) {
    if (error instanceof Incomplete) return { ok: false, reason: "incomplete" };
    if (error instanceof DivideByZero) return { ok: false, reason: "divide" };
    if (error instanceof NegativeRoot) return { ok: false, reason: "negativeRoot" };
    return { ok: false, reason: "invalid" };
  }
}

/** A result as the calculator writes it: 12 significant digits, so 0.1 + 0.2 is 0.3. */
export function format(value: number): string {
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** How the panel shows an expression: the signs a player knows and thousands grouped, 1,234.5 (German 1.234,5). */
export function pretty(text: string, comma = false): string {
  const grouped = text.replace(/(\d+)(\.\d*)?/g, (_, whole: string, fraction: string = "") => {
    const thousands = whole.replace(/\B(?=(\d{3})+$)/g, comma ? "." : ",");
    return thousands + (comma ? fraction.replace(".", ",") : fraction);
  });
  return grouped.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−");
}

export interface Entry {
  /** What was typed so far, in plain signs. */
  text: string;
  /** Just worked out: a digit starts a new sum, an operator goes on with the result. */
  fresh: boolean;
}

export const EMPTY: Entry = { text: "", fresh: false };

/** What Copy puts on the clipboard: the result as one plain number without grouping, so a game's input box takes it. */
export function copyText(entry: Entry, comma = false): string | null {
  const outcome = evaluate(entry.text);
  if (!outcome.ok) return null;
  const text = format(outcome.value);
  return comma ? text.replace(".", ",") : text;
}

const OPERATORS = "+-*/";

/** Whether the minus at `at` is a sign rather than a take-away: at the start, or after ( × or ÷. */
const isSign = (text: string, at: number) => at === 0 || "(*/".includes(text[at - 1]!);

/** Where the bracket closing at `end` opens, or -1. */
function opening(text: string, end: number): number {
  let depth = 0;
  for (let at = end; at >= 0; at--) {
    if (text[at] === ")") depth++;
    else if (text[at] === "(" && --depth === 0) return at;
  }
  return -1;
}

/** Where the number at the end of the entry starts: a number or a bracket group, with its √ or minus sign before it
 * and % or ² after it. The whole entry right after a result; null when the entry ends in an operator. */
function operandStart(entry: Entry): number | null {
  const { text } = entry;
  if (entry.fresh) return text ? 0 : null;
  let at = text.replace(/[%²]+$/, "").length;
  if (text[at - 1] === ")") {
    at = opening(text, at - 1);
    if (at < 0) return null;
  } else {
    const number = /(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.exec(text.slice(0, at));
    if (!number) return null;
    at -= number[0].length;
  }
  if (text[at - 1] === "√") at--;
  if (text[at - 1] === "-" && isSign(text, at - 1)) at--;
  return at;
}

/** √, x² and ±, as on Windows: they work on the number just typed, the bracket just closed, or the result. */
function applyTo(entry: Entry, key: "sqrt" | "square" | "negate"): Entry {
  const start = operandStart(entry);
  if (start === null) return key === "negate" && !entry.text ? { text: "-", fresh: false } : entry;
  const before = entry.text.slice(0, start);
  const operand = entry.text.slice(start);
  const next = (text: string): Entry => ({ text, fresh: false });
  if (key === "square") return next(`${before}${operand.startsWith("-") ? `(${operand})` : operand}²`);
  if (key === "sqrt") {
    const group = operand.startsWith("(") && operand.endsWith(")") && opening(operand, operand.length - 1) === 0;
    return next(`${before}√${group ? operand : `(${operand})`}`);
  }
  if (operand.startsWith("-")) return next(before + operand.slice(1));
  if (before.endsWith("+")) return next(`${before.slice(0, -1)}-${operand}`);
  if (before.endsWith("-")) return next(`${before.slice(0, -1)}+${operand}`);
  return next(`${before}-${operand}`);
}

/** What one key does to the entry. Keys are digits, ".", + - * /, %, ( and ), "sqrt", "square", "negate", "back"
 * and "clear". */
export function press(entry: Entry, key: string): Entry {
  const text = entry.fresh && (/^[\d.(]$/.test(key)) ? "" : entry.text;
  const last = text.at(-1) ?? "";
  const open = [...text].filter((char) => char === "(").length - [...text].filter((char) => char === ")").length;
  const next = (value: string): Entry => ({ text: value, fresh: false });
  const closed = /[)%²]/.test(last);

  if (key === "clear") return EMPTY;
  if (key === "back") return next(entry.text.slice(0, -1));
  if (key === "sqrt" || key === "square" || key === "negate") return applyTo(entry, key);
  if (/^\d$/.test(key)) return next(closed ? `${text}*${key}` : text + key);
  if (key === ".") {
    if (text.match(/[\d.]*$/)![0].includes(".")) return entry;
    return next(/\d$/.test(last) ? `${text}.` : `${closed ? `${text}*` : text}0.`);
  }
  if (OPERATORS.includes(key)) {
    if (!text) return key === "-" ? next("-") : entry;
    // A minus may follow × ÷ or a bracket, for a negative number; anything else replaces the operator before it.
    if (key === "-" && (last === "*" || last === "/" || last === "(")) return next(text + key);
    if (last === "(" || last === "√") return entry;
    if (OPERATORS.includes(last)) {
      const trimmed = text.replace(/[-+*/]+$/, "");
      return trimmed ? next(trimmed + key) : entry;
    }
    return next(text + key);
  }
  if (key === "%") return /[\d.)%²]$/.test(last) ? next(text + key) : entry;
  if (key === "(") return next(/[\d.)%²]$/.test(last) ? `${text}*(` : `${text}(`);
  if (key === ")") return open > 0 && /[\d.)%²]$/.test(last) ? next(text + key) : entry;
  return entry;
}

/** Puts a number (from the history) into the entry: after an operator it goes on the end, otherwise it replaces. */
export function insert(entry: Entry, value: string): Entry {
  const last = entry.text.at(-1) ?? "";
  if (!entry.fresh && entry.text && (OPERATORS.includes(last) || last === "(")) {
    return { text: entry.text + (value.startsWith("-") && last !== "(" ? `(${value})` : value), fresh: false };
  }
  return { text: value, fresh: true };
}
