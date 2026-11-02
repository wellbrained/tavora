// Where a change came from. A highlight that follows a choice slides only when the user just pointed at something
// (a pointerdown, or a mouse click, within the last half second). A key press, a setting that arrives later from
// disk or another window, or anything else with no pointer in front of it makes the highlight jump: nothing a key
// press starts is animated, and a change the user didn't just make has nothing to follow.
//
// One set of listeners on the document serves every control; they are added with the first user and removed with the
// last, which also forgets what was seen.

export type InputOrigin = "pointer" | "key" | "other";

/** How long after a pointer press a change still counts as the press's doing. */
export const POINTER_WINDOW_MS = 500;

/** The part of `document` this needs; a test passes its own. */
export interface OriginTarget {
  addEventListener(type: string, listener: (event: never) => void, options?: boolean | { capture?: boolean }): void;
  removeEventListener(type: string, listener: (event: never) => void, options?: boolean | { capture?: boolean }): void;
}

let clock: () => number = () => (typeof performance === "undefined" ? Date.now() : performance.now());
let lastPointer = Number.NEGATIVE_INFINITY;
let lastKey = Number.NEGATIVE_INFINITY;
let lastKeyName: string | undefined;
let users = 0;
let attached: OriginTarget | null = null;

const onPointer = () => {
  lastPointer = clock();
};
const onKey = (event: { key?: string }) => {
  lastKey = clock();
  lastKeyName = event.key;
};

/** The key press that is the latest input (no pointer came after it), and how long ago it was. */
export interface KeyPress {
  key: string | undefined;
  ago: number;
}

/** The latest input if it was a key press, else nothing. The caller decides how recent is recent enough. */
export function keyPress(): KeyPress | undefined {
  if (lastKey === Number.NEGATIVE_INFINITY || lastKey < lastPointer) return undefined;
  return { key: lastKeyName, ago: clock() - lastKey };
}

/** A key press the page never sees as a key event (the host catches its shortcuts before the page does). */
export function noteKeyPress(key?: string) {
  lastKey = clock();
  lastKeyName = key;
}
// The click that follows a press marks it again, so a long press still counts. A click made with the keyboard
// (Enter or Space on a button) has detail 0 and doesn't.
const onClick = (event: { detail?: number }) => {
  if ((event.detail ?? 0) > 0) lastPointer = clock();
};

/** What the change happening now comes from. */
export function inputOrigin(): InputOrigin {
  if (lastKey >= lastPointer && lastKey > Number.NEGATIVE_INFINITY) return "key";
  return clock() - lastPointer <= POINTER_WINDOW_MS ? "pointer" : "other";
}

/** Starts following the input; call the returned function when done. Safe to call more than once. */
export function trackInputOrigin(target: OriginTarget | undefined = typeof document === "undefined" ? undefined : (document as unknown as OriginTarget), now?: () => number): () => void {
  if (!target) return () => {};
  if (users === 0) {
    attached = target;
    if (now) clock = now;
    // Capture, so a control that stops the event still counts.
    target.addEventListener("pointerdown", onPointer, true);
    target.addEventListener("keydown", onKey, true);
    target.addEventListener("click", onClick, true);
  }
  users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users--;
    if (users === 0 && attached) {
      attached.removeEventListener("pointerdown", onPointer, true);
      attached.removeEventListener("keydown", onKey, true);
      attached.removeEventListener("click", onClick, true);
      attached = null;
      resetInputOrigin();
    }
  };
}

/** Forgets everything seen so far (the last control going away does this too). */
export function resetInputOrigin() {
  lastPointer = Number.NEGATIVE_INFINITY;
  lastKey = Number.NEGATIVE_INFINITY;
  lastKeyName = undefined;
}
