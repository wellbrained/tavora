// Undo instead of "Are you sure?": something easy to put back is deleted at once, and a toast says so with an Undo
// button for a few seconds. For the app and every module; a module's undo stays inside its own data, so it needs no
// new access.
//
// Each delete is its own offer with its own toast: undoing one never touches another. An offer ends once, either way:
// - undone: the button, Ctrl+Z (undoLatest) or offer.undo(); `undo` puts the thing back;
// - final: the time ran out, the toast was closed or pushed out by newer ones, or the page is going away; `commit` runs.
// The toast's time stops while the pointer or focus is on the stack, so Undo never disappears under the cursor.
//
// The delete itself should already be done and saved as one step when the offer starts. Then a page that closes during
// the few seconds leaves it deleted, never half-deleted.
import { dismissToast, toast, TOAST_DURATION } from "./components/ui/toast/toast";
import { uiText } from "./components/ui/text";

export interface UndoableOptions {
  /** What just happened, in a few words: "Layout deleted". */
  title: string;
  /**
   * Puts it back exactly as it was. Answer false, or throw, when it can't any more (it changed or came back meanwhile);
   * the user then sees `failed`.
   */
  undo: () => unknown;
  /** The delete is final now (time up, toast closed or pushed out, page closing). Runs once at most. */
  commit?: () => void;
  /** What to say when Undo couldn't put it back; by default "Can't undo that anymore". */
  failed?: (reason: unknown) => string | undefined;
  /** How long Undo is offered, in milliseconds; five seconds by default. */
  duration?: number;
  testid?: string;
  actionTestid?: string;
}

export type UndoState = "open" | "undone" | "final";

export interface UndoOffer {
  readonly state: UndoState;
  /** Takes the delete back, if the offer is still open. Whether it was put back. */
  undo(): Promise<boolean>;
  /** Makes the delete final now and takes the toast away. */
  commit(): void;
}

/** Offers that are still open, oldest first. Ctrl+Z takes the newest. */
const open: Offer[] = [];
let listening = false;

class Offer implements UndoOffer {
  state: UndoState = "open";
  private readonly toastId: number;

  constructor(private readonly options: UndoableOptions) {
    const handle = toast({
      title: options.title,
      duration: options.duration ?? TOAST_DURATION,
      testid: options.testid ?? "undo-toast",
      actionTestid: options.actionTestid ?? "undo",
      actionKeys: "Control+Z",
      action: { label: uiText.value.undo, onClick: () => void this.undo() },
      onDismiss: (reason) => {
        if (reason !== "action") this.commit();
      },
    });
    this.toastId = handle.id;
  }

  async undo(): Promise<boolean> {
    if (!this.settle("undone")) return false;
    let back: boolean;
    let reason: unknown;
    try {
      back = (await this.options.undo()) !== false;
    } catch (error) {
      back = false;
      reason = error;
    }
    if (!back) toast.error(this.options.failed?.(reason) ?? uiText.value.undoFailed, { testid: "undo-failed" });
    return back;
  }

  commit(): void {
    if (!this.settle("final")) return;
    try {
      this.options.commit?.();
    } catch (error) {
      console.error("[tavora] undo commit", error);
    }
  }

  /** Ends the offer once; false when it had ended already. */
  private settle(state: UndoState): boolean {
    if (this.state !== "open") return false;
    this.state = state;
    const index = open.indexOf(this);
    if (index >= 0) open.splice(index, 1);
    // Its toast goes too (the "action" reason, so that leaving doesn't settle it again).
    dismissToast(this.toastId, "action");
    return true;
  }
}

/** Deletes are done; this offers Undo for them. See the top of this file. */
export function undoable(options: UndoableOptions): UndoOffer {
  if (!listening && typeof addEventListener === "function") {
    listening = true;
    // Closing or reloading the page: the deletes stay as they are, and their commits run.
    addEventListener("pagehide", settleUndos);
  }
  const offer = new Offer(options);
  open.push(offer);
  return offer;
}

/** Ctrl+Z (Cmd+Z on a Mac) where the page has no undo of its own: takes back the newest delete still offered. */
export function undoLatest(): Promise<boolean> {
  const newest = open.at(-1);
  return newest ? newest.undo() : Promise.resolve(false);
}

/** How many deletes can still be undone. */
export function openUndos(): number {
  return open.length;
}

/** Makes every open delete final, as when the page goes away. */
export function settleUndos(): void {
  for (const offer of [...open]) offer.commit();
}

/**
 * Whether a key press is Ctrl+Z (Cmd+Z) for undoing a delete: no Shift or Alt, and not typed into a text field, which
 * has its own undo.
 */
export function isUndoKey(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== "z" || event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey)) return false;
  const target = event.target as Element | null;
  return !target?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable='false'])");
}
