import { injectDialogRootContext } from "reka-ui"
import { onScopeDispose, watch } from "vue"
import { enterModal } from "./modal"

/** For the content of a dialog: counts the dialog as open (modal.ts) for as long as it is open, and not a moment longer. */
export function trackModal(): void {
  const root = injectDialogRootContext()
  let leave: (() => void) | undefined
  const stop = () => {
    leave?.()
    leave = undefined
  }
  // Sync and immediate, as the instant flag: counted from the first moment the dialog is open.
  watch(root.open, (open) => {
    stop()
    if (open) leave = enterModal()
  }, { flush: "sync", immediate: true })
  onScopeDispose(stop)
}
