// Undo and redo for the Overlay page (Ctrl+Z, Ctrl+Y), kept in memory while the page is open, one history per setup.
//
// A step is one thing the user did (add a frame, remove three, move two, change an opacity, Move to…) and holds, for
// every item it touched, the item's whole state before and after: null where the item was not in that setup. Undoing
// sets each item back to its `before`, redoing to its `after`, so a removed frame comes back exactly as it was and an
// added one goes again. The history knows nothing of what a state holds: a `HistoryTarget` reads, compares and writes it.
//
// A step is only taken back while every item it touched is still as the step left it. One that changed since (moved in
// the game, removed by its module) is not put back over that change: the step is dropped and the one before it is tried.

/** One item a step changed: in which setup, which item, and its state before and after (null: not in the setup). */
export interface Change<S> {
  setup: string;
  id: string;
  before: S | null;
  after: S | null;
}

/** One user action. */
export interface Step<S> {
  changes: readonly Change<S>[];
}

/** What the history works on: reads an item's state now, tells two states apart and writes one. */
export interface HistoryTarget<S> {
  read(setup: string, id: string): S | null;
  same(a: S | null, b: S | null): boolean;
  /** Sets the item from `from` (as it is now) to `to`; false when that could not be done. */
  write(setup: string, id: string, from: S | null, to: S | null): boolean;
}

export class UndoHistory<S> {
  private done: Step<S>[] = [];
  private undone: Step<S>[] = [];

  constructor(private readonly limit = 200) {}

  /**
   * Keeps one user action, without the items it left as they were; nothing is kept when it changed nothing. Redo is
   * forgotten. Whether a step was kept.
   */
  push(changes: readonly Change<S>[], same: (a: S | null, b: S | null) => boolean): boolean {
    const real = changes.filter((change) => !same(change.before, change.after));
    if (real.length === 0) return false;
    this.done.push({ changes: real });
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    return true;
  }

  /** Takes the newest step that still fits back; the items it changed, or null when there was none. */
  undo(target: HistoryTarget<S>): Change<S>[] | null {
    return this.apply(this.done, this.undone, "before", target);
  }

  /** Does the newest undone step that still fits again; the items it changed, or null when there was none. */
  redo(target: HistoryTarget<S>): Change<S>[] | null {
    return this.apply(this.undone, this.done, "after", target);
  }

  private apply(from: Step<S>[], to: Step<S>[], side: "before" | "after", target: HistoryTarget<S>): Change<S>[] | null {
    const other = side === "before" ? "after" : "before";
    for (;;) {
      const step = from.pop();
      if (!step) return null;
      const now = step.changes.map((change) => target.read(change.setup, change.id));
      if (!step.changes.every((change, index) => target.same(now[index] ?? null, change[other]))) continue;
      // In the order the step keeps them (the setup's list order), so items brought back land in their old places.
      step.changes.forEach((change, index) => target.write(change.setup, change.id, now[index] ?? null, change[side]));
      to.push(step);
      return [...step.changes];
    }
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Drops every step that touched this item in this setup: it went without the page doing it, so they can't be taken back. */
  forget(setup: string, id: string): void {
    const keep = (step: Step<S>) => !step.changes.some((change) => change.setup === setup && change.id === id);
    this.done = this.done.filter(keep);
    this.undone = this.undone.filter(keep);
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
