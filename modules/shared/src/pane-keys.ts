// Keys for one pane, not the whole window: a board you type on (digits on a puzzle, letters on a word game), a key that
// leaves a mode (Escape), a panel-wide shortcut. A component may be shown twice on a page, so a listener on the window
// would act in both; this one acts where the key was pressed.
//
// The handler runs for a key pressed inside `root`, and for one pressed while nothing on the page has the focus (then
// the first pane that started listening and is shown takes it). It stands down when
// - something already handled the key, or an input method is still composing text,
// - a kit dialog or menu is open,
// - the key was pressed inside a list, menu, dialog or popover, or in a text field,
// - Ctrl, ⌘ or Alt is held (Ctrl+K and other shortcuts belong to Tavora); `modifiers: true` lets them through.
// Return true from the handler when it used the key: the kit then stops the browser's own action. Ctrl+Z stays with
// `handleUndoKey` in the page's entry script.
import { unrefElement, type MaybeElementRef } from "@vueuse/core"
import { getCurrentScope, onScopeDispose } from "vue"
import { isComposing } from "./lib/keys"
import { topLayer } from "./lib/layers"

export interface PaneKeysOptions {
  /** Let keys through while Ctrl, ⌘ or Alt is held (Shift always passes). */
  modifiers?: boolean
}

export type PaneKeyHandler = (event: KeyboardEvent) => boolean | void

/** A list, menu, dialog or popover: a key pressed inside belongs to it. */
const LAYER = "[role=listbox], [role=menu], [role=menubar], [role=dialog], [role=alertdialog], [data-reka-popper-content-wrapper]"
/** Fields that take typed text (a checkbox, radio or button input does not). */
const TEXT_INPUT = "input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=reset], [type=range], [type=color], [type=file], [type=image]), textarea, select, [contenteditable]:not([contenteditable=false]), [role=combobox], [role=textbox], [role=searchbox], [role=spinbutton]"

/** Whether the key was pressed where text is typed. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(TEXT_INPUT)
}

interface Entry {
  root: () => HTMLElement | null
  handler: PaneKeyHandler
  options: PaneKeysOptions
}

/** Every pane listening, in the order they started: the first one alive takes keys pressed with nothing focused. */
const entries: Entry[] = []

/** Nothing on the page has the focus: the key went to the page itself. */
const unfocused = (target: EventTarget | null) =>
  !(target instanceof Element) || target === document.body || target === document.documentElement

/** On the page and drawn: a copy that is hidden (`display: none`, a folded part) doesn't take keys pressed with nothing focused. */
const shown = (root: HTMLElement | null) => !!root?.isConnected && (typeof root.checkVisibility === "function" ? root.checkVisibility() : true)

/** Whether this pane takes the key (before its handler is asked). */
function paneTakes(entry: Entry, event: KeyboardEvent): boolean {
  if (event.defaultPrevented || isComposing(event)) return false
  if (!entry.options.modifiers && (event.ctrlKey || event.metaKey || event.altKey)) return false
  if (topLayer()) return false
  const target = event.target
  if (target instanceof Element && (target.closest(LAYER) || isTypingTarget(target))) return false
  const root = entry.root()
  if (!root?.isConnected) return false
  if (target instanceof Node && root.contains(target)) return true
  return unfocused(target) && entries.find((other) => shown(other.root())) === entry
}

/**
 * Runs `handler` for the keys pressed in this pane (see above). Call it in `setup`; it stops when the component goes,
 * or with the function it returns.
 */
export function usePaneKeys(root: MaybeElementRef, handler: PaneKeyHandler, options: PaneKeysOptions = {}): () => void {
  const entry: Entry = {
    root: () => {
      const el = unrefElement(root)
      return el instanceof HTMLElement ? el : null
    },
    handler,
    options,
  }
  // Bubbling, after the pane's own elements: a slot grid or a field that used the key has marked it handled.
  const listener = (event: KeyboardEvent) => {
    if (paneTakes(entry, event) && entry.handler(event) === true) event.preventDefault()
  }
  entries.push(entry)
  document.addEventListener("keydown", listener)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    document.removeEventListener("keydown", listener)
    entries.splice(entries.indexOf(entry), 1)
  }
  if (getCurrentScope()) onScopeDispose(stop)
  return stop
}
