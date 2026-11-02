import type { InjectionKey, Ref } from "vue"

/** What a ZoomPane gives what is inside it: its element, so a ZoomTip can turn pane positions into screen ones. */
export interface ZoomPaneContext {
  element: Ref<HTMLElement | undefined>
}

export const zoomPaneKey: InjectionKey<ZoomPaneContext> = Symbol("zoom-pane")
