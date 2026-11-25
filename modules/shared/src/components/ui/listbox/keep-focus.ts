// Keeps a search field ready to type into while it is shown, for a list that opens with its search (an "Add …" dialog).
// Tavora draws a dialog's frame first and puts the page into it once the frame has settled, so the page may not hold the
// keyboard focus yet when it mounts: the field is asked again on the next frame, on focus and visibility changes and every
// 100 ms for two seconds, until both the page and the field have it. A letter typed while the focus is somewhere that
// takes no text (the page itself, a button) goes into the field too; Space doesn't (it presses the focused button), nor
// does a key inside an open menu, dialog or another list. It never takes the focus from another field, and
// stops asking once the user has put the focus somewhere else.
import { onBeforeUnmount, onMounted } from "vue"

const RETRY_MS = 100
const RETRY_FOR_MS = 2000

/** Whether an element takes typed text itself (a field, a text area, editable content). */
export function takesText(element: Element | null): boolean {
  if (!element) return false
  if (element instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLInputElement) return !["button", "checkbox", "radio", "range", "color", "file", "submit", "reset", "image"].includes(element.type)
  return (element as HTMLElement).isContentEditable === true
}

/** Whether a key press types a visible character (a letter, a digit), not Space, a shortcut or a navigation key. */
export function typesCharacter(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey
}

/** While `on()` is true, keeps the focus on `field()` as described above. */
export function useKeepFocus(field: () => HTMLInputElement | null | undefined, on: () => boolean): void {
  let retry: ReturnType<typeof setInterval> | undefined
  let frame = 0

  // The user chose another place: the page's body has no say, the field itself is fine, anything else wins.
  const elsewhere = (): boolean => {
    const active = document.activeElement
    return !!active && active !== document.body && active !== field()
  }
  const settled = (): boolean => document.hasFocus() && document.activeElement === field()

  function stop(): void {
    clearInterval(retry)
    retry = undefined
    cancelAnimationFrame(frame)
  }

  function ask(): void {
    const input = field()
    if (!input || !on()) return stop()
    if (elsewhere() && retry === undefined) return
    if (!document.hasFocus()) window.focus()
    if (document.activeElement !== input) input.focus({ preventScroll: true })
    if (settled()) stop()
  }

  // A typed letter lands in the field, unless the focus is in something that takes text itself.
  function onKey(event: KeyboardEvent): void {
    const input = field()
    if (!input || !on() || event.defaultPrevented || !typesCharacter(event)) return
    const active = document.activeElement
    if (active === input || takesText(active) || active?.closest("[role=menu], [role=dialog], [role=listbox], [role=grid]")) return
    input.focus({ preventScroll: true })
  }

  // The user put the focus somewhere else on purpose: stop asking for it.
  function onFocusIn(event: FocusEvent): void {
    if (event.target !== field() && event.target !== document.body) stop()
  }

  onMounted(() => {
    if (!on()) return
    const until = Date.now() + RETRY_FOR_MS
    retry = setInterval(() => (Date.now() > until ? stop() : ask()), RETRY_MS)
    ask()
    frame = requestAnimationFrame(ask)
    addEventListener("focus", ask)
    document.addEventListener("visibilitychange", ask)
    document.addEventListener("focusin", onFocusIn)
    // rules-allow: window-keys (the kit's one place for "type anywhere to search"; only while this list is shown)
    document.addEventListener("keydown", onKey, true)
  })
  onBeforeUnmount(() => {
    stop()
    removeEventListener("focus", ask)
    document.removeEventListener("visibilitychange", ask)
    document.removeEventListener("focusin", onFocusIn)
    document.removeEventListener("keydown", onKey, true)
  })
}
