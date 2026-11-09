// While a modal dialog or menu is open, the page behind it can't be reached: not by Tab, not by a screen reader's
// cursor. Reka traps the focus and hides the rest from screen readers, but Tab can still slip out through the
// browser's own bar or when the focus has gone to the body; `inert` shuts the way for good.
//
// `inertBehind(content)` marks everything in the page that is not on the way from `content` up to the body as inert and
// returns the call that puts it back. Two dialogs on top of each other each hold what they made inert (a count), so
// closing the upper one lets the lower one's page stay shut, and what was inert before is left as it was.
import { defineComponent, getCurrentInstance, onBeforeUnmount, onMounted } from "vue"

/** Stays reachable: the hover hints, and the toasts (an Undo can be pressed while a dialog is open, as before). */
const KEEP = "[data-tooltip-layer], [data-slot=toaster-host], script, style, link"

const holds = new Map<Element, { count: number; wasInert: boolean }>()

function hold(element: Element) {
  const held = holds.get(element)
  if (held) {
    held.count++
    return
  }
  holds.set(element, { count: 1, wasInert: element.hasAttribute("inert") })
  element.setAttribute("inert", "")
}

function release(element: Element) {
  const held = holds.get(element)
  if (!held) return
  if (--held.count > 0) return
  holds.delete(element)
  if (!held.wasInert) element.removeAttribute("inert")
}

/** Makes the page outside `content` inert; returns the call that undoes exactly that (safe to call twice). */
export function inertBehind(content: Element): () => void {
  const body = content.ownerDocument.body
  const marked: Element[] = []
  for (let current: Element | null = content; current && current !== body; current = current.parentElement) {
    const parent: Element | null = current.parentElement
    if (!parent) break
    for (const sibling of Array.from(parent.children)) {
      if (sibling === current || sibling.matches(KEEP)) continue
      hold(sibling)
      marked.push(sibling)
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    for (const element of marked) release(element)
  }
}

/** Whether anything is held inert right now (for tests). */
export function inertCount(): number {
  return holds.size
}

/**
 * Put it inside the content of a modal dialog or menu (it draws nothing): while that content is on the page, the page
 * around it is inert. `active` false (a menu that is not modal) leaves the page alone.
 */
export const InertBehind = defineComponent({
  name: "InertBehind",
  props: { active: { type: Boolean, default: true } },
  setup(props) {
    const instance = getCurrentInstance()
    let undo: (() => void) | undefined
    onMounted(() => {
      const holder = (instance?.vnode.el as Node | null)?.parentElement
      if (props.active && holder) undo = inertBehind(holder)
    })
    onBeforeUnmount(() => undo?.())
    return () => null
  },
})
