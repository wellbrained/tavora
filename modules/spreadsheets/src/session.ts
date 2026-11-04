// One open spreadsheet in one panel: its document, the calculation, the undo history, and every change the toolbar,
// the keys and the grid make. No Vue components here, so it is tested with the SDK's memory host: two panels on one
// spreadsheet, undo next to another panel, saving when the panel goes.
import type { FillPlan, GridRange } from "@tavora/official-ui/components/ui/data-grid";
import { computed, ref, shallowRef, type Ref } from "vue";
import type { CopiedCell, PastedCells } from "./clipboard";
import { displayValue, inputToStored, plainValue, storedToInput, type DisplayTexts } from "./display";
import { Workbook, type CellRef } from "./formula/engine";
import type { Lang } from "./formula/locale";
import { cellLabel, cellName, parseCellName, rangeName, type CellRange } from "./formula/refs";
import { isError, isFormula, rawValue, storedDate, type Scalar } from "./formula/values";
import { History, replay, type Step } from "./history";
import { LIMITS, columnView, fitsStore, formatAt, freeSheetName, setFormat, setStyle, sheetById, sheetByName, styleAt, usedSize, type CellFormat, type CellStyle, type ColumnFilter, type Sheet, type StoredColumnFilter, type SpreadsheetData } from "./model";
import { addSheet, clearRange, deleteSheet, movedRaw, orderSheets, renameSheet, setCells, shiftSheet } from "./ops";
import type { SpreadsheetHandle } from "./store";
import { fillCells, hiddenRows, isActive, sortOrder, sortedCells, type SortKey } from "./table";

/** What a change could not do, for a message. */
export type Refusal =
  | { kind: "tooBig"; limit: "rows" | "cols" | "sheets" | "bytes" }
  | { kind: "kept"; count: number }
  /** A step that moves rows, columns or sheets around can't be taken back in part: another panel changed what it touched. */
  | { kind: "blocked" }
  | { kind: "nothing" };

export interface SessionOptions {
  lang: Ref<Lang>;
  texts: () => DisplayTexts;
  /** Now, for Ctrl+; and TODAY(). */
  now?: () => Date;
  /** Hears every change that was refused (too big for the store), so the panel can say so. */
  refused?: (refusal: Refusal) => void;
}

const sheetsOf = (doc: SpreadsheetData) => doc.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name, cells: sheet.cells }));

