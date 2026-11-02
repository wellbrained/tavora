// What the user last used: the pointer or the keyboard. A highlight that follows a choice slides when the choice
// was a click and jumps when it came from the keys (arrows, Enter, hotkeys): nothing a key press starts is animated.
//
// One pair of listeners on the document serves every control; they are added with the first user and removed with
// the last. Without anything to go on, it is "pointer".

export type InputOrigin = "pointer" | "key";

/** The part of `document` this needs; a test passes its own. */
export interface OriginTarget {
  addEventListener(type: string, listener: () => void, options?: boolean | { capture?: boolean }): void;
  removeEventListener(type: string, listener: () => void, options?: boolean | { capture?: boolean }): void;
}

let origin: InputOrigin = "pointer";
let users = 0;
let attached: OriginTarget | null = null;

const onPointer = () => {
  origin = "pointer";
};
const onKey = () => {
  origin = "key";
};

/** What the user touched last. */
export function inputOrigin(): InputOrigin {
  return origin;
}

/** Starts following the input; call the returned function when done. Safe to call more than once. */
export function trackInputOrigin(target: OriginTarget | undefined = typeof document === "undefined" ? undefined : document): () => void {
  if (!target) return () => {};
  if (users === 0) {
    attached = target;
    // Capture, so a control that stops the event still counts.
    target.addEventListener("pointerdown", onPointer, true);
    target.addEventListener("keydown", onKey, true);
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
      attached = null;
    }
  };
}

/** For tests: forget everything. */
export function resetInputOrigin() {
  origin = "pointer";
}
