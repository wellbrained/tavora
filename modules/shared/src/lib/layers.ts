// One list of what lies on top of the page, oldest first: the kit's dialogs (DialogContent, DialogScrollContent) and
// dropdown menus. Everything that asks "is something on top, and what?" reads it:
//
// - Shortcuts and Ctrl+Z stand down while a dialog is open (`isModalOpen`): the app's shortcut table asks it in one place
//   (renderer `heldBackByModal`), the kit's undo in `handleUndoKey`.
// - The page outside the top layer that shuts it (a dialog, a modal menu) is inert: Tab and a screen reader's cursor can't
//   leave it (inert-behind.ts). Only that one layer holds it, so closing it hands the page to the next one down.
// - The app counts the dialogs on the page from here (renderer `host.ts`): the queue of questions waits for them, module
//   panels step aside and the window buttons dim.
//
// A layer is `open` from the moment its content is told to open (before it is drawn), then `closing` while it leaves,
// and gone once its content is unmounted. Escape belongs to the top layer: Reka already hands it only to its highest one,
// and a page's own keys ask `isModalOpen` before they act. Popovers, selects and context menus are not listed: they
// don't wait on the user, and a key pressed inside one belongs to it.
import { defineComponent, getCurrentInstance, inject, onBeforeUnmount, onMounted, onScopeDispose, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue"
import { inertBehind } from "./inert-behind"

export type LayerKind = "dialog" | "menu"

export interface Layer {
  readonly id: number
  readonly kind: LayerKind
  /** It shuts the page around it (inert) while it is the top layer that does. */
  readonly modal: boolean
  /** `closing`: told to close, still on the page while it leaves. */
  readonly state: "open" | "closing"
  /** Its content, once it is on the page. */
  readonly element: HTMLElement | null
}

const stack = shallowRef<readonly Layer[]>([])

/** Every layer, the top one last. */
export const layers: Readonly<Ref<readonly Layer[]>> = stack

/** The top layer that is open (not leaving). */
export function topLayer(list: readonly Layer[] = stack.value): Layer | undefined {
  return list.findLast((layer) => layer.state === "open")
}

/** Whether a dialog is open: page keys (shortcuts, Ctrl+Z) stand down. A menu alone doesn't count. */
export function isModalOpen(list: readonly Layer[] = stack.value): boolean {
  return list.some((layer) => layer.kind === "dialog" && layer.state === "open")
}

/** The layer whose page around it is inert: the top modal one on the page, a leaving one too until it is gone. */
export function inertHolder(list: readonly Layer[] = stack.value): Layer | undefined {
  return list.findLast((layer) => layer.modal && layer.element !== null)
}

let nextId = 1

function change(id: number, update: (layer: Layer) => Layer | null): void {
  stack.value = stack.value.flatMap((layer) => {
    if (layer.id !== id) return [layer]
    const next = update(layer)
    return next ? [next] : []
  })
}

/** Opens a layer on top (or brings a leaving one back on top, open again). */
function open(id: number, kind: LayerKind, modal: boolean): void {
  const before = stack.value.find((layer) => layer.id === id)
  stack.value = [...stack.value.filter((layer) => layer.id !== id), { id, kind, modal, state: "open", element: before?.element ?? null }]
}

/** Closing: it stays while its content is on the page, and goes at once when it never got there. */
function close(id: number): void {
  change(id, (layer) => (layer.element ? { ...layer, state: "closing" } : null))
}

const remove = (id: number) => change(id, () => null)

// Only the top modal layer holds the page inert. The next holder takes it before the last one lets go, so the page is
// never reachable in between (inert-behind.ts counts holds).
let held: HTMLElement | null = null
let letGo: (() => void) | undefined
watch(
  () => inertHolder(stack.value)?.element ?? null,
  (element) => {
    if (element === held) return
    const before = letGo
    held = element
    letGo = element ? inertBehind(element) : undefined
    before?.()
  },
  { flush: "sync" },
)

const layerKey: InjectionKey<number> = Symbol("layer")

/**
 * For the content of a dialog or menu: lists it as a layer for as long as `open` is true (sync, so it counts before it is
 * drawn), as leaving after that until its `LayerAnchor` is unmounted. Put a `LayerAnchor` inside the content.
 */
export function useLayer(kind: LayerKind, isOpen: Readonly<Ref<boolean>>, modal: () => boolean = () => true): void {
  const id = nextId++
  provide(layerKey, id)
  watch(isOpen, (value) => (value ? open(id, kind, modal()) : close(id)), { flush: "sync", immediate: true })
  watch(modal, (value) => change(id, (layer) => ({ ...layer, modal: value })), { flush: "sync" })
  onScopeDispose(() => remove(id))
}

/**
 * Inside a layer's content (it draws nothing): tells the layer its element while the content is on the page, and ends a
 * leaving layer when the content goes.
 */
export const LayerAnchor = defineComponent({
  name: "LayerAnchor",
  setup() {
    const id = inject(layerKey, null)
    const instance = getCurrentInstance()
    onMounted(() => {
      const element = (instance?.vnode.el as Node | null)?.parentElement ?? null
      if (id !== null) change(id, (layer) => ({ ...layer, element }))
    })
    onBeforeUnmount(() => {
      if (id !== null) change(id, (layer) => (layer.state === "closing" ? null : { ...layer, element: null }))
    })
    return () => null
  },
})
