// Undo and redo on the Overlay page (main/overlay-layout.ts): one step for each thing the user did there (add, remove,
// hide, move or resize one frame or many, Move to…, a change in the Settings box), kept per setup while Tavora runs.
//
// A step is a set of snapshots, not a command to replay: for each item it touched, in the setup it touched it in, how the
// item was before and after (its whole saved state, or null where it wasn't in that setup). Undo writes every "before"
// back, redo every "after". So a removed item comes back exactly as it was, and Move to… is just two parts (gone from one
// setup, there in the other).
//
// A step only applies while each of its items is still exactly as the step left it. One that changed since (moved in the
// game, removed by its module, a panel that closed) is never written over: that step is dropped and the one before it is
// tried. A write that can't be done (the setup is full now) stops there: what was written is put back and the step goes.

export interface Part<S> {
  setupId: string;
  /** The item (its layout id). */
  id: string;
  /** null: not in this setup. */
  before: S | null;
  after: S | null;
}

export interface Step<S> {
  /** Unique among every history while Tavora runs, so a toast can name the step it offers to undo. */
  id: number;
  /** What kind of step it is, where someone needs to know ("remove": the toast with Undo after a remove). */
  tag?: string;
  parts: Part<S>[];
}

let nextStepId = 1;

/** How the history looks at and changes the items (the layout gives it the setups; a test, a plain map). */
export interface Stage<S> {
  /** The item as the setup has it now, or null when it isn't there. */
  read(setupId: string, id: string): S | null;
  /** Makes the item in the part's setup what `to` says (null: takes it out); false when that can't be done. */
  write(part: Part<S>, to: S | null): boolean;
  same(a: S, b: S): boolean;
}

export class LayoutHistory<S> {
  private done: Step<S>[] = [];
  private undone: Step<S>[] = [];

  constructor(
    private readonly stage: Stage<S>,
    private readonly limit = 200,
  ) {}

  private same(a: S | null, b: S | null): boolean {
    if (a === null || b === null) return a === b;
    return this.stage.same(a, b);
  }

  /**
   * Keeps what one user action changed, as one step; parts that end as they began are left out, and with nothing changed
   * there is no step. Redo is forgotten. Whether a step was made.
   */
  record(parts: readonly Part<S>[], tag?: string): boolean {
    const changed = parts.filter((part) => !this.same(part.before, part.after));
    if (changed.length === 0) return false;
    this.done.push({ id: nextStepId++, ...(tag ? { tag } : {}), parts: changed });
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    return true;
  }

  /** Takes the newest step back; the step that was, or null when there is none that still applies. */
  undo(): Step<S> | null {
    return this.apply(this.done, this.undone, "before");
  }

  /** Does the step taken back last again; the step, or null. */
  redo(): Step<S> | null {
    return this.apply(this.undone, this.done, "after");
  }

  private apply(from: Step<S>[], to: Step<S>[], side: "before" | "after"): Step<S> | null {
    for (;;) {
      const step = from.pop();
      if (!step) return null;
      // Changed since the step: it can't be taken back or done again without undoing that too.
      if (!this.applies(step, side)) continue;
      if (!this.write(step, side)) return null;
      to.push(step);
      return step;
    }
  }

  /** Whether every item of the step is still exactly as the step left it (for `side`, as the other side says). */
  private applies(step: Step<S>, side: "before" | "after"): boolean {
    const other = side === "before" ? "after" : "before";
    return step.parts.every((part) => this.same(this.stage.read(part.setupId, part.id), part[other]));
  }

  /** Writes one side of a step; when a write can't be done, what was written is put back and the answer is false. */
  private write(step: Step<S>, side: "before" | "after"): boolean {
    const other = side === "before" ? "after" : "before";
    // Items leave first, so one coming back into a full setup has the room another one leaves.
    const order = [...step.parts].sort((a, b) => Number(a[side] !== null) - Number(b[side] !== null));
    const written: Part<S>[] = [];
    for (const part of order) {
      if (this.stage.write(part, part[side])) {
        written.push(part);
        continue;
      }
      for (const back of written.reverse()) this.stage.write(back, back[other]);
      return false;
    }
    return true;
  }

  /**
   * Takes back one step by its id, wherever it is in the history (the Undo on a toast, which may be pressed after other
   * changes). Only that step: the ones after it stay done. The newest one goes onto redo as with Ctrl+Z; an older one
   * can't be done again (redo would have to jump over the newer ones). A step whose items changed since, or that can't
   * be written, is dropped, as Ctrl+Z drops it. The step that was taken back, or null (also when it isn't here any more:
   * Ctrl+Z took it back already, so the toast never undoes twice).
   */
  undoStep(id: number): Step<S> | null {
    const index = this.done.findIndex((step) => step.id === id);
    if (index < 0) return null;
    const [step] = this.done.splice(index, 1) as [Step<S>];
    if (!this.applies(step, "before") || !this.write(step, "before")) return null;
    if (index === this.done.length) this.undone.push(step);
    return step;
  }

  /** The steps that can still be undone, oldest first; with a tag, only those. */
  steps(tag?: string): readonly Step<S>[] {
    return tag === undefined ? this.done : this.done.filter((step) => step.tag === tag);
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
