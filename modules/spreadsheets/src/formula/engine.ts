// The calculation behind one spreadsheet: every formula read once, what it points at remembered, and only the cells
// that depend on a change worked out again. Values are worked out when asked for (the grid asks for what it shows),
// so a 10,000-row sheet costs nothing until it is looked at. A loop (A1 → B1 → A1) shows #CYCLE! on its cells and
// never hangs; changing one of them works everything out again.
import { cellsOf, evaluate, scalarOf, VOLATILE, type EvalContext } from "./evaluate";
import type { Node } from "./parser";
import { parse } from "./parser";
import { parseCellName } from "./refs";
import { err, isError, isFormula, rawValue, storedDateKind, type Scalar, type ValueHint } from "./values";

/** What the engine needs of a sheet: cells by name ("B2") in their stored form. */
export interface SheetCells {
  id: string;
  name: string;
  cells: Readonly<Record<string, string>>;
}

export interface CellRef {
  sheetId: string;
  row: number;
  col: number;
}

type Key = string;
const COLS = 1024;
const keyOf = (sheetId: string, row: number, col: number): Key => `${sheetId}\u0000${row * COLS + col}`;
function refOf(key: Key): CellRef {
  const at = key.indexOf("\u0000");
  const n = Number(key.slice(at + 1));
  return { sheetId: key.slice(0, at), row: Math.floor(n / COLS), col: n % COLS };
}

interface SheetState {
  id: string;
  name: string;
  cells: Readonly<Record<string, string>>;
  /** Stored cells by row * COLS + col. */
  raw: Map<number, string>;
  extent: { rows: number; cols: number } | null;
}

interface Formula {
  node: Node;
  /** Single cells it reads. */
  cells: Key[];
  /** Ranges it reads, by sheet. */
  ranges: { sheetId: string; top: number; left: number; bottom: number; right: number }[];
  volatile: boolean;
}

interface Listener {
  top: number;
  bottom: number;
  key: Key;
}

export class Workbook {
  private sheets = new Map<string, SheetState>();
  private byName = new Map<string, string>();
  private order = "";
  private formulas = new Map<Key, Formula>();
  /**
   * Formulas not read yet. A formula is parsed the first time its value (or what it reads) is needed: a cell that has
   * never been worked out has nothing to throw away when something it reads changes, so it needs no links yet.
   */
  private pending = new Map<Key, { sheetId: string; source: string }>();
  private values = new Map<Key, Scalar>();
  private dependents = new Map<Key, Set<Key>>();
  /** Formulas reading ranges, by sheet and then by every column the range covers. */
  private listeners = new Map<string, Map<number, Listener[]>>();
  private volatile = new Set<Key>();
  private loops = new Map<Key, Key[]>();
  private evaluating = new Set<Key>();
  private stack: Key[] = [];
  private preparing = false;
  /** Today, fixed for one round of changes. */
  private clock: () => number;

  constructor(sheets: readonly SheetCells[] = [], options: { now?: () => number } = {}) {
    this.clock = options.now ?? localNow;
    this.sync(sheets);
  }

  /**
   * Takes the newest cells. Sheets whose `cells` object is the one from last time are skipped; for the others only
   * the cells that differ are read again, and what depends on them is worked out again. A new, renamed, moved or
   * removed sheet reads everything again. `touched` (cell names by sheet id) says which cells an edit changed, so a
   * big sheet isn't compared cell by cell; sheets not in it are compared.
   */
  sync(sheets: readonly SheetCells[], touched?: ReadonlyMap<string, readonly string[]>): void {
    const order = sheets.map((sheet) => `${sheet.id}\u0001${sheet.name}`).join("\u0002");
    if (order !== this.order) return this.rebuild(sheets, order);
    const changed: Key[] = [];
    for (const sheet of sheets) {
      const state = this.sheets.get(sheet.id)!;
      if (state.cells === sheet.cells) continue;
      const before = state.cells;
      state.cells = sheet.cells;
      const names = touched?.get(sheet.id);
      if (names) {
        for (const name of names) if (before[name] !== sheet.cells[name]) this.setRaw(state, name, sheet.cells[name], changed);
        continue;
      }
      for (const [name, raw] of Object.entries(sheet.cells)) if (before[name] !== raw) this.setRaw(state, name, raw, changed);
      for (const name of Object.keys(before)) if (!(name in sheet.cells)) this.setRaw(state, name, undefined, changed);
    }
    this.invalidate(changed);
  }

