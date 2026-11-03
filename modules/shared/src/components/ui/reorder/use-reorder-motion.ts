import { nextTick, onBeforeUnmount, type Ref } from "vue"
import { placeAt, pointerAtGrab, slideOffsets, type Slot } from "./slide"
import { commitAndWait } from "./settle"
import "./reorder.css"

export interface ReorderMotionOptions {
  /** The way the list runs: `y` for rows, `x` for tabs and icons in a row. */
  axis?: "x" | "y"
  /** The attribute that names an item. Items that reorder together all carry it. */
  attribute?: string
}

/** What the lifted item gets besides its scale: to stand above the others. No shadow: the list may sit over a game, so only transform and opacity move. */
const LIFT = ["z-20"]

/** Reduced motion keeps the lines and drops the sliding, lifting and settling. */
export function reducedMotion(): boolean {
  return typeof matchMedia !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Motion for a list the user reorders by dragging. The caller still owns the order and the drop line; this only moves
 * the items it is told about, with `translate` and `scale`:
 * - `begin(id)` on grab (`lift` for a drag the page draws itself: the item lifts and `follow` moves it with the pointer),
 * - `over(x, y)` while the pointer moves in a native drag: it works out the place from the pointer and the layout at the
 *   grab (never from the items as they slide, which would swap them back and forth) and previews it; returns the place,
 *   or null where the order would stay. A drag that is not over the list calls `preview(null)`.
 * - `preview(place)` for a place the page works out itself: the others slide to open a gap there (`null`: back where they were),
 * - `drop(commit)` on release: `commit` changes the order and everything settles from where it was on screen,
 * - `cancel()` when the drag ends without a move.
 * Keyboard reordering never calls it, so it stays instant. Items sit in a list along one axis, one level deep.
 */
export function useReorderMotion(container: Ref<HTMLElement | null>, options: ReorderMotionOptions = {}) {
  const axis = options.axis ?? "y"
  const attribute = options.attribute ?? "data-reorder-id"
  let dragId: string | null = null
  let slots: Slot[] = []
  let scroll0 = { left: 0, top: 0 }
  /** Where the list's own box was on screen at the grab: it moves when an ancestor scrolls, which the list's scroll position doesn't show. */
  let origin0 = { left: 0, top: 0 }
  let lifted: HTMLElement | null = null
  let cleanup: ReturnType<typeof setTimeout> | undefined
  let settling = false

  const items = (): HTMLElement[] => [...(container.value?.querySelectorAll<HTMLElement>(`[${attribute}]`) ?? [])]
  const idOf = (el: HTMLElement) => el.getAttribute(attribute)!
  const duration = () => {
    const raw = container.value ? getComputedStyle(container.value).getPropertyValue("--duration-reorder").trim() : ""
    const ms = Number.parseFloat(raw)
    return Number.isFinite(ms) ? ms : 200
  }

  function shift(el: HTMLElement, offset: number) {
    el.style.translate = offset ? (axis === "x" ? `${offset}px 0` : `0 ${offset}px`) : ""
  }

  function reset() {
    for (const el of items()) {
      el.style.translate = ""
      el.style.transition = ""
      el.removeAttribute("data-reorder-lifted")
      el.removeAttribute("data-reorder-following")
      el.classList.remove(...LIFT)
    }
    container.value?.classList.remove("tavora-reordering")
    lifted = null
    dragId = null
    slots = []
    settling = false
  }

  function begin(id: string, { lift = false } = {}) {
    clearTimeout(cleanup)
    reset()
    if (!container.value) return
    dragId = id
    const el = container.value
    scroll0 = { left: el.scrollLeft, top: el.scrollTop }
    const box0 = el.getBoundingClientRect()
    origin0 = { left: box0.left, top: box0.top }
    slots = items().map((item) => {
      const box = item.getBoundingClientRect()
      return { id: idOf(item), start: axis === "x" ? box.left : box.top, size: axis === "x" ? box.width : box.height }
    })
    if (reducedMotion()) return
    el.classList.add("tavora-reordering")
    if (lift) {
      lifted = items().find((item) => idOf(item) === id) ?? null
      lifted?.setAttribute("data-reorder-lifted", "")
      lifted?.setAttribute("data-reorder-following", "")
      lifted?.classList.add(...LIFT)
    }
  }

  /** Where the dragged item would land; the others slide to open the gap. */
  function preview(place: { id: string; after: boolean } | null) {
    if (!dragId || reducedMotion()) return
    const offsets = place ? slideOffsets(slots, dragId, place.id, place.after) : null
    for (const el of items()) {
      const id = idOf(el)
      if (id === dragId && lifted) continue
      shift(el, offsets?.get(id) ?? 0)
    }
  }

  /** The pointer is at `x`, `y` (viewport) in a native drag: the place it means, measured against the layout at the grab, and previewed. `among` limits the places to some ids. */
  function over(x: number, y: number, among?: readonly string[]): { id: string; after: boolean } | null {
    if (!dragId || !container.value) return null
    // The list, or something around it (the panel's scroller), may have scrolled since the grab: the pointer is taken back to where the layout was measured.
    const now = container.value.getBoundingClientRect()
    const pointer =
      axis === "x"
        ? pointerAtGrab(x, origin0.left, now.left, scroll0.left, container.value.scrollLeft)
        : pointerAtGrab(y, origin0.top, now.top, scroll0.top, container.value.scrollTop)
    const place = placeAt(slots, dragId, pointer, among)
    preview(place)
    return place
  }

  /** A lifted item moves with the pointer: `dx`, `dy` is how far the pointer has gone since the grab. */
  function follow(dx: number, dy: number) {
    if (!lifted || !container.value) return
    // The list may have scrolled since the grab; the item scrolled with it, so the pointer's move is made up for.
    const x = dx + (scroll0.left - container.value.scrollLeft)
    const y = dy + (scroll0.top - container.value.scrollTop)
    lifted.style.translate = axis === "x" ? `${x}px 0` : `0 ${y}px`
  }

  /**
   * The order is about to change: `commit` changes it, and everything settles from where it is on screen into its new
   * place. Until the list shows the new order the items stay where the drag left them, so nothing flickers back.
   */
  async function drop(commit: () => void | Promise<void>) {
    const el = container.value
    if (!el || !dragId || reducedMotion()) {
      await commit()
      reset()
      return
    }
    settling = true
    const before = items().map(idOf).join("\n")
    const first = new Map(items().map((item) => [idOf(item), item.getBoundingClientRect()]))
    // The owner of the list may take a moment to change it, and a failed change must not leave the items stuck.
    const result = await commitAndWait(commit, () => items().map(idOf).join("\n") !== before)
    if (result !== "changed") {
      settling = false
      cancel()
      return
    }
    for (const item of items()) {
      item.style.transition = "none"
      item.style.translate = ""
    }
    for (const item of items()) {
      const was = first.get(idOf(item))
      if (!was) continue
      const now = item.getBoundingClientRect()
      // Centres, so the lift's growth does not count as a move.
      const dx = was.left + was.width / 2 - (now.left + now.width / 2)
      const dy = was.top + was.height / 2 - (now.top + now.height / 2)
      const offset = axis === "x" ? dx : dy
      if (Math.abs(offset) >= 1) item.style.translate = axis === "x" ? `${offset}px 0` : `0 ${offset}px`
    }
    // Read the layout once, so the start position is in place before the transition is switched on.
    void el.offsetWidth
    // Now it all eases to rest: into the place, out of the lift.
    for (const item of items()) {
      item.style.transition = ""
      item.style.translate = ""
      item.removeAttribute("data-reorder-lifted")
      item.removeAttribute("data-reorder-following")
      item.classList.remove(...LIFT)
    }
    clearTimeout(cleanup)
    cleanup = setTimeout(reset, duration() + 40)
  }

  function cancel() {
    // A native drag ends with a dragend after its drop; the settling carries on.
    if (settling) return
    if (!dragId) return reset()
    preview(null)
    for (const item of items()) {
      item.removeAttribute("data-reorder-lifted")
      item.removeAttribute("data-reorder-following")
      item.classList.remove(...LIFT)
      item.style.translate = ""
    }
    clearTimeout(cleanup)
    cleanup = setTimeout(reset, duration() + 40)
  }

  onBeforeUnmount(() => {
    clearTimeout(cleanup)
    reset()
  })

  return { begin, preview, over, follow, drop, cancel }
}

/**
 * The picture that travels with the pointer in a native (HTML) drag: the item as it is, lifted with the kit's shadow on
 * its own surface. The page can't style that picture afterwards, so this builds it. Does nothing under reduced motion.
 */
export function liftedDragImage(event: DragEvent, element: HTMLElement) {
  const transfer = event.dataTransfer
  if (!transfer?.setDragImage || reducedMotion()) return
  const box = element.getBoundingClientRect()
  const pad = 24
  const wrap = document.createElement("div")
  wrap.style.cssText = `position:fixed;top:-10000px;left:0;padding:${pad}px;pointer-events:none;`
  const copy = element.cloneNode(true) as HTMLElement
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("[data-reorder-id], [id]")]) {
    node.removeAttribute("data-reorder-id")
    node.removeAttribute("id")
  }
  const style = getComputedStyle(element)
  copy.classList.add("shadow-lg", "scale-[1.03]")
  copy.style.width = `${box.width}px`
  copy.style.height = `${box.height}px`
  copy.style.opacity = "1"
  copy.style.borderRadius = style.borderRadius
  copy.style.margin = "0"
  // A row with no surface of its own would show through; give it the list's.
  if (style.backgroundColor === "rgba(0, 0, 0, 0)" || style.backgroundColor === "transparent") copy.style.backgroundColor = "var(--card)"
  wrap.append(copy)
  document.body.append(wrap)
  transfer.setDragImage(wrap, event.clientX - box.left + pad, event.clientY - box.top + pad)
  setTimeout(() => wrap.remove(), 0)
}
