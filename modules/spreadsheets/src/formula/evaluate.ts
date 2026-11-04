// Works out a formula's tree. Cells are asked for through the context, so the engine decides what is cached, what
// is a loop and which sheet a name means.
import type { Node } from "./parser";
import { compare, err, isError, toBool, toNumber, toText, type CellError, type Scalar } from "./values";

/** A block of cells a formula points at, read only when a function asks. */
export interface RangeRef {
  kind: "range";
  sheetId: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type Value = Scalar | RangeRef;

export interface EvalContext {
  /** The sheet the formula is on. */
  sheetId: string;
  /** The sheet a formula names, or null when there is none by that name. */
  resolveSheet(name: string): string | null;
  /** A cell's worked-out value. */
  cell(sheetId: string, row: number, col: number): Scalar;
  /** How far a sheet is used, for whole columns (A:A) and rows (2:2). */
  extent(sheetId: string): { rows: number; cols: number };
  /** Now, as a day number in local time. */
  now(): number;
}

export const isRange = (value: Value): value is RangeRef => typeof value === "object" && value !== null && "kind" in value && value.kind === "range";

/** Every cell of a range, row by row. */
export function* cellsOf(range: RangeRef, ctx: EvalContext): Generator<Scalar> {
  for (let row = range.top; row <= range.bottom; row++) for (let col = range.left; col <= range.right; col++) yield ctx.cell(range.sheetId, row, col);
}

export const rangeRows = (range: RangeRef): number => range.bottom - range.top + 1;
export const rangeCols = (range: RangeRef): number => range.right - range.left + 1;
export const rangeAt = (range: RangeRef, row: number, col: number, ctx: EvalContext): Scalar => ctx.cell(range.sheetId, range.top + row, range.left + col);

/** A single value from a formula part: a one-cell range is its cell; a bigger one can't be one value. */
export function scalarOf(value: Value, ctx: EvalContext): Scalar {
  if (!isRange(value)) return value;
  if (value.top === value.bottom && value.left === value.right) return ctx.cell(value.sheetId, value.top, value.left);
  return err("#VALUE!");
}

export function evaluate(node: Node, ctx: EvalContext): Value {
  switch (node.kind) {
    case "number":
    case "string":
    case "bool":
      return node.value;
    case "error":
      return err(node.code);
    case "ref":
      return reference(node, ctx);
    case "unary": {
      const value = toNumber(scalarOf(evaluate(node.arg, ctx), ctx));
      if (isError(value)) return value;
      return node.op === "-" ? -value : value;
    }
    case "percent": {
      const value = toNumber(scalarOf(evaluate(node.arg, ctx), ctx));
      return isError(value) ? value : value / 100;
    }
    case "binary":
      return binary(node.op, scalarOf(evaluate(node.left, ctx), ctx), scalarOf(evaluate(node.right, ctx), ctx));
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) return err("#NAME?");
      return fn(node.args, ctx);
    }
  }
}

function reference(node: Extract<Node, { kind: "ref" }>, ctx: EvalContext): Value {
  const sheetId = node.sheet === undefined ? ctx.sheetId : ctx.resolveSheet(node.sheet);
  if (sheetId === null) return err("#REF!");
  const { a, b } = node;
  if (!b) {
    if (a.row === null || a.col === null) return err("#REF!");
    return ctx.cell(sheetId, a.row, a.col);
  }
  const extent = ctx.extent(sheetId);
  // A whole column runs to the last used row, a whole row to the last used column.
  const top = Math.min(a.row ?? 0, b.row ?? 0);
  const bottom = a.row === null || b.row === null ? Math.max(0, extent.rows - 1) : Math.max(a.row, b.row);
  const left = Math.min(a.col ?? 0, b.col ?? 0);
  const right = a.col === null || b.col === null ? Math.max(0, extent.cols - 1) : Math.max(a.col, b.col);
  return { kind: "range", sheetId, top, left, bottom, right };
}

