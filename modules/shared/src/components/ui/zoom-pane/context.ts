import type { InjectionKey, Ref } from "vue"
import type { ZoomView } from "./view"

/** What a ZoomPane gives what is inside it: its element and view, so a ZoomTip can place itself and go when the view moves. */
export interface ZoomPaneContext {
  element: Ref<HTMLElement | undefined>
  view: Readonly<Ref<ZoomView>>
}

export const zoomPaneKey: InjectionKey<ZoomPaneContext> = Symbol("zoom-pane")
