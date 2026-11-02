// Whether the user last used the pointer or the keyboard, so motion can stay instant for whatever a key press starts
// (the motion rules). Listening starts when this file loads and never stops: two passive listeners on the window.

let pointerAt = Number.NEGATIVE_INFINITY
let keyAt = Number.NEGATIVE_INFINITY
let tracking = false

export function trackInput(): void {
  if (tracking || typeof window === "undefined") return
  tracking = true
  addEventListener("pointerdown", () => (pointerAt = performance.now()), { capture: true, passive: true })
  addEventListener("keydown", () => (keyAt = performance.now()), { capture: true, passive: true })
}

/** How recent a pointer press must be for a page to count as picked with it. */
export const POINTER_WINDOW_MS = 1500

/** The last thing the user did was a pointer press, no longer ago than `withinMs` (POINTER_WINDOW_MS by default). */
export function pointerLed(withinMs = POINTER_WINDOW_MS): boolean {
  return pointerAt > keyAt && performance.now() - pointerAt <= withinMs
}

trackInput()
