import { Fragment, TransitionGroup, defineComponent, h, type PropType, type VNode, type VNodeArrayChildren } from "vue"
import { enterRow, leaveRow } from "./row-motion"

/** The most rows that arrive or leave at once and still move; more than that is a list being replaced. */
export const MAX_MOVING_ROWS = 2

/** The keys of the rows in a slot, through the fragments a `v-for` makes (a keyed `<template>` lends its key to its row, as Vue's own TransitionGroup does). */
function rowKeys(nodes: VNodeArrayChildren, parentKey?: string): string[] {
  const keys: string[] = []
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue
    const vnode = node as VNode
    const key = parentKey === undefined ? vnode.key : String(parentKey) + String(vnode.key)
    if (vnode.type === Fragment) {
      if (Array.isArray(vnode.children)) keys.push(...rowKeys(vnode.children, key === null || key === undefined ? undefined : String(key)))
    } else if (key !== null && key !== undefined) keys.push(String(key))
  }
  return keys
}

/**
 * Whether a change of rows is one the user made (a row added or removed) and so moves. A list that is replaced as a
 * whole stays still, so there is no wall of moving rows: the first fill, a switch to another game, a search that shows
 * other results, anything that brings or takes more than MAX_MOVING_ROWS rows, or leaves none of the old rows.
 */
export function movesRows(before: readonly string[] | null, after: readonly string[]): boolean {
  if (!before) return false
  const was = new Set(before)
  const now = new Set(after)
  const added = after.filter((key) => !was.has(key)).length
  const removed = before.filter((key) => !now.has(key)).length
  if (!added && !removed) return false
  if (added > MAX_MOVING_ROWS || removed > MAX_MOVING_ROWS) return false
  // A list that fills up from nothing is a first load, a single new row in an empty list is not.
  if (!before.length && after.length > 1) return false
  if (before.length && after.length && !before.some((key) => now.has(key))) return false
  return true
}

/**
 * Whether this render's change moves its rows. `animate` is the caller's switch (off while a filter is typed). When it
 * has just flipped, the change belongs to the switch, not to the user adding or removing a row: clearing a filter
 * brings its rows back at once, so the switch lags one render behind.
 */
export function movesNow(animate: boolean, wasAnimate: boolean, before: readonly string[] | null, after: readonly string[]): boolean {
  return animate && wasAnimate && movesRows(before, after)
}

/**
 * A vertical list whose rows arrive and leave smoothly: a removed row fades, shrinks a little and folds to nothing while
 * the rows below slide up; a new row grows in with a fade and a 4px drop. Use it where the user adds or removes rows
 * (Playground: Display > Lists). Give every row a `key`, and make every row one element (a component with several roots
 * or a renderless one has nothing to fold).
 *
 * It moves only for a row or two coming or going. When the whole list is replaced (first load, another game, search
 * results changing) it stays still, and `:animate="false"` keeps it still while the caller knows a bulk change is on its
 * way (a filter is typed); the render that turns it back on stays still too. `skip` lets the caller keep a row still
 * that is not really arriving or leaving, such as one that moved to another list on the same screen. Reduced motion
 * keeps a short fade. A list inside a `v-if`/`v-else` against an empty state is made and removed whole, so its first row
 * and its last do not move. Anything else on the element (class, role, data-testid) lands on the list's tag, `tag`
 * being `div` unless said.
 */
export default defineComponent({
  name: "AnimatedList",
  props: {
    tag: { type: String, default: "div" },
    /** Off: rows come and go at once. */
    animate: { type: Boolean, default: true },
    /** True for a row that should come or go at once even though the list moves. Called when the row arrives or leaves. */
    skip: { type: Function as PropType<(element: Element, change: "enter" | "leave") => boolean> },
  },
  setup(props, { slots }) {
    let keys: string[] | null = null
    let wasAnimate = props.animate
    let moving = false
    return () => {
      const rows = slots.default?.() ?? []
      const next = rowKeys(rows)
      moving = movesNow(props.animate, wasAnimate, keys, next)
      wasAnimate = props.animate
      keys = next
      return h(
        TransitionGroup,
        {
          tag: props.tag,
          css: false,
          onEnter: (element: Element, done: () => void) => (moving && !props.skip?.(element, "enter") ? enterRow(element, done) : done()),
          onLeave: (element: Element, done: () => void) => (moving && !props.skip?.(element, "leave") ? leaveRow(element, done) : done()),
        },
        () => rows,
      )
    }
  },
})
