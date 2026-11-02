// Dialogs a key starts appear at once. People open Search, Settings or a rename with the keyboard many times a day, and
// a rise that takes a quarter of a second is in the way then. The kit's dialogs read the input that started them
// (input-origin.ts) and set data-instant, which motion.css answers with no animation, overlay included. A dialog
// closed with Escape leaves at once too. Opened or closed with the pointer, they move as always.
import { inject, provide, ref, watch, type InjectionKey, type Ref } from "vue"
import { injectDialogRootContext } from "reka-ui"
import { keyPress, trackInputOrigin, type KeyPress } from "../sliding-indicator/input-origin"

/** How long after a key press a dialog opening still counts as the key's doing. */
export const DIALOG_KEY_WINDOW_MS = 500

/**
 * Whether a dialog skips its motion now. `forced` is a dialog that never animates (Search); otherwise the latest input
 * decides: a key press within the window makes opening instant, and Escape makes closing instant.
 */
export function dialogIsInstant(moment: "open" | "close", forced: boolean, press: KeyPress | undefined): boolean {
  if (forced) return true
  if (!press || press.ago > DIALOG_KEY_WINDOW_MS) return false
  return moment === "open" || press.key === "Escape"
}

// Listening has to start before the key is pressed, and a dialog that is only drawn while it is open is too late for
// that, so the kit listens from the moment it is loaded.
if (typeof document !== "undefined") trackInputOrigin()

const instantKey: InjectionKey<Ref<boolean>> = Symbol("dialogInstant")

/** For the content of a dialog: the flag to put on it as data-instant, and to hand to its overlay. */
export function provideDialogInstant(forced: () => boolean): Ref<boolean> {
  const root = injectDialogRootContext()
  const instant = ref(false)
  // Sync and immediate: the flag is set before the dialog is drawn open or closed, so the first frame already has it.
  watch(root.open, (open) => {
    instant.value = dialogIsInstant(open ? "open" : "close", forced(), keyPress())
  }, { flush: "sync", immediate: true })
  provide(instantKey, instant)
  return instant
}

/** For the overlay: the flag of the content it sits with, off when used on its own. */
export function injectDialogInstant(): Ref<boolean> {
  return inject(instantKey, ref(false))
}
