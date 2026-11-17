// A menu row's `action`: what it runs when it is chosen. When that returns a Promise (a reload, a copy), the menu stays
// open while it runs and the row is busy (`aria-busy`, the kit's slow waiting pulse): a second click, Enter or Space on
// it does nothing. When it settles the menu closes; when it fails, a toast says so. An action that answers at once
// closes the menu as `@select` does.
//
// Only for work that runs by itself. An action that opens a dialog or a file picker closes the menu first, so it uses
// `@select` (or answers at once), never a Promise that waits for the user.
//
// Closing the menu (Escape, a click outside) doesn't stop the work, and a row shown again is a new row: guard the work
// itself when a second run would hurt (like `useTask`).
import { watch, type Ref } from "vue"
import { toast } from "../components/ui/toast/toast"
import { uiText } from "../components/ui/text"
import { useTask } from "../use-task"

/** What a menu row runs when it is chosen. A Promise keeps the menu open, with the row busy, until it settles. */
export type MenuAction = () => unknown

/** The part of a Reka menu root (dropdown or context menu) a row needs: whether it is open, and a way to close it. */
export interface MenuRoot {
  open: Ref<boolean>
  onOpenChange(open: boolean): void
}

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as PromiseLike<unknown>).then === "function"

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message.trim() : "")

/** The toast for an action that failed, in the shape of the app's other "didn't work" toasts: the error's own words below. */
function actionFailed(message: string): void {
  toast({ title: uiText.value.actionFailed, description: message || undefined, variant: "error", duration: 6000, testid: "toast-action-failed" })
}

/**
 * For a menu row that takes an `action`. `select` goes on the row's `select` event; `busy` is true while the action
 * runs. When it settles the whole menu closes, unless it was closed meanwhile: a menu opened since then stays open. A
 * row in a submenu that closed meanwhile still closes the menu around it.
 */
export function useMenuAction(action: () => MenuAction | undefined, root: MenuRoot | null) {
  const task = useTask({ describe: messageOf })

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
    // Watched outside the row, so it holds after the row is gone (a submenu that closed).
    let closed = false
    // It ends when the menu closes (that is all it waits for) or the action settles, so an action that never settles
    // leaves nothing behind.
    const stop: () => void = root
      ? watch(
          root.open,
          (open) => {
            if (open) return
            closed = true
            stop()
          },
          { flush: "sync" },
        )
      : () => {}
    void task.run(() => Promise.resolve(result)).then(() => {
      stop()
      if (task.error.value !== null) actionFailed(task.error.value)
      if (!closed) root?.onOpenChange(false)
    })
  }

  return { busy: task.busy, select }
}
