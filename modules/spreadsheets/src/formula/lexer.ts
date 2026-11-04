// Splits a formula (the part after "=", in the stored English form) into tokens that keep their exact text, so
// references can be rewritten in place (rows inserted, a sheet renamed) without touching anything else.
import { columnIndex } from "./refs";

/** One end of a reference. A whole column has no row, a whole row no column. */
export interface RefPoint {
  row: number | null;
  col: number | null;
  absRow: boolean;
  absCol: boolean;
}

export interface RefToken {
  type: "ref";
  text: string;
  start: number;
  /** The sheet's name as written, unquoted; undefined for the formula's own sheet. */
  sheet?: string;
  a: RefPoint;
  /** The second corner of a range. */
  b?: RefPoint;
}

export type Token =
  | { type: "number"; text: string; start: number; value: number }
  | { type: "string"; text: string; start: number; value: string }
  | { type: "bool"; text: string; start: number; value: boolean }
  | { type: "error"; text: string; start: number }
  | { type: "func"; text: string; start: number; name: string }
  | { type: "name"; text: string; start: number }
  | RefToken
  | { type: "op"; text: string; start: number }
  | { type: "paren"; text: "(" | ")"; start: number }
  | { type: "sep"; text: string; start: number }
  | { type: "space"; text: string; start: number }
  | { type: "bad"; text: string; start: number };

export const ERROR_LITERALS = ["#DIV/0!", "#REF!", "#NAME?", "#VALUE!", "#N/A", "#NUM!", "#NULL!", "#CYCLE!"] as const;

const SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_À-￿][A-Za-z0-9_.À-￿]*)!`;
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}`;
const COL = String.raw`\$?[A-Za-z]{1,3}`;
const ROW = String.raw`\$?\d{1,7}`;
// A reference, with an optional sheet in front: a cell range, a cell, whole columns or whole rows. Not followed by
// more name characters or "(", so LOG10( or ABC123X stay what they are.
const REF = new RegExp(String.raw`^(${SHEET})?(${CELL}:${CELL}|${CELL}|${COL}:${COL}|${ROW}:${ROW})(?![A-Za-z0-9_.(!])`);
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/;
const IDENT = /^[A-Za-z_À-￿][A-Za-z0-9_.À-￿]*/;

function point(text: string): RefPoint {
  const match = /^(\$?)([A-Za-z]{0,3})(\$?)(\d*)$/.exec(text)!;
  const [, colDollar = "", letters = "", rowDollar = "", digits = ""] = match;
  if (!letters) return { row: Number(digits) - 1, col: null, absRow: colDollar === "$", absCol: false };
  return { row: digits ? Number(digits) - 1 : null, col: columnIndex(letters), absRow: rowDollar === "$", absCol: colDollar === "$" };
}

function unquote(sheet: string): string {
  const name = sheet.slice(0, -1);
  return name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name;
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const rest = source.slice(at);
    const char = source[at]!;
    const start = at;
    if (/\s/.test(char)) {
      const text = /^\s+/.exec(rest)![0];
      tokens.push({ type: "space", text, start });
      at += text.length;
      continue;
    }
    if (char === '"') {
      let end = at + 1;
      let value = "";
      while (end < source.length) {
        if (source[end] === '"') {
          if (source[end + 1] === '"') {
            value += '"';
            end += 2;
            continue;
          }
          break;
        }
        value += source[end];
        end++;
      }
      const closed = end < source.length;
      const text = source.slice(at, closed ? end + 1 : end);
      tokens.push(closed ? { type: "string", text, start, value } : { type: "bad", text, start });
      at += text.length;
      continue;
    }
    if (char === "#") {
      const literal = ERROR_LITERALS.find((error) => rest.toUpperCase().startsWith(error));
      if (literal) {
        tokens.push({ type: "error", text: rest.slice(0, literal.length), start });
        at += literal.length;
        continue;
      }
    }
    const ref = REF.exec(rest);
    if (ref) {
      const [text, sheet, body] = ref as unknown as [string, string | undefined, string];
      const [first, second] = body.split(":") as [string, string | undefined];
      tokens.push({ type: "ref", text, start, ...(sheet ? { sheet: unquote(sheet) } : {}), a: point(first), ...(second ? { b: point(second) } : {}) });
      at += text.length;
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number) {
      tokens.push({ type: "number", text: number[0], start, value: Number(number[0]) });
      at += number[0].length;
      continue;
    }
    const ident = IDENT.exec(rest);
    if (ident) {
      const text = ident[0];
      const after = source.slice(at + text.length).match(/^\s*\(/);
      const upper = text.toUpperCase();
      if (after) tokens.push({ type: "func", text, start, name: upper });
      else if (upper === "TRUE" || upper === "FALSE") tokens.push({ type: "bool", text, start, value: upper === "TRUE" });
      else tokens.push({ type: "name", text, start });
      at += text.length;
      continue;
    }
    const two = rest.slice(0, 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ type: "op", text: two, start });
      at += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(char)) tokens.push({ type: "op", text: char, start });
    else if (char === "(" || char === ")") tokens.push({ type: "paren", text: char, start });
    else if (char === "," || char === ";") tokens.push({ type: "sep", text: char, start });
    else tokens.push({ type: "bad", text: char, start });
    at += 1;
  }
  return tokens;
}

/** The formula again, from its tokens (after some were changed). */
export const join = (tokens: readonly Token[]): string => tokens.map((token) => token.text).join("");
