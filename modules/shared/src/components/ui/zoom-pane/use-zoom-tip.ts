// The kit's tooltip for things that have no element of their own (a node on a canvas, a building in an SVG): the game
// says where on the pane the thing is, the tooltip opens beside that box. State for a `<ZoomTip v-bind="tip" />`.
import { onScopeDispose, reactive, getCurrentScope } from "vue"
import { tooltipDelay } from "../../tooltip"

/** A box in the pane, in pixels from the pane's top left corner (screen space, as drawn: not content units). */
export interface ZoomTipRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ZoomTipContent {
  title?: string
  description?: string
  /** A keyboard shortcut beside the title, such as "Ctrl+D". */
  shortcut?: string
}

export interface UseZoomTip {
  /** Bind it to the tip: `<ZoomTip v-bind="tip" @dismiss="hide" />`. */
  tip: ZoomTipContent & { rect: ZoomTipRect | null }
  /** Shows the tip beside `rect` once the hover wait is over (at once while another tooltip is open or just closed). */
  show(rect: ZoomTipRect, content?: ZoomTipContent): void
  /** Hides it, and cancels one that is still waiting. */
  hide(): void
}

/** The wait before the first tip shows, as for a title hint. */
export const ZOOM_TIP_DELAY_MS = 500

export function useZoomTip(options: { delay?: number } = {}): UseZoomTip {
  const tip = reactive<ZoomTipContent & { rect: ZoomTipRect | null }>({ rect: null })
  let timer: ReturnType<typeof setTimeout> | undefined
  function hide() {
    clearTimeout(timer)
    timer = undefined
    tip.rect = null
  }
  function show(rect: ZoomTipRect, content: ZoomTipContent = {}) {
    clearTimeout(timer)
    const apply = () => {
      timer = undefined
      tip.title = content.title
      tip.description = content.description
      tip.shortcut = content.shortcut
      tip.rect = { ...rect }
    }
    // Moving from one thing to the next while a tip is open: no waiting.
    const wait = tip.rect ? 0 : tooltipDelay(options.delay ?? ZOOM_TIP_DELAY_MS)
    if (wait <= 0) apply()
    else timer = setTimeout(apply, wait)
  }
  if (getCurrentScope()) onScopeDispose(hide)
  return { tip, show, hide }
}
