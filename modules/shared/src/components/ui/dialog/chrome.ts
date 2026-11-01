// What DialogContent shares with the header inside it: whether the dialog has a close X at all, and whether the
// header draws it (centred against the title) or DialogContent has to place it at the corner.
import type { InjectionKey, Ref } from "vue"

export interface DialogChrome {
  showClose: Readonly<Ref<boolean>>
  headerClose: Ref<boolean>
}

export const dialogChromeKey: InjectionKey<DialogChrome> = Symbol("dialog-chrome")

/** The close X: a 30 px rounded square, outlined at rest, a soft fill on hover and focus. */
export const dialogCloseClass = "text-muted-foreground hover:text-foreground focus-visible:text-foreground border-border hover:bg-foreground/9 focus-visible:bg-foreground/9 focus-visible:ring-ring/50 inline-flex size-[30px] shrink-0 items-center justify-center rounded-lg border outline-none transition-colors focus-visible:ring-3 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
