// One list of what lies on top of the page, oldest first: the kit's dialogs (DialogContent, DialogScrollContent) and
// dropdown menus. Everything that asks "is something on top, and what?" reads it:
//
// - Shortcuts and Ctrl+Z stand down while a dialog is open (`isModalOpen`): the app's shortcut table asks it in one place
//   (renderer `heldBackByModal`), the kit's undo in `handleUndoKey`.
// - The page outside the top layer that shuts it (a dialog, a modal menu) is inert: Tab and a screen reader's cursor can't
//   leave it (inert-behind.ts). Only that one layer holds it, so closing it hands the page to the next one down.
// - The app counts its open dialogs from here, told apart by their `data-testid` (renderer `host.ts`): the queue of
//   questions waits for them, module panels step aside and the window buttons dim.
//
// A layer is `open` from the moment its content is told to open (before it is drawn), then `closing` while it leaves,
// and gone once its content is unmounted. Escape belongs to the top layer: Reka already hands it only to its highest one,
// and a page's own keys ask `isModalOpen` before they act. Popovers, selects and context menus are not listed: they
// don't wait on the user, and a key pressed inside one belongs to it.
import { defineComponent, getCurrentInstance, inject, nextTick, onMounted, onScopeDispose, onUnmounted, provide, shallowRef, watch, type InjectionKey, type Ref } from "vue"
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
  /** Its content's `data-testid`, for the app to tell its dialogs apart. */
  readonly name: string | undefined
}

const stack = shallowRef<readonly Layer[]>([])

/** Every layer, the top one last. */
export const layers: Readonly<Ref<readonly Layer[]>> = stack

/** The top layer that is open (not leaving). */
export function topLayer(list: readonly Layer[] = stack.value): Layer | undefined {
  return list.findLast((layer) => layer.state === "open")
}

/** The dialogs that are open (not leaving), oldest first, drawn yet or not. */
export function openDialogLayers(list: readonly Layer[] = stack.value): Layer[] {
  return list.filter((layer) => layer.kind === "dialog" && layer.state === "open")
}

/** Whether a dialog is open: page keys (shortcuts, Ctrl+Z) stand down. A menu alone doesn't count. */
export function isModalOpen(list: readonly Layer[] = stack.value): boolean {
  return openDialogLayers(list).length > 0
}

/** The layer whose page around it is inert: the top modal one on the page, a leaving one too until it is gone. */
export function inertHolder(list: readonly Layer[] = stack.value): Layer | undefined {
  return list.findLast((layer) => layer.modal && layer.element !== null)
}

let nextId = 1
/** Content on the page per layer id, from its LayerAnchor: a content kept on the page while closed (`forceMount`) has it before it opens. */
const anchored = new Map<number, HTMLElement>()

function updateLayer(id: number, update: (layer: Layer) => Layer | null): void {
  stack.value = stack.value.flatMap((layer) => {
    if (layer.id !== id) return [layer]
    const next = update(layer)
    return next ? [next] : []
  })
}

/** Puts a layer on top, open (a leaving one comes back on top). */
function openLayer(id: number, kind: LayerKind, modal: boolean, name: string | undefined): void {
  const element = anchored.get(id) ?? null
  stack.value = [...stack.value.filter((layer) => layer.id !== id), { id, kind, modal, name, state: "open", element }]
}

/** How long after a close a kept content gets to start its exit animation, and the longest it may take to end. */
const ANIMATION_START_MS = 50
const ANIMATION_MAX_MS = 1000

/**
 * It stays, leaving, while its content is on the page, and goes at once when it never got there. A content that stays on
 * the page after it closed (`kept`: `forceMount`) never unmounts, so its LayerAnchor can't end the layer: it leaves once
 * the content's own animations are over (at most ANIMATION_MAX_MS, so an endless one can't hold the page) and the
 * content is still there. Any other content ends its layer itself, as it unmounts.
 */
function closeLayer(id: number, kept: boolean): void {
  updateLayer(id, (layer) => (layer.element ? { ...layer, state: "closing" } : null))
  const element = stack.value.find((layer) => layer.id === id && layer.state === "closing")?.element
  if (!element || !kept) return
  // The exit animation starts a moment after the content is told to close (the next render and style pass), so the
  // animations are read after that, not now.
  void nextTick()
    .then(() => new Promise((resolve) => setTimeout(resolve, ANIMATION_START_MS)))
    .then(() =>
      Promise.race([
        Promise.all((element.getAnimations?.() ?? []).map((animation) => animation.finished.catch(() => undefined))),
        new Promise((resolve) => setTimeout(resolve, ANIMATION_MAX_MS)),
      ]),
    )
    .then(() => setTimeout(() => updateLayer(id, (layer) => (layer.state === "closing" && layer.element === element ? null : layer)), 0))
}

function removeLayer(id: number): void {
  updateLayer(id, () => null)
}

// Only the top modal layer holds the page inert. The next holder takes it before the last one lets go, so the page is
// never reachable in between (inert-behind.ts counts holds). The watch starts when the kit is first imported and is
// never stopped, on purpose: it belongs to the page's one list and lives as long as the page does.
let releaseInert: (() => void) | undefined
watch(
  () => inertHolder(stack.value)?.element ?? null,
  (element) => {
    const before = releaseInert
    releaseInert = element ? inertBehind(element) : undefined
    before?.()
  },
  { flush: "sync" },
)

const layerKey: InjectionKey<number> = Symbol("layer")

export interface LayerHandle {
  /** Whether this layer is the top open one: only it takes Escape. */
  isTop(): boolean
}

/**
 * For the content of a dialog or menu: lists it as a layer for as long as `open` is true (sync, so it counts before it is
 * drawn), as leaving after that until its `LayerAnchor` leaves the page. Put a `LayerAnchor` inside the content.
 */
export function useLayer(kind: LayerKind, isOpen: Readonly<Ref<boolean>>, options: { modal?: () => boolean; name?: () => string | undefined; kept?: () => boolean } = {}): LayerHandle {
  const id = nextId++
  const modal = options.modal ?? (() => true)
  provide(layerKey, id)
  watch(isOpen, (value) => (value ? openLayer(id, kind, modal(), options.name?.()) : closeLayer(id, options.kept?.() ?? false)), { flush: "sync", immediate: true })
  watch(modal, (value) => updateLayer(id, (layer) => ({ ...layer, modal: value })), { flush: "sync" })
  onScopeDispose(() => removeLayer(id))
  return { isTop: () => topLayer()?.id === id }
}

/**
 * Inside a layer's content (it draws nothing): tells the layer its element while the content is on the page, and ends a
 * leaving layer once the content is gone (after, so the next layer down takes the page from a content no longer there).
 */
export const LayerAnchor = defineComponent({
  name: "LayerAnchor",
  setup() {
    const id = inject(layerKey, null)
    const instance = getCurrentInstance()
    onMounted(() => {
      const element = (instance?.vnode.el as Node | null)?.parentElement ?? null
      if (id === null || !element) return
      anchored.set(id, element)
      updateLayer(id, (layer) => ({ ...layer, element }))
    })
    onUnmounted(() => {
      if (id === null) return
      anchored.delete(id)
      updateLayer(id, (layer) => (layer.state === "closing" ? null : { ...layer, element: null }))
    })
    return () => null
  },
})