  /** Works out everything that reads the clock again (TODAY, NOW). */
  tick(): void {
    this.invalidate([...this.volatile]);
  }

  value(sheetId: string, row: number, col: number): Scalar {
    return this.cellValue(keyOf(sheetId, row, col));
  }

  /** How a cell's number is best shown when it has no format of its own: a date for TODAY() and dates. */
  hint(sheetId: string, row: number, col: number): ValueHint {
    return this.hintOf(keyOf(sheetId, row, col), 0);
  }

  /** The cells of the loop a cell is in, starting with itself, or undefined. */
  loop(sheetId: string, row: number, col: number): CellRef[] | undefined {
    const key = keyOf(sheetId, row, col);
    this.cellValue(key);
    const members = this.loops.get(key);
    if (!members) return undefined;
    const start = members.indexOf(key);
    return [...members.slice(start), ...members.slice(0, start)].map(refOf);
  }

  sheetName(sheetId: string): string | undefined {
    return this.sheets.get(sheetId)?.name;
  }

  /** How far a sheet is used: one past the last row and column with something in them. */
  extent(sheetId: string): { rows: number; cols: number } {
    const state = this.sheets.get(sheetId);
    if (!state) return { rows: 0, cols: 0 };
    if (!state.extent) {
      let rows = 0;
      let cols = 0;
      for (const n of state.raw.keys()) {
        rows = Math.max(rows, Math.floor(n / COLS) + 1);
        cols = Math.max(cols, (n % COLS) + 1);
      }
      state.extent = { rows, cols };
    }
    return state.extent;
  }

  // ── Reading cells in

  private rebuild(sheets: readonly SheetCells[], order: string) {
    this.sheets.clear();
    this.byName.clear();
    this.formulas.clear();
    this.pending.clear();
    this.values.clear();
    this.dependents.clear();
    this.listeners.clear();
    this.volatile.clear();
    this.loops.clear();
    this.order = order;
    for (const sheet of sheets) {
      this.sheets.set(sheet.id, { id: sheet.id, name: sheet.name, cells: sheet.cells, raw: new Map(), extent: null });
      if (!this.byName.has(sheet.name.toLowerCase())) this.byName.set(sheet.name.toLowerCase(), sheet.id);
    }
    const ignored: Key[] = [];
    for (const sheet of sheets) {
      const state = this.sheets.get(sheet.id)!;
      for (const [name, raw] of Object.entries(sheet.cells)) this.setRaw(state, name, raw, ignored);
    }
  }

  private setRaw(state: SheetState, name: string, raw: string | undefined, changed: Key[]) {
    const at = parseCellName(name);
    if (!at || at.col >= COLS) return;
    const n = at.row * COLS + at.col;
    const key = keyOf(state.id, at.row, at.col);
    if (raw === undefined || raw === "") state.raw.delete(n);
    else state.raw.set(n, raw);
    state.extent = null;
    this.forget(key);
    if (raw !== undefined && isFormula(raw)) this.pending.set(key, { sheetId: state.id, source: raw.slice(1) });
    changed.push(key);
  }

  private remember(key: Key, sheetId: string, source: string) {
    const node = parse(source);
    const formula: Formula = { node, cells: [], ranges: [], volatile: false };
    walk(node, (part) => {
      if (part.kind === "call" && VOLATILE.has(part.name)) formula.volatile = true;
      if (part.kind !== "ref") return;
      const target = part.sheet === undefined ? sheetId : this.byName.get(part.sheet.toLowerCase());
      if (target === undefined) return;
      const { a, b } = part;
      if (!b) {
        if (a.row !== null && a.col !== null) formula.cells.push(keyOf(target, a.row, a.col));
        return;
      }
      const whole = Number.MAX_SAFE_INTEGER;
      formula.ranges.push({
        sheetId: target,
        top: a.row === null || b.row === null ? 0 : Math.min(a.row, b.row),
        bottom: a.row === null || b.row === null ? whole : Math.max(a.row, b.row),
        left: a.col === null || b.col === null ? 0 : Math.min(a.col, b.col),
        right: a.col === null || b.col === null ? 255 : Math.max(a.col, b.col),
      });
    });
    this.formulas.set(key, formula);
    for (const cell of formula.cells) {
      let set = this.dependents.get(cell);
      if (!set) this.dependents.set(cell, (set = new Set()));
      set.add(key);
    }
    for (const range of formula.ranges) {
      let columns = this.listeners.get(range.sheetId);
      if (!columns) this.listeners.set(range.sheetId, (columns = new Map()));
      for (let col = range.left; col <= range.right; col++) {
        let list = columns.get(col);
        if (!list) columns.set(col, (list = []));
        list.push({ top: range.top, bottom: range.bottom, key });
      }
    }
    if (formula.volatile) this.volatile.add(key);
  }

