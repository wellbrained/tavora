// A module page gets files only through Tavora's own dialogs (files.pickReadOnly, files.open, files.openJson,
// folders.choose), never through the
// system's file or folder picker: that one would hand over whatever the user picks, past the kinds, sizes, folder
// refusals and one-dialog-per-press rule of Tavora's own calls (security.md, "The system's file picker").
//
// Chromium opens a file input's picker in two ways: from the input's DOMActivate (the step a click, a label's click
// or Enter on the input goes through) and from showPicker(). Two halves close both.
// - `guardPickerEvents`, in the preload's isolated world, listens first at the window and cancels every click and
//   DOMActivate that would reach a file input in the document. It looks again at DOMActivate, so an input that turns
//   into a file input during its own click is caught too.
// - `lockPickersInMainWorld`, in the page's own world before any of its scripts, covers what never reaches the window:
//   showPicker(), and click() or a click dispatchEvent on an input or a label that is not in this document. It also
//   takes away the File System Access pickers.
// Dropped files stay allowed (the user picked exactly those); a drop that carries a folder is refused.

/** Runs in the page's world (contextBridge.executeInMainWorld serializes it): it may use nothing from outside itself. */
export function lockPickersInMainWorld(): void {
  const isFileInput = (node: unknown): boolean => node instanceof HTMLInputElement && node.type === "file";
  /** An input, a label, or anything inside a label: what a click can turn into a file input's activation. */
  const mayActivateInput = (node: unknown): node is Element =>
    node instanceof HTMLInputElement || (node instanceof Element && node.closest("label") !== null);
  /**
   * Whether a script's click on `node` is refused: one that would open a file input now, and any on an input or label
   * outside this document (not in it, or in another frame's), where the window's listeners can't see what it turns into.
   */
  const refusesClick = (node: unknown): boolean => {
    if (!mayActivateInput(node)) return false;
    if (!node.isConnected || node.ownerDocument !== document) return true;
    const label = node.closest("label");
    return isFileInput(node) || (label !== null && isFileInput(label.control));
  };
  // Kept as writable as before, so a library that wraps one still works: a page can only swap in its own code, which
  // has no way back to the original.
  const replace = (target: object, name: string, value: unknown) => {
    const before = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { ...before, value });
  };
  const refused = () => new DOMException("Files come only through Tavora's own dialogs.", "NotAllowedError");

  const showPicker = HTMLInputElement.prototype.showPicker as ((this: HTMLInputElement) => void) | undefined;
  if (showPicker) {
    replace(HTMLInputElement.prototype, "showPicker", function (this: HTMLInputElement) {
      if (isFileInput(this)) throw refused();
      return showPicker.call(this);
    });
  }
  const click = HTMLElement.prototype.click;
  replace(HTMLElement.prototype, "click", function (this: HTMLElement) {
    if (refusesClick(this)) return;
    return click.call(this);
  });
  const dispatchEvent = EventTarget.prototype.dispatchEvent;
  replace(EventTarget.prototype, "dispatchEvent", function (this: EventTarget, event: Event) {
    // A click a script makes still activates an input; a refused one is not sent at all.
    if (event instanceof Event && event.type === "click" && refusesClick(this)) return false;
    return dispatchEvent.call(this, event);
  });
  // Gone rather than refusing, so a library that checks for them falls back to a file input, which opens nothing.
  for (const name of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) {
    Reflect.deleteProperty(window, name);
    // Not deletable where it is (on a prototype): an own property that refuses hides it.
    if (name in window) replace(window, name, () => Promise.reject(refused()));
  }
}

/** Whether a drop carries a folder: its files could be read one by one, past every rule of Folders on this PC. */
export function dropsFolder(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry?.isDirectory) return true;
  }
  return false;
}

/** Whether an event is on its way to a file input in the document. */
export function reachesFileInput(event: Event): boolean {
  return event.composedPath().some((node) => node instanceof HTMLInputElement && node.type === "file");
}

/**
 * In the preload's isolated world, before the page's scripts: the window is the first stop of every event in the
 * document, and these listeners are the first there, so nothing of the page's runs before them.
 */
export function guardPickerEvents(target: Window): void {
  for (const type of ["click", "DOMActivate"]) {
    target.addEventListener(
      type,
      (event) => {
        if (reachesFileInput(event)) event.preventDefault();
      },
      true,
    );
  }
  target.addEventListener(
    "drop",
    (event) => {
      if (!dropsFolder(event.dataTransfer)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true,
  );
}
