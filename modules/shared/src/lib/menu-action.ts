// A menu row's `action`: what it runs when it is chosen. When that returns a Promise (a reload, a copy), the menu stays
// open while it runs and the row is busy (`aria-busy`, the kit's slow waiting pulse): a second click, Enter or Space on
// it does nothing. When it settles the menu closes; when it fails, a toast says so. An action that answers at once
// closes the menu as `@select` does.
//
// Only for work that runs by itself. An action that opens a dialog or a file picker closes the menu first, so it uses
// `@select` (or answers at once), never a Promise that waits for the user.
import { onBeforeUnmount } from "vue"
import { toast } from "../components/ui/toast/toast"
import { uiText } from "../components/ui/text"
import { useTask } from "../use-task"

/** What a menu row runs when it is chosen. A Promise keeps the menu open, with the row busy, until it settles. */
export type MenuAction = () => unknown

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as PromiseLike<unknown>).then === "function"

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message.trim() : "")

/** The toast for an action that failed, in the shape of the app's other "didn't work" toasts: the error's own words below. */
export function actionFailed(message: string): void {
  toast({ title: uiText.value.actionFailed, description: message || undefined, variant: "error", duration: 6000, testid: "toast-action-failed" })
}

/**
 * For a menu row that takes an `action`. `select` goes on the row's `select` event; `close` closes the whole menu.
 * `busy` is true while the action runs. Once the row is gone (the menu was closed meanwhile, with Escape or a click
 * outside) the work goes on, but nothing is closed any more: a menu opened since then stays open.
 */
export function useMenuAction(action: () => MenuAction | undefined, close: () => void) {
  const task = useTask({ describe: messageOf })
  let gone = false
  onBeforeUnmount(() => {
    gone = true
  })

  function select(event: Event) {
    // Busy: the menu stays as it is and nothing runs again.
    if (task.busy.value) {
      event.preventDefault()
      return
    }
    const run = action()
    if (!run) return
    let result: unknown
    try {
      result = run()
    } catch (cause) {
      actionFailed(messageOf(cause))
      return
    }
    if (!isThenable(result)) return
    event.preventDefault()
    void task.run(() => Promise.resolve(result)).then(() => {
      if (task.error.value !== null) actionFailed(task.error.value)
      if (!gone) close()
    })
  }

  return { busy: task.busy, select }
}
