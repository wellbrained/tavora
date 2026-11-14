import { getCurrentScope, onScopeDispose, readonly, ref, type Ref } from "vue"

/**
 * A drag with the pointer that you draw yourself (a splitter, a crop frame, a tab, a frame on a canvas): one per
 * component, made in `setup`, started from a `pointerdown`. It does the parts every drag needs the same way:
 *
 * - The drag begins once the pointer has moved `threshold` pixels from the press (along `axis` when set); a press
 *   that is let go before then is a click (`release`), not a drag.
 * - Letting go keeps what the drag did (`drop`). Escape, a pointer the system takes away (`pointercancel`), the
 *   element that holds the pointer going away, `cancel()` and the component unmounting put it back (`cancel`).
 * - Escape is taken while a drag runs, so it doesn't also close a dialog or let go of a selection.
 * - The click that follows a drop doesn't count as a click on what was dragged.
 * - Only the pointer that pressed counts. Starting a new drag cancels the one before.
 *
 * What a drag changes, and how it is put back, stays yours: keep the value from before in the closure that starts it.
 * For a list the user reorders, use `useReorderMotion` from `ui/reorder` with it (TabStrip does).
 */

/** `pressing`: the button is down but the pointer hasn't moved far enough yet. */
export type DragPhase = "idle" | "pressing" | "dragging"

/** How far the pointer is from where it pressed, in CSS pixels. */
export interface DragDelta {
  x: number
  y: number
}

export interface DragHandlers {
  /** The pointer moved past the threshold: the drag begins. `move` follows at once with the same event. */
  start?(event: PointerEvent): void
  /** Each move once the drag has begun. */
  move?(event: PointerEvent, delta: DragDelta): void
  /** Let go after the drag began: keep the result. */
  drop?(event: PointerEvent): void
  /** Let go before the drag began: it was a click. */
  release?(event: PointerEvent): void
  /** Put back what the drag changed. Runs whether or not the drag had begun. */
  cancel?(): void
}

export interface BindDragOptions {
  /** How far, in CSS pixels, the pointer moves before the drag begins. 0 (the default): the first move. */
  threshold?: number
  /** Measures the threshold along one axis only (a tab dragged along a row). */
  axis?: "x" | "y"
  /** Escape cancels the drag (the default). Off where Escape must keep its own meaning. */
  escape?: boolean
}

export interface StartOptions {
  /** Holds the pointer (`setPointerCapture`) while the drag runs, so moves and the release land here wherever the pointer goes. */
  capture?: Element | null
}

export interface DragBinding {
  /** Where the drag is now. */
  readonly phase: Readonly<Ref<DragPhase>>
  /**
   * Call from `pointerdown`. Check the button and anything else first: this starts it. A drag still going on is put
   * back first; give a function for `handlers` when they read state that putting it back changes (a width, a frame),
   * so they read it afterwards.
   */
  start(event: PointerEvent, handlers: DragHandlers | (() => DragHandlers), options?: StartOptions): void
  /** Ends the drag going on now and puts it back; nothing happens when there is none. */
  cancel(): void
}

export function bindDrag(options: BindDragOptions = {}): DragBinding {
  const threshold = options.threshold ?? 0
  const phase = ref<DragPhase>("idle")
  /** Ends the drag going on now and puts it back; set while one runs. */
  let putBack: (() => void) | null = null

  const cancel = () => putBack?.()

  function start(event: PointerEvent, setup: DragHandlers | (() => DragHandlers), { capture = null }: StartOptions = {}) {
    cancel()
    const pointerId = event.pointerId
    // Before anything is set up, so a pointer that can't be held leaves nothing half started.
    capture?.setPointerCapture(pointerId)
    const handlers = typeof setup === "function" ? setup() : setup
    const from = { x: event.clientX, y: event.clientY }
    phase.value = "pressing"

    const own = (e: PointerEvent) => e.pointerId === pointerId
    const distance = (x: number, y: number) => (options.axis === "x" ? Math.abs(x) : options.axis === "y" ? Math.abs(y) : Math.hypot(x, y))

    const onMove = (e: PointerEvent) => {
      if (!own(e)) return
      const delta = { x: e.clientX - from.x, y: e.clientY - from.y }
      if (phase.value === "pressing") {
        if (distance(delta.x, delta.y) < threshold) return
        phase.value = "dragging"
        handlers.start?.(e)
        // `start` may have cancelled.
        if (phase.value !== "dragging") return
      }
      handlers.move?.(e, delta)
    }
    const onUp = (e: PointerEvent) => {
      if (!own(e)) return
      const dragged = phase.value === "dragging"
      finish()
      if (!dragged) return handlers.release?.(e)
      swallowNextClick()
      handlers.drop?.(e)
    }
    const onCancel = (e: PointerEvent) => {
      if (own(e)) cancel()
    }
    // The holding element went away, or another one took the pointer: the drag can't go on.
    const onLost = (e: PointerEvent) => {
      if (own(e) && (e.target === capture || !capture?.isConnected)) cancel()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }

    window.addEventListener("pointermove", onMove, true)
    window.addEventListener("pointerup", onUp, true)
    window.addEventListener("pointercancel", onCancel, true)
    if (capture) window.addEventListener("lostpointercapture", onLost, true)
    if (options.escape !== false) window.addEventListener("keydown", onKey, true)

    function finish() {
      window.removeEventListener("pointermove", onMove, true)
      window.removeEventListener("pointerup", onUp, true)
      window.removeEventListener("pointercancel", onCancel, true)
      window.removeEventListener("lostpointercapture", onLost, true)
      window.removeEventListener("keydown", onKey, true)
      if (capture?.isConnected && capture.hasPointerCapture(pointerId)) capture.releasePointerCapture(pointerId)
      putBack = null
      phase.value = "idle"
    }
    putBack = () => {
      finish()
      handlers.cancel?.()
    }
  }

  if (getCurrentScope()) onScopeDispose(cancel)

  return { phase: readonly(phase), start, cancel }
}

/** The click the browser sends right after the button goes up, on whatever was under the press and the release. */
function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }
  window.addEventListener("click", swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener("click", swallow, true), 0)
}
