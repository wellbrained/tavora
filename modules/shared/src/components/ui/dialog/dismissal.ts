// When the user may close a kit dialog, and what the page hears when they may not. DialogContent and
// DialogScrollContent take the props; the close X (corner or header) and the footer's Close go through `close`.
//
// - `dismissible` (default true): `false` refuses Escape, a press outside and the dialog's own close X and Close. Each
//   refused try emits `dismiss-attempt` with its `reason` (`escape`, `outside`, `close-button`), so the page decides:
//   ask "Discard changes?", or close for some reasons and not others.
// - `busy`: refuses all of them while work the dialog waits for runs (pass `useTask`'s `busy`), without a word, and
//   the X is off meanwhile. It wins over `dismissible`, so a page closing on `dismiss-attempt` never closes mid-task.
//
// The page still closes the dialog itself through `open` (with `closeDialog` in the app). Buttons of its own (Cancel,
// Done, a `DialogClose` it placed) are its own to guard. A right-click outside is never a try.
import { injectDialogRootContext } from "reka-ui"
import { computed, inject, provide, type ComputedRef, type InjectionKey } from "vue"

export type DismissReason = "escape" | "outside" | "close-button"

export interface DismissAttempt {
  reason: DismissReason
}

export interface DismissOptions {
  /** `false`: Escape, a press outside and the close X don't close it; each try emits `dismiss-attempt`. */
  dismissible?: boolean
  /** Work the dialog waits for runs: nothing the user does closes it, and the X is off. */
  busy?: boolean
}

/** What a refused or allowed try comes to: close, refuse and tell the page, or refuse without a word. */
export type DismissVerdict = "close" | "ask" | "refuse"

/** Whether a try to close goes ahead (see the top of this file). */
export function dismissVerdict(options: DismissOptions): DismissVerdict {
  if (options.busy) return "refuse"
  return options.dismissible === false ? "ask" : "close"
}

/** A right-click, or Ctrl with the left button (the Mac's right-click): Reka doesn't count it as a press outside. */
export function isSecondaryPress(event: PointerEvent): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey)
}

/** The close X and the footer's Close, inside a kit dialog. */
export interface DialogDismissal {
  busy: ComputedRef<boolean>
  close(): void
}

const dismissalKey: InjectionKey<DialogDismissal> = Symbol("dialog-dismissal")

type PointerOutside = CustomEvent<{ originalEvent: PointerEvent }>

/**
 * For the content of a dialog: the handlers that put Escape and a press outside through the rules, and the close the
 * X uses (shared with the header and footer inside it). A caller's own handler on the same event runs first; when it
 * prevents the default (Escape taken by something inside), that is not a try to close the dialog.
 */
export function useDialogDismissal(options: () => DismissOptions, attempted: (attempt: DismissAttempt) => void) {
  const root = injectDialogRootContext()
  /** Whether the dialog may close for `reason`; tells the page when it was a refused try. */
  function allows(reason: DismissReason): boolean {
    const verdict = dismissVerdict(options())
    if (verdict === "ask") attempted({ reason })
    return verdict === "close"
  }
  const dismissal: DialogDismissal = {
    busy: computed(() => Boolean(options().busy)),
    close() {
      if (allows("close-button")) root.onOpenChange(false)
    },
  }
  provide(dismissalKey, dismissal)
  return {
    ...dismissal,
    onEscapeKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (!allows("escape")) event.preventDefault()
    },
    onPointerDownOutside(event: PointerOutside) {
      if (event.defaultPrevented || isSecondaryPress(event.detail.originalEvent)) return
      if (!allows("outside")) event.preventDefault()
    },
  }
}

/** The kit's own `dismiss-attempt` listener, taken out of what a content forwards to Reka's DialogContent. */
export function withoutDismissListener<T extends object>(forwarded: T): Omit<T, "onDismissAttempt"> {
  const { onDismissAttempt: _, ...rest } = forwarded as T & { onDismissAttempt?: unknown }
  return rest
}

/** For a close button inside a dialog: the kit content's rules, or a plain close outside one. */
export function injectDialogDismissal(): DialogDismissal {
  const own = inject(dismissalKey, null)
  if (own) return own
  const root = injectDialogRootContext(null)
  return { busy: computed(() => false), close: () => root?.onOpenChange(false) }
}