function binary(op: string, left: Scalar, right: Scalar): Scalar {
  if (isError(left)) return left;
  if (isError(right)) return right;
  if (op === "&") {
    const a = toText(left);
    const b = toText(right);
    if (isError(a)) return a;
    if (isError(b)) return b;
    return a + b;
  }
  if (["=", "<>", "<", ">", "<=", ">="].includes(op)) {
    const order = compare(left, right);
    switch (op) {
      case "=":
        return order === 0;
      case "<>":
        return order !== 0;
      case "<":
        return order < 0;
      case ">":
        return order > 0;
      case "<=":
        return order <= 0;
      default:
        return order >= 0;
    }
  }
  const a = toNumber(left);
  const b = toNumber(right);
  if (isError(a)) return a;
  if (isError(b)) return b;
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? err("#DIV/0!") : a / b;
    case "^": {
      const result = a ** b;
      return Number.isFinite(result) ? result : err("#NUM!");
    }
    default:
      return err("#VALUE!");
  }
}

// ── Functions ──

type Fn = (args: Node[], ctx: EvalContext) => Value;

const value = (node: Node | undefined, ctx: EvalContext): Scalar => (node ? scalarOf(evaluate(node, ctx), ctx) : null);

function numberArg(node: Node | undefined, ctx: EvalContext, fallback?: number): number | CellError {
  if (!node) return fallback ?? err("#VALUE!");
  return toNumber(value(node, ctx));
}

/**
 * The numbers of a function's arguments, as SUM reads them: in a range only numbers count (text and yes/no are left
 * out), typed straight in, text that is a number counts too. The first error wins.
 */
function numbers(args: Node[], ctx: EvalContext): number[] | CellError {
  const list: number[] = [];
  for (const arg of args) {
    const result = evaluate(arg, ctx);
    if (isRange(result)) {
      for (const item of cellsOf(result, ctx)) {
        if (isError(item)) return item;
        if (typeof item === "number") list.push(item);
      }
    } else {
      if (isError(result)) return result;
      if (result === null) continue;
      const number = toNumber(result);
      if (isError(number)) return number;
      list.push(number);
    }
  }
  return list;
}

/** Every value of the arguments, ranges spread out. */
function flat(args: Node[], ctx: EvalContext): Scalar[] {
  const list: Scalar[] = [];
  for (const arg of args) {
    const result = evaluate(arg, ctx);
    if (isRange(result)) for (const item of cellsOf(result, ctx)) list.push(item);
    else list.push(result);
  }
  return list;
}

function rangeArg(node: Node | undefined, ctx: EvalContext): RangeRef | CellError {
  if (!node) return err("#VALUE!");
  const result = evaluate(node, ctx);
  if (isRange(result)) return result;
  if (isError(result)) return result;
  return err("#VALUE!");
}

/** A criteria test as COUNTIF reads it: 5, ">5", "<>x", "=x", "Iron*", "?ron". */
export function criteria(test: Scalar): (cell: Scalar) => boolean {
  if (typeof test === "number" || typeof test === "boolean") return (cell) => cell !== null && compare(cell, test) === 0;
  if (test === null) return (cell) => cell === null || cell === "";
  if (isError(test)) return (cell) => isError(cell) && cell.error === test.error;
  const match = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(test)!;
  const op = match[1] ?? "=";
  const raw = match[2] ?? "";
  const asNumber = toNumber(raw);
  const target: Scalar = raw === "" ? null : !isError(asNumber) && raw.trim() !== "" ? asNumber : raw;
  if (op === "=" || op === "<>") {
    let equal: (cell: Scalar) => boolean;
    if (target === null) equal = (cell) => cell === null || cell === "";
    else if (typeof target === "string" && /[*?]/.test(target)) {
      const pattern = new RegExp(`^${target.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~\*/g, "\u0000").replace(/~\?/g, "\u0001").replace(/\*/g, ".*").replace(/\?/g, ".").replace(/\u0000/g, "\\*").replace(/\u0001/g, "\\?")}$`, "is");
      equal = (cell) => typeof cell === "string" && pattern.test(cell);
    } else equal = (cell) => cell !== null && !isError(cell) && rank(cell) === rank(target) && compare(cell, target) === 0;
    return op === "=" ? equal : (cell) => !equal(cell);
  }
  return (cell) => {
    if (cell === null || isError(cell) || target === null) return false;
    if (rank(cell) !== rank(target)) return false;
    const order = compare(cell, target);
    return op === "<" ? order < 0 : op === ">" ? order > 0 : op === "<=" ? order <= 0 : order >= 0;
  };
}

