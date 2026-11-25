// A Button's `action`: the work behind it, and how the button says how it went. One value per press:
//
// - idle: the button as usual.
// - busy: the work runs. A press does nothing. Nothing shows for the first 300 ms, so a quick action (a copy) never
//   flashes a spinner; then a spinner; after 1 s the busy label ("Saving…"), told to a screen reader too. Once
//   something shows it stays at least 500 ms, so no name flickers past.
// - done: it worked and the button says so ("Copied" with a check) for 2 s, then it is idle again. Only with a done
//   label; without one it goes straight back. A press while done runs the action again.
//
// The action returns `false` (or a Promise of it) when nothing happened (a save dialog the user closed): back to idle,
// quietly. A throw or a rejection goes back to idle too, and the kit's error toast says why.
import { shallowRef } from "vue"
import { announce } from "../../../lib/announce"

export type ButtonActionState =
  | { status: "idle" }
  | { status: "busy"; shows: "nothing" | "spinner" | "label" }
  /** `round` counts the times it was done, so the check pops again on a second copy. */
  | { status: "done"; round: number }

/** What the button runs when pressed. A Promise keeps it busy until it settles; `false` means nothing happened. */
export type ButtonAction = () => unknown

/** The times, in ms. Fixed for the whole kit, so every button feels the same. */
export const ACTION_TIMING = { spinnerAfter: 300, labelAfter: 1000, shownAtLeast: 500, doneFor: 2000 } as const

export interface ButtonActionOptions {
  action: () => ButtonAction | undefined
  /** The done label, or empty when the button has none (then it goes straight back to idle). */
  doneText: () => string
  /** What a screen reader hears when the work runs long: the busy label, or the kit's "Working…". */
  busyText: () => string
  /** Says the work failed, with the error's own words (the kit's error toast). */
  failed: (message: string) => void
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as PromiseLike<unknown>).then === "function"

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message.trim() : "")

type Outcome = { kind: "worked" } | { kind: "nothing" } | { kind: "failed"; message: string }

export function useButtonAction(options: ButtonActionOptions) {
  const state = shallowRef<ButtonActionState>({ status: "idle" })
  let rounds = 0
  /** Raised by every press and by `dispose`: only the newest press may change the state. */
  let turn = 0
  let disposed = false
  /** When the spinner or the busy label last appeared, or null while nothing shows. */
  let shownAt: number | null = null
  const timers = new Set<ReturnType<typeof setTimeout>>()

  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, ms)
    timers.add(timer)
  }
  const clearTimers = () => {
    timers.forEach((timer) => clearTimeout(timer))
    timers.clear()
  }

  function finish(outcome: Outcome) {
    clearTimers()
    shownAt = null
    if (outcome.kind === "failed") options.failed(outcome.message)
    const done = options.doneText().trim()
    if (outcome.kind !== "worked" || done === "") {
      state.value = { status: "idle" }
      return
    }
    state.value = { status: "done", round: ++rounds }
    announce(done)
    later(() => (state.value = { status: "idle" }), ACTION_TIMING.doneFor)
  }

  function settle(mine: number, outcome: Outcome) {
    // Gone meanwhile: nothing to show it on, but a failure is still told.
    if (disposed) {
      if (outcome.kind === "failed") options.failed(outcome.message)
      return
    }
    if (mine !== turn) return
    clearTimers()
    const wait = shownAt === null ? 0 : Math.max(0, ACTION_TIMING.shownAtLeast - (Date.now() - shownAt))
    if (wait === 0) finish(outcome)
    else later(() => finish(outcome), wait)
  }

  /** Runs the action for a press. False when the press must be ignored (it is busy). */
  function press(): boolean {
    if (state.value.status === "busy") return false
    const action = options.action()
    if (!action) return true
    clearTimers()
    const mine = ++turn
    let result: unknown
    try {
      result = action()
    } catch (cause) {
      finish({ kind: "failed", message: messageOf(cause) })
      return true
    }
    if (!isThenable(result)) {
      finish(result === false ? { kind: "nothing" } : { kind: "worked" })
      return true
    }
    state.value = { status: "busy", shows: "nothing" }
    shownAt = null
    later(() => {
      state.value = { status: "busy", shows: "spinner" }
      shownAt = Date.now()
    }, ACTION_TIMING.spinnerAfter)
    later(() => {
      state.value = { status: "busy", shows: "label" }
      shownAt = Date.now()
      announce(options.busyText())
    }, ACTION_TIMING.labelAfter)
    result.then(
      (value) => settle(mine, value === false ? { kind: "nothing" } : { kind: "worked" }),
      (cause) => settle(mine, { kind: "failed", message: messageOf(cause) }),
    )
    return true
  }

  /** The button is gone: stop the timers. Work still running is not stopped; a failure is still told. */
  function dispose() {
    disposed = true
    turn++
    clearTimers()
  }

  return { state, press, dispose }
}
