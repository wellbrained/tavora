// Undo and redo for the Overlay layout window (Ctrl+Z, Ctrl+Y) within one session of the window. Each step keeps what
// an item had before and after, so undoing or redoing sets one side back.

export interface Step<T> {
  /** What the change was made to. */
  target: string;
  before: T;
  after: T;
}

export class UndoStack<T> {
  private done: Step<T>[] = [];
  private undone: Step<T>[] = [];

  constructor(private readonly limit = 200) {}

  /** A change was made; redo is forgotten. */
  push(step: Step<T>): void {
    this.done.push(step);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
  }

  /** The step to take back, or undefined; the caller sets `before` on its target. */
  undo(): Step<T> | undefined {
    const step = this.done.pop();
    if (step) this.undone.push(step);
    return step;
  }

  /** The step to do again, or undefined; the caller sets `after` on its target. */
  redo(): Step<T> | undefined {
    const step = this.undone.pop();
    if (step) this.done.push(step);
    return step;
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** Drops one step (it can't be taken back or done again any more, because its item moved on). */
  discard(step: Step<T>): void {
    this.done = this.done.filter((other) => other !== step);
    this.undone = this.undone.filter((other) => other !== step);
  }

  /** Drops the steps of a target that is gone (a removed overlay can't be changed any more). */
  forget(target: string): void {
    this.done = this.done.filter((step) => step.target !== target);
    this.undone = this.undone.filter((step) => step.target !== target);
  }

  clear(): void {
    this.done = [];
    this.undone = [];
  }
}