  /** A cell's formula, read now if it wasn't yet. */
  private formulaOf(key: Key): Formula | undefined {
    const known = this.formulas.get(key);
    if (known) return known;
    const waiting = this.pending.get(key);
    if (!waiting) return undefined;
    this.pending.delete(key);
    this.remember(key, waiting.sheetId, waiting.source);
    return this.formulas.get(key);
  }

  private isFormulaCell = (key: Key) => this.formulas.has(key) || this.pending.has(key);

  private forget(key: Key) {
    this.pending.delete(key);
    const formula = this.formulas.get(key);
    if (!formula) return;
    this.formulas.delete(key);
    this.volatile.delete(key);
    for (const cell of formula.cells) this.dependents.get(cell)?.delete(key);
    for (const range of formula.ranges) {
      const columns = this.listeners.get(range.sheetId);
      if (!columns) continue;
      for (let col = range.left; col <= range.right; col++) {
        const list = columns.get(col);
        if (!list) continue;
        const at = list.findIndex((listener) => listener.key === key && listener.top === range.top && listener.bottom === range.bottom);
        if (at >= 0) list.splice(at, 1);
      }
    }
  }

  /** Drops the worked-out values of the changed cells and of everything that reads them, however far down. */
  private invalidate(changed: readonly Key[]) {
    const seen = new Set<Key>();
    const queue = [...changed];
    while (queue.length) {
      const key = queue.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      this.values.delete(key);
      this.loops.delete(key);
      for (const dependent of this.dependents.get(key) ?? []) if (!seen.has(dependent)) queue.push(dependent);
      const { sheetId, row, col } = refOf(key);
      for (const listener of this.listeners.get(sheetId)?.get(col) ?? []) {
        if (row >= listener.top && row <= listener.bottom && !seen.has(listener.key)) queue.push(listener.key);
      }
    }
    // Loops are found again on the way, so a member left over from an older loop is cleared with the rest.
    for (const [key, members] of this.loops) if (members.some((member) => seen.has(member))) this.loops.delete(key);
  }

  // ── Working cells out

  private context(sheetId: string): EvalContext {
    return {
      sheetId,
      resolveSheet: (name) => this.byName.get(name.toLowerCase()) ?? null,
      cell: (target, row, col) => this.cellValue(keyOf(target, row, col)),
      extent: (target) => this.extent(target),
      now: this.clock,
    };
  }

  private cellValue(key: Key): Scalar {
    if (this.values.has(key)) return this.values.get(key)!;
    const formula = this.formulaOf(key);
    const { sheetId, row, col } = refOf(key);
    if (!formula) {
      const value = rawValue(this.sheets.get(sheetId)?.raw.get(row * COLS + col));
      if (value !== null) this.values.set(key, value);
      return value;
    }
    // From the outside, the cells it needs are worked out first, deepest first and without recursion, so a chain
    // 10,000 cells long (a running total) never runs out of stack.
    if (this.stack.length === 0 && !this.preparing) this.prepare(key);
    if (this.evaluating.has(key)) {
      // A loop: every cell from the first visit of this one up to here is part of it.
      const members = this.stack.slice(this.stack.lastIndexOf(key));
      for (const member of members) this.loops.set(member, members);
      return err("#CYCLE!");
    }
    this.evaluating.add(key);
    this.stack.push(key);
    let result: Scalar;
    try {
      result = scalarOf(evaluate(formula.node, this.context(sheetId)), this.context(sheetId));
      // A range on its own (=A1:A3) is no single value.
    } catch (error) {
      // A chain thousands of cells deep can run out of stack; better an error than a broken panel.
      if (!(error instanceof RangeError)) throw error;
      result = err("#VALUE!");
    } finally {
      this.evaluating.delete(key);
      this.stack.pop();
    }
    if (this.loops.has(key)) result = err("#CYCLE!");
    if (result === null) result = 0;
    this.values.set(key, result);
    return result;
  }

