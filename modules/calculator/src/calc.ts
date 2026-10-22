// The calculator's sums: reading an expression such as "12*(3+4)%" without eval, and the rules for typing one key
// at a time. Expressions use the plain signs + - * /; the panel shows them as + − × ÷.

export type Outcome = { ok: true; value: number } | { ok: false; reason: "incomplete" | "divide" | "invalid" | "tooBig" };

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
    } else if ("+-*/%()".includes(rest[0]!)) {
      tokens.push({ kind: "op", value: rest[0]! });
      rest = rest.slice(1);
    } else return null;
  }
  return tokens;
}

class Incomplete extends Error {}
class DivideByZero extends Error {}

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
      } else if (isOp("(")) value *= factor(); // 2(3+4) is 2 × (3+4)
      else return value;
    }
  }

  function factor(): number {
    if (isOp("-")) return at++, -factor();
    if (isOp("+")) return at++, factor();
    let value = primary();
    while (isOp("%")) at++, (value /= 100);
    return value;
  }

  function primary(): number {
    const token = tokens[at++];
    if (!token) throw new Incomplete();
    if (token.kind === "number") return token.value;
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
    return { ok: false, reason: "invalid" };
  }
}

/** A result as the calculator writes it: 12 significant digits, so 0.1 + 0.2 is 0.3. */
export function format(value: number): string {
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** How the panel shows an expression; German shows a decimal comma. */
export function pretty(text: string, comma = false): string {
  const signs = text.replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−");
  return comma ? signs.replace(/\./g, ",") : signs;
}

export interface Entry {
  /** What was typed so far, in plain signs. */
  text: string;
  /** Just worked out: a digit starts a new sum, an operator goes on with the result. */
  fresh: boolean;
}

export const EMPTY: Entry = { text: "", fresh: false };

const OPERATORS = "+-*/";

/** What one key does to the entry. Keys are digits, ".", + - * /, %, ( and ), "back" and "clear". */
export function press(entry: Entry, key: string): Entry {
  const text = entry.fresh && (/^[\d.(]$/.test(key)) ? "" : entry.text;
  const last = text.at(-1) ?? "";
  const open = [...text].filter((char) => char === "(").length - [...text].filter((char) => char === ")").length;
  const next = (value: string): Entry => ({ text: value, fresh: false });

  if (key === "clear") return EMPTY;
  if (key === "back") return next(entry.text.slice(0, -1));
  if (/^\d$/.test(key)) return next(last === ")" || last === "%" ? `${text}*${key}` : text + key);
  if (key === ".") {
    if (text.match(/[\d.]*$/)![0].includes(".")) return entry;
    return next(/\d$/.test(last) ? `${text}.` : `${last === ")" || last === "%" ? `${text}*` : text}0.`);
  }
  if (OPERATORS.includes(key)) {
    if (!text) return key === "-" ? next("-") : entry;
    // A minus may follow × ÷ or a bracket, for a negative number; anything else replaces the operator before it.
    if (key === "-" && (last === "*" || last === "/" || last === "(")) return next(text + key);
    if (last === "(") return entry;
    if (OPERATORS.includes(last)) {
      const trimmed = text.replace(/[-+*/]+$/, "");
      return trimmed ? next(trimmed + key) : entry;
    }
    return next(text + key);
  }
  if (key === "%") return /[\d.)%]$/.test(last) ? next(text + key) : entry;
  if (key === "(") return next(/[\d.)%]$/.test(last) ? `${text}*(` : `${text}(`);
  if (key === ")") return open > 0 && /[\d.)%]$/.test(last) ? next(text + key) : entry;
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