const rank = (item: Scalar) => (typeof item === "number" ? 0 : typeof item === "string" ? 1 : 2);

function conditional(args: Node[], ctx: EvalContext, kind: "count" | "sum" | "average"): Value {
  const range = rangeArg(args[0], ctx);
  if (isError(range)) return range;
  const test = criteria(value(args[1], ctx));
  const sumRange = kind !== "count" && args[2] ? rangeArg(args[2], ctx) : range;
  if (isError(sumRange)) return sumRange;
  let count = 0;
  let total = 0;
  for (let row = 0; row < rangeRows(range); row++) {
    for (let col = 0; col < rangeCols(range); col++) {
      if (!test(rangeAt(range, row, col, ctx))) continue;
      if (kind === "count") {
        count++;
        continue;
      }
      // As in Excel, the sum range starts at its own corner and is as big as the range tested.
      const item = ctx.cell(sumRange.sheetId, sumRange.top + row, sumRange.left + col);
      if (isError(item)) return item;
      if (typeof item === "number") {
        total += item;
        count++;
      }
    }
  }
  if (kind === "count") return count;
  if (kind === "sum") return total;
  return count === 0 ? err("#DIV/0!") : total / count;
}

function round(args: Node[], ctx: EvalContext, mode: "near" | "up" | "down"): Value {
  const number = numberArg(args[0], ctx);
  const digits = numberArg(args[1], ctx, 0);
  if (isError(number)) return number;
  if (isError(digits)) return digits;
  const factor = 10 ** Math.trunc(digits);
  // A little nudge for float noise: ROUND(1.005, 2) is 1.01 as in Excel.
  const scaled = Number((Math.abs(number) * factor).toPrecision(15));
  const rounded = mode === "near" ? Math.round(scaled) : mode === "up" ? Math.ceil(scaled) : Math.floor(scaled);
  return (Math.sign(number) * rounded) / factor;
}

function significance(args: Node[], ctx: EvalContext, up: boolean): Value {
  const number = numberArg(args[0], ctx);
  const step = numberArg(args[1], ctx, 1);
  if (isError(number)) return number;
  if (isError(step)) return step;
  if (step === 0) return up ? 0 : err("#DIV/0!");
  if (number > 0 && step < 0) return err("#NUM!");
  const ratio = Number((number / step).toPrecision(15));
  return (up ? Math.ceil(ratio) : Math.floor(ratio)) * step;
}

/** The position of `key` in a row or column of values: exact (0), or the largest not above it (1) / smallest not below it (-1) in a sorted list. */
function findIn(key: Scalar, items: Scalar[], mode: number, wildcard = false): number {
  if (mode === 0) {
    const test = wildcard && typeof key === "string" ? criteria(key) : (item: Scalar) => item !== null && !isError(item) && rank(item) === rank(key) && compare(item, key) === 0;
    return items.findIndex(test);
  }
  let found = -1;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item === null || isError(item) || rank(item) !== rank(key)) continue;
    const order = compare(item, key);
    if (mode > 0) {
      if (order <= 0) found = i;
      else break;
    } else {
      if (order >= 0) found = i;
      else break;
    }
  }
  return found;
}

function line(range: RangeRef, ctx: EvalContext): Scalar[] {
  return [...cellsOf(range, ctx)];
}

