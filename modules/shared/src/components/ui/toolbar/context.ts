import { computed, getCurrentInstance, inject, onMounted, provide, ref, type ComputedRef, type InjectionKey, type Ref } from "vue"

// How kit controls find the Toolbar they sit in. A `Toolbar` provides this; a kit `Button`, `Toggle`, `ToggleGroup`,
// `SegmentedControl`, menu trigger or `Separator` under it reads it and joins the toolbar's one Tab stop. Content a
// toolbar opens (a popover, a menu, a dialog) is moved to the body and stays out of the arrow keys: the kit's overlay
// contents call `leaveToolbar()`. A field (search, combobox, slider) keeps its own Tab stop, and calls it too, so its
// inner buttons stay out.

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

/** For a control with buttons inside that are not toolbar items of their own (a search field's clear button), and for
 * content that opens over the page (a popover, a menu, a dialog). */
export function leaveToolbar() {
  provide(TOOLBAR, null)
}

export interface ToolbarJoin {
  /** On from the start under a toolbar; off once mounted when this control's element turns out to be outside it. */
  joined: Readonly<Ref<boolean>>
  /** The toolbar's direction while joined. */
  orientation: ComputedRef<ToolbarOrientation | undefined>
}

/**
 * Whether this control is an item of a kit Toolbar. It is one from its first render: joining later would swap the
 * control's element, and a popover or menu trigger around it would keep pointing at the removed one (its popup then
 * opens at the window's top left). Once mounted it checks that it really is inside the toolbar's element, for content
 * moved elsewhere without `leaveToolbar()`. `element` defaults to the component's own.
 */
export function useToolbarJoin(element?: () => Element | null | undefined): ToolbarJoin {
  const context = inject(TOOLBAR, null)
  const joined = ref(!!context)
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