export function createSession(handle: SpreadsheetHandle, options: SessionOptions) {
  const doc = shallowRef<SpreadsheetData>(handle.data);
  const engine = new Workbook(sheetsOf(handle.data));
  const history = new History();
  /** Goes up on every change, so views that read cells draw again. */
  const version = ref(0);
  const canUndo = ref(false);
  const canRedo = ref(false);
  const sheetId = ref(handle.data.sheets[0]!.id);
  /** The cells the last local edit touched, so the calculation doesn't compare whole sheets. */
  let touched: Map<string, string[]> | undefined;
  /** What the last refused change was, for the functions that answer with it. */
  let lastRefusal: Refusal | null = null;
  /** A change's answer: null when it went through, else why not. */
  const outcome = (changes: Step["changes"] | null): Refusal | null => (changes === null ? lastRefusal : null);

  const sync = () => {
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  };

  const stop = handle.onChange((event) => {
    doc.value = event.data;
    engine.sync(sheetsOf(event.data), event.source === "local" ? touched : undefined);
    touched = undefined;
    if (!sheetById(event.data, sheetId.value)) sheetId.value = event.data.sheets[0]!.id;
    version.value++;
  });

  const sheet = computed<Sheet>(() => {
    void version.value;
    return sheetById(doc.value, sheetId.value) ?? doc.value.sheets[0]!;
  });

  // ── Changing it

  /**
   * Applies a change, remembers it for Undo and saves it soon. `names` lists the cells it sets on the current sheet,
   * when that's all it does; it lets the calculation skip comparing the sheet.
   *
   * Every change is tried on a copy first: one that would make the document bigger than the store takes (4 MB) is
   * refused before anything changes, and null comes back.
   */
  function change(label: string, apply: (draft: SpreadsheetData) => void, names?: string[]): Step["changes"] | null {
    const trial = structuredClone(handle.data);
    apply(trial);
    if (!fitsStore(trial)) {
      const refusal: Refusal = { kind: "tooBig", limit: "bytes" };
      lastRefusal = refusal;
      options.refused?.(refusal);
      return null;
    }
    const before = handle.data;
    touched = names ? new Map([[sheetId.value, names]]) : undefined;
    handle.update(apply);
    const changes = history.record(label, before, handle.data);
    sync();
    return changes;
  }

  /**
   * Takes back one change on its own (a delete's Undo on its toast), as far as nothing newer is in its way. False
   * when it couldn't come back at all.
   */
  function revert(changes: Step["changes"]): boolean {
    let result = { done: [] as Step["changes"], skipped: 0 };
    const before = handle.data;
    handle.update((draft) => {
      // All or nothing: a sheet comes back whole, with its formulas, or not at all.
      result = replay(draft, changes, "undo", true);
    });
    history.record("revert", before, handle.data);
    sync();
    return result.done.length > 0;
  }

  const onSheet = (draft: SpreadsheetData, id = sheetId.value): Sheet | undefined => sheetById(draft, id);

  /** Undo or redo one step: what another panel changed since stays, and the answer says how much. */
  function step(direction: "undo" | "redo"): Refusal | null {
    const taken = direction === "undo" ? history.takeUndo() : history.takeRedo();
    if (!taken) return { kind: "nothing" };
    let result = { done: taken.changes, skipped: 0 };
    handle.update((draft) => {
      result = replay(draft, taken.changes, direction, taken.whole);
    });
    sync();
    // A step that moves rows, columns or sheets is put back whole or not at all; one that can't is dropped.
    if (taken.whole && result.done.length === 0 && result.skipped) return { kind: "blocked" };
    const kept: Step = { label: taken.label, changes: result.done, whole: taken.whole };
    if (direction === "undo") history.pushRedo(kept);
    else history.pushUndo(kept);
    sync();
    return result.skipped ? { kind: "kept", count: result.skipped } : null;
  }

  // ── Reading cells

  const rawAt = (row: number, col: number, id = sheetId.value): string | undefined => sheetById(doc.value, id)?.cells[cellName(row, col)];
  const valueAt = (row: number, col: number, id = sheetId.value): Scalar => engine.value(id, row, col);
  const formatOf = (row: number, col: number): CellFormat => formatAt(sheet.value, row, col);
  const styleOf = (row: number, col: number): CellStyle => styleAt(sheet.value, row, col);

  /** What a cell shows. */
  function shownAt(row: number, col: number, id = sheetId.value): string {
    const target = sheetById(doc.value, id);
    if (!target) return "";
    const raw = target.cells[cellName(row, col)];
    if (raw === undefined) return "";
    const value = engine.value(id, row, col);
    return displayValue(value, engine.hint(id, row, col), formatAt(target, row, col), options.lang.value, options.texts());
  }

  /** What editing a cell starts with. */
  const editTextAt = (row: number, col: number): string => storedToInput(rawAt(row, col), formatOf(row, col), options.lang.value);

  /** The cells of the loop a cell is in, by name, or undefined. */
  function loopAt(row: number, col: number): string[] | undefined {
    const loop = engine.loop(sheetId.value, row, col);
    return loop?.map((cell: CellRef) => cellLabel(cell.row, cell.col, cell.sheetId === sheetId.value ? undefined : engine.sheetName(cell.sheetId)));
  }

  const used = computed(() => {
    void version.value;
    return usedSize(sheet.value);
  });

  /** Rows the filter hides, below the header row. */
  const hidden = computed<ReadonlySet<number>>(() => {
    void version.value;
    const current = sheet.value;
    if (!current.filter) return new Set();
    return hiddenRows(current.filter, current.header ? 1 : 0, used.value.rows, (row, col) => shownAt(row, col), (row, col) => valueAt(row, col));
  });

  // ── Cells

  /** Keeps what was typed into a cell. A format the typing asked for ("50 %") goes to that cell. */
  function commit(row: number, col: number, input: string): void {
    const format = formatOf(row, col);
    const stored = inputToStored(input, format, options.lang.value);
    const name = cellName(row, col);
    const before = rawAt(row, col);
    if ((stored.raw || undefined) === before && !stored.format) return;
    change("edit", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      setCells(target, [[name, stored.raw || null]]);
      if (stored.format && formatAt(target, row, col).type === "auto") setFormat(target, { top: row, left: col, bottom: row, right: col }, stored.format);
    }, stored.format ? undefined : [name]);
  }

  function clear(range: GridRange): void {
    const names = Object.keys(sheet.value.cells).filter((name) => {
      const at = parseCellName(name)!;
      return at.row >= range.top && at.row <= range.bottom && at.col >= range.left && at.col <= range.right;
    });
    if (!names.length) return;
    change("clear", (draft) => void (onSheet(draft) && clearRange(onSheet(draft)!, range)), names);
  }

  function fill(plan: FillPlan, mode: "series" | "copy"): Refusal | null {
    if (plan.target.bottom >= LIMITS.rows || plan.target.right >= LIMITS.cols) return { kind: "tooBig", limit: plan.target.bottom >= LIMITS.rows ? "rows" : "cols" };
    const entries = fillCells(plan, (row, col) => rawAt(row, col), mode);
    return outcome(change("fill", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      setCells(target, entries);
      // Formats and looks go along with what they fill, as in Excel.
      copyLooks(target, plan.source, plan.target);
    }));
  }

  /** Repeats the source's formats and looks over the target. */
  function copyLooks(target: Sheet, source: CellRange, into: CellRange): void {
    const height = source.bottom - source.top + 1;
    const width = source.right - source.left + 1;
    const wrap = (value: number, start: number, size: number) => start + ((((value - start) % size) + size) % size);
    // One rule per run of rows in a column that get the same format, not one per cell.
    for (let col = into.left; col <= into.right; col++) {
      let runStart = into.top;
      let runFormat: CellFormat | null = null;
      const flush = (end: number) => {
        if (runFormat) setFormat(target, { top: runStart, left: col, bottom: end, right: col }, runFormat);
      };
      for (let row = into.top; row <= into.bottom + 1; row++) {
        const wanted = row > into.bottom ? null : formatAt(target, wrap(row, source.top, height), wrap(col, source.left, width));
        const same = wanted && runFormat && JSON.stringify(wanted) === JSON.stringify(runFormat);
        if (same) continue;
        flush(row - 1);
        runStart = row;
        runFormat = wanted && JSON.stringify(wanted) !== JSON.stringify(formatAt(target, row, col)) ? wanted : null;
      }
    }
    // Looks per column of the source, over the whole target height (fills are usually a column of one look).
    for (let col = into.left; col <= into.right; col++) {
      const fromCol = source.left + ((((col - source.left) % width) + width) % width);
      const look = styleAt(target, source.bottom, fromCol);
      const current = styleAt(target, into.top, col);
      if (JSON.stringify(look) !== JSON.stringify(current)) setStyle(target, { top: into.top, left: col, bottom: into.bottom, right: col }, { bold: look.bold ?? false, italic: look.italic ?? false, align: look.align, wrap: look.wrap ?? false, color: look.color, fill: look.fill });
    }
  }

  /** What a copy puts on the clipboard: shown text for other apps, stored cells for Tavora. */
  function copy(range: GridRange): CopiedCell[][] {
    const rows: CopiedCell[][] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      if (hidden.value.has(row)) continue;
      const line: CopiedCell[] = [];
      for (let col = range.left; col <= range.right; col++) {
        const style = styleOf(row, col);
        const value = valueAt(row, col);
        const format = formatOf(row, col);
        // Numbers go out as the shown text only when they have a format; plain ones stay plain so other apps read them.
        const text = typeof value === "number" && format.type === "auto" && !engine.hint(sheetId.value, row, col) ? plainValue(value) : shownAt(row, col);
        line.push({ text: rawAt(row, col) === undefined ? "" : text, raw: rawAt(row, col) ?? null, bold: !!style.bold, italic: !!style.italic });
      }
      rows.push(line);
    }
    return rows;
  }

  /**
   * Pastes at the active cell, or repeats a single cell over a bigger selection. Grows the sheet; refuses (changing
   * nothing) what would go past the limits.
   */
  function paste(at: { row: number; col: number }, selection: GridRange, cells: PastedCells): Refusal | null {
    const height = cells.rows.length;
    const width = Math.max(0, ...cells.rows.map((row) => row.length));
    if (!height || !width) return { kind: "nothing" };
    const repeat = height === 1 && width === 1 && (selection.bottom > selection.top || selection.right > selection.left);
    const top = repeat ? selection.top : at.row;
    const left = repeat ? selection.left : at.col;
    const bottom = repeat ? selection.bottom : top + height - 1;
    const right = repeat ? selection.right : left + width - 1;
    if (bottom >= LIMITS.rows) return { kind: "tooBig", limit: "rows" };
    if (right >= LIMITS.cols) return { kind: "tooBig", limit: "cols" };
    const entries: [string, string | null][] = [];
    const bold: [number, number, boolean][] = [];
    const italic: [number, number, boolean][] = [];
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        const source = cells.rows[repeat ? 0 : row - top]?.[repeat ? 0 : col - left];
        if (!source) continue;
        let raw: string | null;
        if (source.raw !== undefined) {
          const from = cells.from;
          raw = source.raw === "" ? null : from ? movedRaw(source.raw, row - (from.top + (repeat ? 0 : row - top)), col - (from.left + (repeat ? 0 : col - left))) : source.raw;
        } else raw = inputToStored(source.text ?? "", formatOf(row, col), options.lang.value).raw || null;
        entries.push([cellName(row, col), raw]);
        if (source.bold !== undefined || cells.from) bold.push([row, col, !!source.bold]);
        if (source.italic !== undefined || cells.from) italic.push([row, col, !!source.italic]);
      }
    }
    const apply = (draft: SpreadsheetData) => {
      const target = onSheet(draft);
      if (!target) return;
      setCells(target, entries);
      for (const [row, col, on] of bold) if (!!styleAt(target, row, col).bold !== on) setStyle(target, { top: row, left: col, bottom: row, right: col }, { bold: on });
      for (const [row, col, on] of italic) if (!!styleAt(target, row, col).italic !== on) setStyle(target, { top: row, left: col, bottom: row, right: col }, { italic: on });
    };
    // A paste that would make the document too big for the store is refused in change(), before anything changes.
    return outcome(change("paste", apply));
  }

  // ── Looks and formats

  function styleRange(range: GridRange, look: CellStyle): void {
    change("style", (draft) => void (onSheet(draft) && setStyle(onSheet(draft)!, range, look)));
  }

  /** Bold or italic on, unless the active cell has it already: then off for the whole range. */
  function toggleStyle(range: GridRange, active: { row: number; col: number }, key: "bold" | "italic" | "wrap"): void {
    styleRange(range, { [key]: !styleOf(active.row, active.col)[key] });
  }

  function formatRange(range: GridRange, format: CellFormat): void {
    change("format", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      setFormat(target, range, format);
      // A checkbox needs yes or no: empty cells stay empty, everything else becomes TRUE or FALSE.
      if (format.type === "checkbox") {
        for (const [name, raw] of Object.entries(target.cells)) {
          const at = parseCellName(name)!;
          if (at.row < range.top || at.row > range.bottom || at.col < range.left || at.col > range.right || isFormula(raw)) continue;
          const value = rawValue(raw);
          if (typeof value !== "boolean") target.cells[name] = value === 0 || value === "" || value === null ? "FALSE" : "TRUE";
        }
      }
    });
  }

  /** Space on checkbox cells: all ticked unless the active one is, then all unticked. Formulas stay. */
  function toggleChecks(range: GridRange, active: { row: number; col: number }): boolean {
    if (formatOf(active.row, active.col).type !== "checkbox") return false;
    const on = valueAt(active.row, active.col) !== true;
    const entries: [string, string][] = [];
    for (let row = range.top; row <= range.bottom; row++) {
      for (let col = range.left; col <= range.right; col++) {
        if (hidden.value.has(row) || formatOf(row, col).type !== "checkbox" || isFormula(rawAt(row, col) ?? "")) continue;
        entries.push([cellName(row, col), on ? "TRUE" : "FALSE"]);
      }
    }
    if (entries.length) change("check", (draft) => void (onSheet(draft) && setCells(onSheet(draft)!, entries)), entries.map(([name]) => name));
    return true;
  }

  function setRaw(row: number, col: number, raw: string | null, label = "edit"): void {
    const name = cellName(row, col);
    change(label, (draft) => void (onSheet(draft) && setCells(onSheet(draft)!, [[name, raw]])), [name]);
  }

  /** Ctrl+; puts today's date in the active cell. */
  function insertToday(row: number, col: number): void {
    const now = options.now?.() ?? new Date();
    const day = storedDate((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000);
    setRaw(row, col, day, "today");
  }

  // ── Rows, columns, sheets

  function shift(axis: "row" | "col", at: number, count: number): Refusal | null {
    if (count > 0) {
      const size = axis === "row" ? used.value.rows : used.value.cols;
      if (size + count > (axis === "row" ? LIMITS.rows : LIMITS.cols)) return { kind: "tooBig", limit: axis === "row" ? "rows" : "cols" };
    }
    return outcome(change(axis === "row" ? "rows" : "cols", (draft) => shiftSheet(draft, sheetId.value, axis, at, count)));
  }

  function resize(axis: "row" | "col", index: number, size: number): void {
    change("size", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      if (axis === "col") target.colWidths = { ...target.colWidths, [index]: Math.round(size) };
      else target.rowHeights = { ...target.rowHeights, [index]: Math.round(size) };
    });
  }

  function freeze(rows: number, cols: number): void {
    change("freeze", (draft) => {
      const target = onSheet(draft);
      if (target) target.frozen = { rows: Math.max(0, Math.min(50, rows)), cols: Math.max(0, Math.min(20, cols)) };
    });
  }

  function setHeader(on: boolean): void {
    change("header", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      target.header = on;
      // The filter's ▾ live in the header row.
      if (!on) target.filter = null;
    });
  }

  function addNewSheet(id: string, base: string): Refusal | null {
    if (doc.value.sheets.length >= LIMITS.sheets) return { kind: "tooBig", limit: "sheets" };
    const name = freeSheetName(doc.value, base);
    const at = doc.value.sheets.findIndex((item) => item.id === sheetId.value) + 1;
    const changes = change("addSheet", (draft) => void addSheet(draft, id, sheetByName(draft, name) ? freeSheetName(draft, base) : name, at));
    if (changes) sheetId.value = id;
    return outcome(changes);
  }

  /** Renames a sheet; false when another sheet has that name. */
  function renameSheetTo(id: string, name: string): boolean {
    const clash = sheetByName(doc.value, name);
    if (clash && clash.id !== id) return false;
    return change("renameSheet", (draft) => renameSheet(draft, id, name)) !== null;
  }

  /** Takes a sheet out (never the last one); what changed, for the toast's Undo, or null. */
  function removeSheet(id: string): Step["changes"] | null {
    if (doc.value.sheets.length <= 1) return null;
    const index = doc.value.sheets.findIndex((item) => item.id === id);
    const next = (doc.value.sheets[index + 1] ?? doc.value.sheets[index - 1])!.id;
    const changes = change("deleteSheet", (draft) => deleteSheet(draft, id));
    if (changes && id === sheetId.value) sheetId.value = next;
    return changes;
  }

  const reorderSheets = (ids: string[]) => change("orderSheets", (draft) => orderSheets(draft, ids));

  // ── Sort and filter

  /** Sorts a range's rows (the sheet's used rows below the header when the range is one cell or whole columns). */
  function sort(range: GridRange, keys: SortKey[]): void {
    const current = sheet.value;
    const wholeSheet = range.top === range.bottom && range.left === range.right;
    const top = wholeSheet || range.bottom - range.top + 1 >= used.value.rows ? (current.header ? 1 : 0) : current.header && range.top === 0 ? 1 : range.top;
    const bottom = wholeSheet ? used.value.rows - 1 : Math.min(range.bottom, used.value.rows - 1);
    const left = wholeSheet ? 0 : range.left;
    const right = wholeSheet ? Math.max(0, used.value.cols - 1) : Math.min(range.right, Math.max(0, used.value.cols - 1));
    if (bottom <= top) return;
    const order = sortOrder(top, bottom, keys, (row, col) => valueAt(row, col));
    if (order.every((from, index) => from === top + index)) return;
    const entries = sortedCells(order, top, left, right, (row, col) => rawAt(row, col));
    change("sort", (draft) => void (onSheet(draft) && setCells(onSheet(draft)!, entries)));
  }

  /** Sets one column's filter (null takes it off). */
  function setColumnFilter(col: number, filter: ColumnFilter | null): void {
    change("filter", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      const columns = { ...(target.filter?.columns ?? {}) };
      if (filter && isActive(filter)) columns[col] = { ...filter };
      else delete columns[col];
      target.filter = { ...(target.filter ?? {}), columns };
    });
  }

  /** Changes some conditions of a column's filter; the rest, and anything a newer copy saved there, stays. */
  function updateColumnFilter(col: number, update: Partial<ColumnFilter>): void {
    change("filter", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      const columns = { ...(target.filter?.columns ?? {}) };
      const next = { ...columns[col], ...update } as StoredColumnFilter;
      if (isActive(next)) columns[col] = next;
      else delete columns[col];
      target.filter = { ...(target.filter ?? {}), columns };
    });
  }

  function clearFilter(): void {
    change("filter", (draft) => {
      const target = onSheet(draft);
      if (target) target.filter = target.header ? { columns: {} } : null;
    });
  }

  /** Turns the filter on (marking the first row as the header) or off. */
  function toggleFilter(): void {
    const on = !sheet.value.filter;
    change("filter", (draft) => {
      const target = onSheet(draft);
      if (!target) return;
      target.header = target.header || on;
      target.filter = on ? { columns: {} } : null;
    });
  }

  const columnFilter = (col: number): ColumnFilter => columnView(sheet.value.filter?.columns[col]);

  /** The different texts a column shows below the header, for the filter's tick list. */
  function columnValues(col: number): string[] {
    const seen = new Set<string>();
    for (let row = sheet.value.header ? 1 : 0; row < used.value.rows; row++) seen.add(shownAt(row, col));
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  }

  // ── Whole spreadsheet

  function rename(name: string): void {
    change("rename", (draft) => void (draft.name = name));
  }

  /** Puts sheets in (from a CSV): refused whole when it doesn't fit. */
  function addFilledSheet(id: string, name: string, cells: Record<string, string>): Refusal | null {
    if (doc.value.sheets.length >= LIMITS.sheets) return { kind: "tooBig", limit: "sheets" };
    const changes = change("import", (draft) => {
      const unique = sheetByName(draft, name) ? freeSheetName(draft, `${name} `) : name;
      addSheet(draft, id, unique);
      sheetById(draft, id)!.cells = { ...cells };
    });
    if (changes) sheetId.value = id;
    return outcome(changes);
  }

  /** The sum and count of the selection's filled cells (hidden rows count, as in Excel). */
  function summary(range: GridRange): { sum: number; count: number; numbers: number } {
    let sum = 0;
    let count = 0;
    let numbers = 0;
    for (const name of Object.keys(sheet.value.cells)) {
      const at = parseCellName(name)!;
      if (at.row < range.top || at.row > range.bottom || at.col < range.left || at.col > range.right) continue;
      const value = valueAt(at.row, at.col);
      if (value === null || value === "") continue;
      count++;
      if (typeof value === "number" && !isError(value)) {
        sum += value;
        numbers++;
      }
    }
    return { sum, count, numbers };
  }

  return {
    doc,
    sheet,
    sheetId,
    version,
    used,
    hidden,
    canUndo,
    canRedo,
    engine,
    rawAt,
    valueAt,
    shownAt,
    editTextAt,
    formatOf,
    styleOf,
    loopAt,
    /** Whether a cell's chain of formulas was too deep to work out. */
    tooDeepAt: (row: number, col: number) => engine.tooDeep(sheetId.value, row, col),
    commit,
    clear,
    fill,
    copy,
    paste,
    styleRange,
    toggleStyle,
    formatRange,
    toggleChecks,
    setRaw,
    insertToday,
    shift,
    resize,
    freeze,
    setHeader,
    addNewSheet,
    renameSheet: renameSheetTo,
    removeSheet,
    reorderSheets,
    sort,
    setColumnFilter,
    updateColumnFilter,
    clearFilter,
    toggleFilter,
    columnFilter,
    columnValues,
    rename,
    addFilledSheet,
    summary,
    revert,
    undo: () => step("undo"),
    redo: () => step("redo"),
    rangeName: (range: CellRange) => rangeName(range),
    /** Works out TODAY() and NOW() again. */
    tick: () => {
      engine.tick();
      version.value++;
    },
    dispose: () => stop(),
  };
}

export type Session = ReturnType<typeof createSession>;