const FUNCTIONS: Record<string, Fn> = {
  SUM: (args, ctx) => {
    const list = numbers(args, ctx);
    return isError(list) ? list : list.reduce((sum, item) => sum + item, 0);
  },
  AVERAGE: (args, ctx) => {
    const list = numbers(args, ctx);
    if (isError(list)) return list;
    return list.length ? list.reduce((sum, item) => sum + item, 0) / list.length : err("#DIV/0!");
  },
  MIN: (args, ctx) => {
    const list = numbers(args, ctx);
    return isError(list) ? list : list.length ? Math.min(...list) : 0;
  },
  MAX: (args, ctx) => {
    const list = numbers(args, ctx);
    return isError(list) ? list : list.length ? Math.max(...list) : 0;
  },
  COUNT: (args, ctx) => flat(args, ctx).filter((item) => typeof item === "number").length,
  COUNTA: (args, ctx) => flat(args, ctx).filter((item) => item !== null && item !== "").length,
  COUNTIF: (args, ctx) => conditional(args, ctx, "count"),
  SUMIF: (args, ctx) => conditional(args, ctx, "sum"),
  AVERAGEIF: (args, ctx) => conditional(args, ctx, "average"),
  ROUND: (args, ctx) => round(args, ctx, "near"),
  ROUNDUP: (args, ctx) => round(args, ctx, "up"),
  ROUNDDOWN: (args, ctx) => round(args, ctx, "down"),
  ABS: (args, ctx) => {
    const number = numberArg(args[0], ctx);
    return isError(number) ? number : Math.abs(number);
  },
  FLOOR: (args, ctx) => significance(args, ctx, false),
  CEILING: (args, ctx) => significance(args, ctx, true),
  IF: (args, ctx) => {
    const test = toBool(value(args[0], ctx));
    if (isError(test)) return test;
    if (test) return args[1] ? evaluate(args[1], ctx) : true;
    return args[2] ? evaluate(args[2], ctx) : false;
  },
  IFS: (args, ctx) => {
    for (let i = 0; i + 1 < args.length; i += 2) {
      const test = toBool(value(args[i], ctx));
      if (isError(test)) return test;
      if (test) return evaluate(args[i + 1]!, ctx);
    }
    return err("#N/A");
  },
  IFERROR: (args, ctx) => {
    const result = value(args[0], ctx);
    return isError(result) ? value(args[1], ctx) : result;
  },
  AND: (args, ctx) => {
    let result = true;
    for (const item of flat(args, ctx)) {
      if (item === null || typeof item === "string") continue;
      const test = toBool(item);
      if (isError(test)) return test;
      result &&= test;
    }
    return result;
  },
  OR: (args, ctx) => {
    let result = false;
    for (const item of flat(args, ctx)) {
      if (item === null || typeof item === "string") continue;
      const test = toBool(item);
      if (isError(test)) return test;
      result ||= test;
    }
    return result;
  },
  NOT: (args, ctx) => {
    const test = toBool(value(args[0], ctx));
    return isError(test) ? test : !test;
  },
  VLOOKUP: (args, ctx) => {
    const key = value(args[0], ctx);
    if (isError(key)) return key;
    const table = rangeArg(args[1], ctx);
    if (isError(table)) return table;
    const column = numberArg(args[2], ctx);
    if (isError(column)) return column;
    const approximate = args[3] ? toBool(value(args[3], ctx)) : true;
    if (isError(approximate)) return approximate;
    const index = Math.trunc(column);
    if (index < 1) return err("#VALUE!");
    if (index > rangeCols(table)) return err("#REF!");
    const keys: Scalar[] = [];
    for (let row = 0; row < rangeRows(table); row++) keys.push(rangeAt(table, row, 0, ctx));
    const found = findIn(key, keys, approximate ? 1 : 0, !approximate);
    return found < 0 ? err("#N/A") : rangeAt(table, found, index - 1, ctx);
  },
  XLOOKUP: (args, ctx) => {
    const key = value(args[0], ctx);
    if (isError(key)) return key;
    const lookup = rangeArg(args[1], ctx);
    const results = rangeArg(args[2], ctx);
    if (isError(lookup)) return lookup;
    if (isError(results)) return results;
    const matchMode = numberArg(args[4], ctx, 0);
    const searchMode = numberArg(args[5], ctx, 1);
    if (isError(matchMode)) return matchMode;
    if (isError(searchMode)) return searchMode;
    const vertical = rangeCols(lookup) === 1;
    let items = line(lookup, ctx);
    const backwards = searchMode < 0;
    if (backwards) items = [...items].reverse();
    let found = -1;
    if (matchMode === 0 || matchMode === 2) found = findIn(key, items, 0, matchMode === 2);
    else {
      // Next smaller (-1) or next larger (1) when there is no exact match; the list needn't be sorted.
      let best = -1;
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (item === null || isError(item) || rank(item) !== rank(key)) continue;
        const order = compare(item, key);
        if (order === 0) {
          best = i;
          break;
        }
        if ((matchMode < 0 && order < 0 && (best < 0 || compare(item, items[best]!) > 0)) || (matchMode > 0 && order > 0 && (best < 0 || compare(item, items[best]!) < 0))) best = i;
      }
      found = best;
    }
    if (found < 0) return args[3] ? value(args[3], ctx) : err("#N/A");
    const index = backwards ? items.length - 1 - found : found;
    if (vertical) return index < rangeRows(results) ? rangeAt(results, index, 0, ctx) : err("#REF!");
    return index < rangeCols(results) ? rangeAt(results, 0, index, ctx) : err("#REF!");
  },
  INDEX: (args, ctx) => {
    const range = rangeArg(args[0], ctx);
    if (isError(range)) return range;
    const rowArg = numberArg(args[1], ctx, 0);
    const colArg = numberArg(args[2], ctx, 0);
    if (isError(rowArg)) return rowArg;
    if (isError(colArg)) return colArg;
    let row = Math.trunc(rowArg);
    let col = Math.trunc(colArg);
    // INDEX(A1:A9, 3) and INDEX(A1:F1, 3) both mean the third cell.
    if (rangeRows(range) === 1 && args.length === 2) [row, col] = [1, row];
    if (row === 0) row = 1;
    if (col === 0) col = 1;
    if (row < 1 || col < 1 || row > rangeRows(range) || col > rangeCols(range)) return err("#REF!");
    return rangeAt(range, row - 1, col - 1, ctx);
  },
  MATCH: (args, ctx) => {
    const key = value(args[0], ctx);
    if (isError(key)) return key;
    const range = rangeArg(args[1], ctx);
    if (isError(range)) return range;
    const type = numberArg(args[2], ctx, 1);
    if (isError(type)) return type;
    const found = findIn(key, line(range, ctx), Math.sign(type), type === 0);
    return found < 0 ? err("#N/A") : found + 1;
  },
  CONCAT: (args, ctx) => {
    let text = "";
    for (const item of flat(args, ctx)) {
      const part = toText(item);
      if (isError(part)) return part;
      text += part;
    }
    return text;
  },
  LEN: (args, ctx) => {
    const text = toText(value(args[0], ctx));
    return isError(text) ? text : Array.from(text).length;
  },
  LEFT: (args, ctx) => cut(args, ctx, "left"),
  RIGHT: (args, ctx) => cut(args, ctx, "right"),
  UPPER: (args, ctx) => {
    const text = toText(value(args[0], ctx));
    return isError(text) ? text : text.toUpperCase();
  },
  LOWER: (args, ctx) => {
    const text = toText(value(args[0], ctx));
    return isError(text) ? text : text.toLowerCase();
  },
  TODAY: (_args, ctx) => Math.floor(ctx.now()),
  NOW: (_args, ctx) => ctx.now(),
};

function cut(args: Node[], ctx: EvalContext, side: "left" | "right"): Value {
  const text = toText(value(args[0], ctx));
  const count = numberArg(args[1], ctx, 1);
  if (isError(text)) return text;
  if (isError(count)) return count;
  if (count < 0) return err("#VALUE!");
  const chars = Array.from(text);
  const n = Math.trunc(count);
  return side === "left" ? chars.slice(0, n).join("") : chars.slice(Math.max(0, chars.length - n)).join("");
}

/** The functions there are, for autocomplete. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS).sort();
/** Functions that give another answer each time (the clock): their cells are worked out again on every change. */
export const VOLATILE = new Set(["TODAY", "NOW"]);
