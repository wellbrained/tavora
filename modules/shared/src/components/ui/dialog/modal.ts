// Whether a kit dialog is open. A dialog asks the user for something and the page behind it waits, so page-wide keys
// (Ctrl+Z taking back a delete, see toast/undoable.ts) stand down while one is showing. The kit's dialogs
// (DialogContent, DialogScrollContent; ConfirmDialog and NameDialog are built on them) count themselves in here the
// moment they open and out the moment they start to close. A counter, not a look at the page: it also holds when the
// focus has slipped to the body, and it needs no markup to be found.
//
// Menus, lists and popovers are not counted. They do not wait on the user and may stay open while the focus is back on
// the page; a key pressed inside one belongs to it, which `handleUndoKey` sees from where the key was pressed.
let count = 0;

/** A dialog opened: returns the call that tells it closed (safe to call twice). */
export function enterModal(): () => void {
  count++;
  let left = false;
  return () => {
    if (left) return;
    left = true;
    count--;
  };
}

/** Whether a kit dialog is open now. */
export function isModalOpen(): boolean {
  return count > 0;
}
