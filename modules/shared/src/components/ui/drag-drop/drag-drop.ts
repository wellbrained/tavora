import { computed, readonly, ref, shallowRef, watch, type ComputedRef, type Ref } from "vue"
import { liftedDragImage } from "../reorder/use-reorder-motion"

/**
 * Dragging a thing onto a target (a card onto a slot, a file onto a folder), with the browser's own drag. A dragover
 * can't read the dragged data, so the drag is kept here: the source says what it drags with `startDrag`, and targets
 * made with `useDropTargets` read it, accept or refuse it, and show where it would land. One drag at a time, as the
 * browser has. What a drop does (place, swap, clear) stays with the caller.
 *
 * For a list the user reorders, use `useReorderMotion` from `ui/reorder` instead.
 */

export interface Drag {
  /** What kind of thing it is: targets only react to their own kind. */
  kind: string
  payload: unknown
}

const current = shallowRef<Drag | null>(null)

/** The drag going on now, of any kind, or null. */
export const currentDrag: Readonly<Ref<Drag | null>> = readonly(current) as Readonly<Ref<Drag | null>>

let stopListening: (() => void) | null = null

/** Ends the drag: the source's `dragend` does this on its own; call it when a drag must stop early. */
export function endDrag() {
  current.value = null
  stopListening?.()
  stopListening = null
}

/**
 * On `dragstart`: starts dragging `payload` of `kind`. The element (the source, unless given) travels with the
 * pointer, lifted as in a reordered list. The drag ends by itself when the browser ends it, also if the source is gone.
 */
export function startDrag(event: DragEvent, kind: string, payload: unknown, element?: HTMLElement) {
  const transfer = event.dataTransfer
  if (!transfer) return
  endDrag()
  transfer.effectAllowed = "move"
  // A type of its own, so drop zones elsewhere (other panels, the desktop) don't take it for text.
  transfer.setData(`application/x-tavora-${kind}`, "")
  const lifted = element ?? (event.currentTarget instanceof HTMLElement ? event.currentTarget : null)
  if (lifted) liftedDragImage(event, lifted)
  current.value = { kind, payload }
  // `dragend` fires on the source; a source removed mid-drag never gets it, so a drop anywhere ends it too (after the
  // targets had their turn).
  const source = event.currentTarget instanceof EventTarget ? event.currentTarget : null
  const finish = () => endDrag()
  const afterDrop = () => setTimeout(finish)
  source?.addEventListener("dragend", finish, { once: true })
  window.addEventListener("drop", afterDrop, { once: true })
  stopListening = () => {
    source?.removeEventListener("dragend", finish)
    window.removeEventListener("drop", afterDrop)
  }
}

export interface DropTargetsOptions<T, K extends string = string> {
  /** Whether `key` takes what is dragged; leave out to take anything of the kind. A target that refuses shows no drop. */
  accepts?: (payload: T, key: K) => boolean
  /** A drop on target `key`. */
  drop: (payload: T, key: K) => void
  /** A drop next to the targets, inside the area (`area` handlers), that no target took. Leave out to refuse those. */
  outside?: {
    accepts?: (payload: T) => boolean
    drop: (payload: T) => void
  }
}

export interface DropTargets<T, K extends string = string> {
  /** What of this kind is being dragged, or null. */
  dragged: ComputedRef<T | null>
  /** The target the pointer is over that takes the drag, or null: show the landing there. */
  over: Readonly<Ref<K | null>>
  /** Handlers for one target: `v-bind="targets.target(key)"`. */
  target: (key: K) => {
    onDragover: (event: DragEvent) => void
    onDragleave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
  }
  /** Handlers for the area around the targets, for `outside` drops: `v-bind="targets.area"`. */
  area: {
    onDragover: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
  }
}

function allow(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
}

/** Drop targets for things of `kind` (see the top of this file). */
export function useDropTargets<T, K extends string = string>(kind: string, options: DropTargetsOptions<T, K>): DropTargets<T, K> {
  const dragged = computed(() => (current.value?.kind === kind ? (current.value.payload as T) : null))
  const over = ref<K | null>(null) as Ref<K | null>

  // Stopped with the component that made the targets.
  watch(dragged, (now) => {
    if (now === null) over.value = null
  })

  function target(key: K) {
    return {
      onDragover(event: DragEvent) {
        const payload = dragged.value
        if (payload === null) return
        // Handled here, never by the area around: a refused target is no "outside".
        event.stopPropagation()
        if (options.accepts && !options.accepts(payload, key)) {
          if (over.value === key) over.value = null
          return
        }
        allow(event)
        over.value = key
      },
      onDragleave(event: DragEvent) {
        // Moving onto a child of the target is no leave.
        const to = event.relatedTarget
        if (to instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(to)) return
        if (over.value === key) over.value = null
      },
      onDrop(event: DragEvent) {
        const payload = dragged.value
        if (payload === null) return
        event.preventDefault()
        event.stopPropagation()
        over.value = null
        endDrag()
        if (!options.accepts || options.accepts(payload, key)) options.drop(payload, key)
      },
    }
  }

  const takesOutside = (payload: T | null): payload is T => payload !== null && !!options.outside && (!options.outside.accepts || options.outside.accepts(payload))

  const area = {
    onDragover(event: DragEvent) {
      if (takesOutside(dragged.value)) allow(event)
    },
    onDrop(event: DragEvent) {
      const payload = dragged.value
      if (!takesOutside(payload)) return
      event.preventDefault()
      over.value = null
      endDrag()
      options.outside!.drop(payload)
    },
  }

  return { dragged, over: readonly(over) as Readonly<Ref<K | null>>, target, area }
}
