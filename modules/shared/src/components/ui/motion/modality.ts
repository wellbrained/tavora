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

/** The last thing the user did was a pointer press, no longer ago than `withinMs` (any time by default). */
export function pointerLed(withinMs = Number.POSITIVE_INFINITY): boolean {
  return pointerAt > keyAt && performance.now() - pointerAt <= withinMs
}

trackInput()
