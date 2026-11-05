// Undo instead of "Are you sure?": the thing is deleted at once and a toast says so, with an Undo button, for as long as
// the toast stays (five seconds, and longer while the pointer or the focus is on it, as for every toast). When it goes
// without Undo, the delete is final. The app and every module use this one helper, so it behaves the same everywhere.
//
// - Each delete gets its own toast and its own undo. Undoing one never touches another.
// - Undo runs once at most: the button, Ctrl+Z (`handleUndoKey`) and `undo()` all go through the same entry.
// - The caller's `undo` says whether the thing came back; when it can't any more (its place is gone, something took its
//   name), it returns false and the user is told in a short toast.
// - The delete itself is already saved when the toast shows. A reload or a closed app in the meantime keeps it deleted;
//   nothing is left half-done.
import { isModalOpen } from "../dialog/modal";
import { uiText } from "../text";
import { toast, type ToastHandle } from "./toast";

/** What a caller's undo answers: false when the thing could not come back. Anything else (nothing, true) means it did. */
export type UndoAnswer = boolean | void;

export interface UndoableOptions {
  /** What happened, a few words: "Layout deleted". */
  title: string;
  /** Puts the thing back exactly as it was. False (or an error) when it can't come back any more. */
  undo: () => UndoAnswer | Promise<UndoAnswer>;
  /** The offer ended without Undo: the delete is final now (time ran out, the toast was closed or pushed out). */
  onFinal?: () => void;
  /** Ctrl+Z takes this one back too (the default). Off where the page already has an undo stack that holds the delete. */
  key?: boolean;
  /** Test ids of the toast and its button; "undo-toast" and "undo" by default. */
  testid?: string;
  actionTestid?: string;
}

/** open: the toast shows; undoing: Undo was pressed and runs; undone: it came back; final: the delete stays. */
export type UndoState = "open" | "undoing" | "undone" | "final";

export interface Undoable {
  readonly state: UndoState;
  /** Takes the delete back, if it is still open. Whether the thing came back. */
  undo(): Promise<boolean>;
  /** Ends the offer now; the delete stays (onFinal runs). */
  close(): void;
  /** Ends the offer quietly, because the thing came back another way (the page's own undo); onFinal does not run. */
  drop(): void;
}

interface Entry {
  handle: Undoable;
  key: boolean;
}

/** The offers that are open, oldest first. */
const open: Entry[] = [];

/** The offers still open, oldest first (for tests and for Ctrl+Z). */
export function openUndos(): readonly Undoable[] {
  return open.map((entry) => entry.handle);
}

/** Deletes are shown with Undo: call after the delete is done and saved. */
export function undoable(options: UndoableOptions): Undoable {
  let state: UndoState = "open";
  let shown: ToastHandle | null = null;
  const leave = () => {
    const index = open.indexOf(entry);
    if (index >= 0) open.splice(index, 1);
  };
  const end = (next: "final" | "dropped") => {
    if (state !== "open") return;
    state = "final";
    leave();
    shown?.dismiss();
    if (next === "final") options.onFinal?.();
  };
  const handle: Undoable = {
    get state() {
      return state;
    },
    async undo() {
      if (state !== "open") return false;
      state = "undoing";
      leave();
      shown?.dismiss();
      let back: UndoAnswer;
      try {
        back = await options.undo();
      } catch {
        back = false;
      }
      if (back === false) {
        state = "final";
        options.onFinal?.();
        toast({ title: uiText.value.undoGone, testid: "undo-gone" });
        return false;
      }
      state = "undone";
      return true;
    },
    close: () => end("final"),
    drop: () => end("dropped"),
  };
  const entry: Entry = { handle, key: options.key !== false };
  open.push(entry);
  shown = toast({
    title: options.title,
    testid: options.testid ?? "undo-toast",
    actionTestid: options.actionTestid ?? "undo",
    action: { label: uiText.value.undo, onClick: () => void handle.undo() },
    // However the toast goes without Undo, the delete is final from then on.
    onDismiss: () => end("final"),
  });
  return handle;
}

/** Where a key belongs to what is typed: a text field keeps its own Ctrl+Z. */
function typing(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;
}

/** A key pressed inside an open menu, list or popover belongs to it, as one pressed in a text field. */
const POPUP = "[role='menu'], [role='listbox'], [role='dialog'], [role='alertdialog']";
function inPopup(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest(POPUP) !== null;
}

/**
 * Ctrl+Z (Cmd+Z) takes back the newest delete that is still open, outside text fields. Call it from the page's
 * keydown; it answers whether it used the key (it then stops the browser's own handling). It stands down while a kit
 * dialog is open (the page behind it is waiting, not the user's focus) and for keys pressed inside a menu, list or
 * popover.
 */
export function handleUndoKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "z") return false;
  if (typing(event.target) || inPopup(event.target) || isModalOpen()) return false;
  const latest = open.findLast((entry) => entry.key);
  if (!latest) return false;
  event.preventDefault();
  void latest.handle.undo();
  return true;
}
