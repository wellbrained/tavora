// Undo and redo for one spreadsheet while its panel is open (not saved). Each step keeps what changed, cell by cell
// and part by part, before and after. Taking a step back puts back only what still looks as this panel left it: a
// cell another panel changed since keeps the newer value, and the caller says so. Lives in the module until a
// second one wants it (then it moves to the kit).
import type { JsonValue } from "@tavora/sdk";
import type { Sheet, SpreadsheetData } from "./model";

type SheetField = Exclude<keyof Sheet, "id" | "cells">;

export type Part =
  | { kind: "doc"; field: string }
  | { kind: "order" }
  | { kind: "sheet"; id: string }
  | { kind: "field"; id: string; field: string }
  | { kind: "cell"; id: string; name: string };

export interface Change {
  part: Part;
  before: JsonValue | undefined;
  after: JsonValue | undefined;
}

export interface Step {
  label: string;
  changes: Change[];
}

const SKIP_DOC = new Set(["sheets", "version"]);

/** Whether two saved values are the same. */
export function same(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as JsonValue[];
    return a.length === other.length && a.every((item, index) => same(item, other[index]));
  }
  const left = a as { [key: string]: JsonValue };
  const right = b as { [key: string]: JsonValue };
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && same(left[key], right[key]));
}

/** What changed from one copy to the next. */
export function diff(before: SpreadsheetData, after: SpreadsheetData): Change[] {
  const changes: Change[] = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (SKIP_DOC.has(field)) continue;
    if (!same(before[field], after[field])) changes.push({ part: { kind: "doc", field }, before: before[field], after: after[field] });
  }
  const order = (doc: SpreadsheetData) => doc.sheets.map((sheet) => sheet.id);
  if (!same(order(before), order(after))) changes.push({ part: { kind: "order" }, before: order(before), after: order(after) });
  const old = new Map(before.sheets.map((sheet, index) => [sheet.id, { sheet, index }]));
  const now = new Map(after.sheets.map((sheet, index) => [sheet.id, { sheet, index }]));
  for (const id of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(id);
    const b = now.get(id);
    if (!a || !b) {
      changes.push({ part: { kind: "sheet", id }, before: a ? (a.sheet as JsonValue) : undefined, after: b ? (b.sheet as JsonValue) : undefined });
      continue;
    }
    if (a.sheet === b.sheet) continue;
    for (const field of new Set([...Object.keys(a.sheet), ...Object.keys(b.sheet)])) {
      if (field === "id" || field === "cells") continue;
      if (!same(a.sheet[field], b.sheet[field])) changes.push({ part: { kind: "field", id, field }, before: a.sheet[field], after: b.sheet[field] });
    }
    if (a.sheet.cells !== b.sheet.cells) {
      for (const name of new Set([...Object.keys(a.sheet.cells), ...Object.keys(b.sheet.cells)])) {
        if (a.sheet.cells[name] !== b.sheet.cells[name]) changes.push({ part: { kind: "cell", id, name }, before: a.sheet.cells[name], after: b.sheet.cells[name] });
      }
    }
  }
  return changes;
}

function read(doc: SpreadsheetData, part: Part): JsonValue | undefined {
  switch (part.kind) {
    case "doc":
      return doc[part.field];
    case "order":
      return doc.sheets.map((sheet) => sheet.id);
    case "sheet":
      return doc.sheets.find((sheet) => sheet.id === part.id) as JsonValue | undefined;
    case "field":
      return doc.sheets.find((sheet) => sheet.id === part.id)?.[part.field as SheetField];
    case "cell":
      return doc.sheets.find((sheet) => sheet.id === part.id)?.cells[part.name];
  }
}

