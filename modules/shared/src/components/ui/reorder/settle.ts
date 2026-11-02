/** Waiting for a list to show its new order after a drop, apart from the DOM so it can be tested. */

/** How long a list may take to show the new order before the drop counts as having changed nothing. */
export const ORDER_WAIT_MS = 500
const LOOK_EVERY_MS = 16

/**
 * Resolves true as soon as `check` is true, false once `timeoutMs` has gone by. It looks on a timer, not on animation
 * frames: a page that is not drawn (hidden, over a game) gets no frames, and the drop would never end.
 */
export function waitFor(check: () => boolean, timeoutMs = ORDER_WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const look = () => {
      if (check()) resolve(true)
      else if (Date.now() - started >= timeoutMs) resolve(false)
      else setTimeout(look, LOOK_EVERY_MS)
    }
    look()
  })
}

export type DropResult = "changed" | "unchanged" | "failed"

/**
 * Runs the change a drop makes and waits for the list to show it. A change that throws or rejects is "failed" (and
 * reported), never left hanging, so the caller always gets to put the list back in order.
 */
export async function commitAndWait(
  commit: () => void | Promise<void>,
  changed: () => boolean,
  timeoutMs = ORDER_WAIT_MS,
  report: (error: unknown) => void = (error) => console.error("[reorder] the drop failed", error),
): Promise<DropResult> {
  try {
    await commit()
  } catch (error) {
    report(error)
    return "failed"
  }
  return (await waitFor(changed, timeoutMs)) ? "changed" : "unchanged"
}