  /** Works out the formulas a cell depends on that have no value yet, those furthest away first. */
  private prepare(start: Key) {
    const order: Key[] = [];
    const visited = new Set<Key>();
    const todo: [Key, boolean][] = [[start, false]];
    while (todo.length) {
      const [key, done] = todo.pop()!;
      if (done) {
        order.push(key);
        continue;
      }
      if (visited.has(key)) continue;
      visited.add(key);
      const formula = this.formulaOf(key);
      if (!formula) continue;
      todo.push([key, true]);
      const add = (other: Key) => {
        if (!visited.has(other) && !this.values.has(other) && this.isFormulaCell(other)) todo.push([other, false]);
      };
      for (const cell of formula.cells) add(cell);
      for (const range of formula.ranges) {
        const extent = this.extent(range.sheetId);
        const bottom = Math.min(range.bottom, extent.rows - 1);
        const right = Math.min(range.right, extent.cols - 1);
        if ((bottom - range.top + 1) * (right - range.left + 1) > 200_000) continue;
        for (let row = range.top; row <= bottom; row++) for (let col = range.left; col <= right; col++) add(keyOf(range.sheetId, row, col));
      }
    }
    // The last one is the cell itself, worked out by the caller.
    order.pop();
    this.preparing = true;
    try {
      for (const key of order) if (!this.values.has(key)) this.cellValue(key);
    } finally {
      this.preparing = false;
    }
  }

  private hintOf(key: Key, depth: number): ValueHint {
    if (depth > 8) return undefined;
    const formula = this.formulaOf(key);
    const { sheetId, row, col } = refOf(key);
    if (!formula) {
      const raw = this.sheets.get(sheetId)?.raw.get(row * COLS + col);
      return raw === undefined ? undefined : storedDateKind(raw);
    }
    const value = this.cellValue(key);
    if (typeof value !== "number" || isError(value)) return undefined;
    return this.nodeHint(formula.node, sheetId, depth);
  }

  private nodeHint(node: Node, sheetId: string, depth: number): ValueHint {
    switch (node.kind) {
      case "call":
        if (node.name === "TODAY") return "date";
        if (node.name === "NOW") return "datetime";
        if ((node.name === "MIN" || node.name === "MAX" || node.name === "IF" || node.name === "IFERROR") && node.args.length) {
          const first = node.name === "IF" ? node.args[1] : node.args[0];
          return first ? this.nodeHint(first, sheetId, depth) : undefined;
        }
        return undefined;
      case "ref": {
        const target = node.sheet === undefined ? sheetId : this.byName.get(node.sheet.toLowerCase());
        if (target === undefined || node.a.row === null || node.a.col === null) return undefined;
        return this.hintOf(keyOf(target, node.a.row, node.a.col), depth + 1);
      }
      case "binary":
        if (node.op === "+" || node.op === "-") {
          const left = this.nodeHint(node.left, sheetId, depth);
          const right = this.nodeHint(node.right, sheetId, depth);
          // A date minus a date is a number of days.
          if (node.op === "-" && left && right) return undefined;
          return left ?? (node.op === "+" ? right : undefined);
        }
        return undefined;
      default:
        return undefined;
    }
  }

  /** The values of a range, for the sum and count under the grid. */
  *rangeValues(sheetId: string, top: number, left: number, bottom: number, right: number): Generator<Scalar> {
    yield* cellsOf({ kind: "range", sheetId, top, left, bottom, right }, this.context(sheetId));
  }
}

function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  if (node.kind === "call") for (const arg of node.args) walk(arg, visit);
  else if (node.kind === "unary" || node.kind === "percent") walk(node.arg, visit);
  else if (node.kind === "binary") {
    walk(node.left, visit);
    walk(node.right, visit);
  }
}

/** Now as a day number in local time, as Excel shows it. */
function localNow(): number {
  const now = new Date();
  return (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()) - Date.UTC(1899, 11, 30)) / 86_400_000;
}