function write(doc: SpreadsheetData, part: Part, value: JsonValue | undefined, at: number): void {
  switch (part.kind) {
    case "doc":
      if (value === undefined) delete doc[part.field];
      else doc[part.field] = value;
      return;
    case "order": {
      const ids = value as string[];
      const rank = new Map(ids.map((id, index) => [id, index]));
      doc.sheets = [...doc.sheets].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
      return;
    }
    case "sheet":
      doc.sheets = doc.sheets.filter((sheet) => sheet.id !== part.id);
      if (value !== undefined) doc.sheets.splice(Math.min(at, doc.sheets.length), 0, structuredClone(value) as Sheet);
      return;
    case "field": {
      const sheet = doc.sheets.find((item) => item.id === part.id);
      if (!sheet) return;
      if (value === undefined) delete sheet[part.field];
      else sheet[part.field] = structuredClone(value);
      return;
    }
    case "cell": {
      const sheet = doc.sheets.find((item) => item.id === part.id);
      if (!sheet) return;
      if (value === undefined) delete sheet.cells[part.name];
      else sheet.cells[part.name] = value as string;
    }
  }
}

/** The order of the sheets there are now matches, leaving out sheets that came or went. */
function sameOrder(doc: SpreadsheetData, expected: JsonValue | undefined): boolean {
  if (!Array.isArray(expected)) return false;
  const now = doc.sheets.map((sheet) => sheet.id);
  const shared = new Set(now.filter((id) => expected.includes(id)));
  return same(
    now.filter((id) => shared.has(id)),
    (expected as string[]).filter((id) => shared.has(id)),
  );
}

const ORDER: Record<Part["kind"], number> = { sheet: 0, order: 1, doc: 2, field: 3, cell: 4 };

/**
 * Puts a step's changes back (`undo`) or again (`redo`) on a copy, part by part, where the part still is what the
 * step left. Returns the changes that were made and how many were left because something newer was there.
 */
export function replay(doc: SpreadsheetData, changes: readonly Change[], direction: "undo" | "redo"): { done: Change[]; skipped: number } {
  const done: Change[] = [];
  let skipped = 0;
  // Sheets come back before their cells and their place in the order; sheets go after.
  const sorted = [...changes].sort((a, b) => ORDER[a.part.kind] - ORDER[b.part.kind]);
  for (const change of sorted) {
    const expected = direction === "undo" ? change.after : change.before;
    const target = direction === "undo" ? change.before : change.after;
    if (!same(read(doc, change.part), expected) && !(change.part.kind === "order" && sameOrder(doc, expected))) {
      skipped++;
      continue;
    }
    write(doc, change.part, target, doc.sheets.length);
    done.push(change);
  }
  return { done, skipped };
}

export const HISTORY_STEPS = 100;
/** Steps hold copies of what changed; a very big one (a whole sheet replaced) counts by its changes. */
const HISTORY_CHANGES = 400_000;

/** A panel's undo and redo stacks for one spreadsheet. */
export class History {
  private undoSteps: Step[] = [];
  private redoSteps: Step[] = [];

  get canUndo(): boolean {
    return this.undoSteps.length > 0;
  }
  get canRedo(): boolean {
    return this.redoSteps.length > 0;
  }

  /** Remembers a change (nothing when nothing changed); a new change ends what could be redone. Returns what changed. */
  record(label: string, before: SpreadsheetData, after: SpreadsheetData): Change[] {
    const changes = diff(before, after);
    if (!changes.length) return changes;
    this.undoSteps.push({ label, changes });
    this.redoSteps = [];
    while (this.undoSteps.length > HISTORY_STEPS || (this.undoSteps.length > 1 && this.size() > HISTORY_CHANGES)) this.undoSteps.shift();
    return changes;
  }

  private size(): number {
    return this.undoSteps.reduce((sum, step) => sum + step.changes.length, 0);
  }

  takeUndo(): Step | undefined {
    return this.undoSteps.pop();
  }
  takeRedo(): Step | undefined {
    return this.redoSteps.pop();
  }
  /** After an undo: what was put back can be redone. */
  pushRedo(step: Step): void {
    if (step.changes.length) this.redoSteps.push(step);
  }
  /** After a redo: it can be undone again, without ending the other redos. */
  pushUndo(step: Step): void {
    if (step.changes.length) this.undoSteps.push(step);
  }

  clear(): void {
    this.undoSteps = [];
    this.redoSteps = [];
  }
}
