// What a delete in the host UI can still put back. Deleting a layout, a folder or a workspace happens at once and is
// saved at once; the delete leaves here how to undo it and answers with a token. The host UI shows "… deleted" with
// Undo (undoable in the kit) and sends the token back with `undo-delete`, or with `undo-forget` once the toast went.
//
// Kept in memory only: when Tavora closes (or the host UI reloads and loses its toast), the delete simply stays. A
// token works once. An entry the host UI never forgets is let go after a while, so nothing piles up.
import { randomUUID } from "node:crypto";
import { UserError } from "./messages";

/** Long enough for any toast (it waits while the pointer is on it), short enough not to keep old things around. */
export const UNDO_KEEP_MS = 10 * 60_000;

/** The thing can't come back: its place is gone, it came back already, or the offer ran out. */
export class UndoGoneError extends UserError {
  constructor() {
    super("error.undoGone");
  }
}

export class UndoShelf {
  private readonly entries = new Map<string, { restore: () => void | Promise<void>; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly keepMs = UNDO_KEEP_MS) {}

  /** Keeps how to put a delete back; answers with its token. */
  keep(restore: () => void | Promise<void>): string {
    const token = randomUUID();
    const timer = setTimeout(() => this.entries.delete(token), this.keepMs);
    timer.unref?.();
    this.entries.set(token, { restore, timer });
    return token;
  }

  /** Puts the delete back. Throws UndoGoneError when the token is unknown or the restore finds its place gone. */
  async undo(token: string): Promise<void> {
    const entry = this.entries.get(token);
    if (!entry) throw new UndoGoneError();
    this.forget(token);
    await entry.restore();
  }

  /** The offer ended: the delete is final. */
  forget(token: string): void {
    const entry = this.entries.get(token);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.entries.delete(token);
  }

  get size(): number {
    return this.entries.size;
  }
}
