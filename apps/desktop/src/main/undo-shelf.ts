// What a delete with Undo keeps, in the main process: the delete is done and saved at once, and the shelf holds what
// puts it back, under a token the host UI's Undo toast hands back ("undo-delete"). When the toast's time is up the
// host UI says so ("forget-undo"); a token nobody asked for again is dropped after a while anyway.
//
// Nothing here is saved: Tavora closing during the few seconds leaves the delete as it was saved, final and whole.
import { randomUUID } from "node:crypto";
import { UserError } from "./messages";

/** Long after any toast has gone, in case the host UI never said so (it reloaded). */
export const SHELF_LIFE_MS = 10 * 60_000;

export class UndoShelf {
  private readonly shelved = new Map<string, { restore: () => unknown; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    private readonly life = SHELF_LIFE_MS,
    private readonly newId: () => string = randomUUID,
  ) {}

  /** Keeps what puts a delete back; answers with its token. */
  put(restore: () => unknown): string {
    const token = this.newId();
    const timer = setTimeout(() => this.shelved.delete(token), this.life);
    timer.unref?.();
    this.shelved.set(token, { restore, timer });
    return token;
  }

  /** Puts the delete back, once. A token that is gone (time up, used, Tavora restarted) can't be undone any more. */
  async restore(token: string): Promise<void> {
    const entry = this.shelved.get(token);
    if (!entry) throw new UserError("error.undo.gone");
    this.forget(token);
    await entry.restore();
  }

  /** The delete is final: the toast's time is up. */
  forget(token: string): void {
    const entry = this.shelved.get(token);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.shelved.delete(token);
  }

  get size(): number {
    return this.shelved.size;
  }
}
