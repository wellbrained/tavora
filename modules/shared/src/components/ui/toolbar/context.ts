import { computed, getCurrentInstance, inject, onMounted, provide, ref, type ComputedRef, type InjectionKey, type Ref } from "vue"

// How kit controls find the Toolbar they sit in. A `Toolbar` provides this; a kit `Button`, `Toggle`, `ToggleGroup`,
// `SegmentedControl`, menu trigger or `Separator` under it reads it and joins the toolbar's one Tab stop. A control only
// joins when its element really is inside that toolbar's element: content a toolbar opens (a popover, a menu, a dialog)
// is moved to the body and stays out of the arrow keys. A field (search, combobox, slider) keeps its own Tab stop, and
// calls `leaveToolbar()` so its inner buttons stay out too.

export type ToolbarOrientation = "horizontal" | "vertical"

export interface ToolbarContext {
  /** Matches the toolbar element's `data-toolbar-id`. */
  id: string
  orientation: Ref<ToolbarOrientation>
}

const TOOLBAR: InjectionKey<ToolbarContext | null> = Symbol("tavora-toolbar")

/** For the `Toolbar` itself. */
export function provideToolbar(context: ToolbarContext) {
  provide(TOOLBAR, context)
}

/** For a control with buttons inside that are not toolbar items of their own (a search field's clear button). */
export function leaveToolbar() {
  provide(TOOLBAR, null)
}

export interface ToolbarJoin {
  /** Set once mounted, when this control's element is inside the toolbar's element. */
  joined: Readonly<Ref<boolean>>
  /** The toolbar's direction while joined. */
  orientation: ComputedRef<ToolbarOrientation | undefined>
}

/**
 * Whether this control is an item of a kit Toolbar. It starts out not joined and checks once mounted, so a control
 * the toolbar opens in a popover or a menu (moved to the body) never joins. `element` defaults to the component's own.
 */
export function useToolbarJoin(element?: () => Element | null | undefined): ToolbarJoin {
  const context = inject(TOOLBAR, null)
  const joined = ref(false)
  if (context) {
    const instance = getCurrentInstance()
    onMounted(() => {
      const raw = element ? element() : (instance?.proxy?.$el as Element | null | undefined)
      // A component's root may be a text or comment node (a fragment); use the element after it.
      const at = raw instanceof Element ? raw : raw && (raw as Node).nextSibling instanceof Element ? ((raw as Node).nextSibling as Element) : null
      const toolbar = at?.closest("[data-slot=toolbar]")
      joined.value = !!toolbar && toolbar.getAttribute("data-toolbar-id") === context.id
    })
  }
  return { joined, orientation: computed(() => (joined.value ? context?.orientation.value : undefined)) }
}
