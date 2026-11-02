<script setup lang="ts">
// The kit's tooltip beside a box the game gives it, for things with no element to hover (canvas nodes, buildings in an
// SVG). Put it anywhere inside a ZoomPane (or beside it) and give `rect`: the box in the pane, in pixels from its top
// left corner, as drawn. It opens next to the box with a small gap, never at the pointer and never on the box, as the
// kit's tooltips do. Null hides it. Fill the default slot for your own content and look (rows, an icon, a picture); the
// title, description and shortcut are the kit's usual ones. Easiest with `useZoomTip()`.
// The box is where the thing was when you showed the tip: when the pane pans or zooms the tip says `dismiss` and closes
// (show it again where the thing is now), so it never hangs where the thing no longer is.
import { computed, inject, watch } from "vue"
import Tooltip from "../../tooltip/Tooltip"
import type { TooltipSide } from "../../tooltip"
import { zoomPaneKey } from "./context"
import type { ZoomTipRect } from "./use-zoom-tip"

const props = withDefaults(defineProps<{
  rect: ZoomTipRect | null
  title?: string
  description?: string
  shortcut?: string
  /** Where it goes when there is room. */
  side?: TooltipSide
  tone?: "warning" | "danger"
  /** Smaller type and padding, for a one-line label. */
  compact?: boolean
}>(), { side: "bottom" })
const emit = defineEmits<{ dismiss: [] }>()

const context = inject(zoomPaneKey, null)
watch(() => context?.view.value, () => {
  if (props.rect) emit("dismiss")
})
/** The box on the screen: the pane's own place plus the box in it. Worked out when `rect` changes. */
const anchor = computed(() => {
  if (!props.rect) return undefined
  const origin = context?.element.value?.getBoundingClientRect()
  const left = (origin?.left ?? 0) + props.rect.left
  const top = (origin?.top ?? 0) + props.rect.top
  return { left, top, right: left + props.rect.width, bottom: top + props.rect.height }
})
</script>

<template>
  <Tooltip
    :open="rect !== null"
    :anchor="anchor"
    :side="side"
    :title="title"
    :description="description"
    :shortcut="shortcut"
    :tone="tone"
    :compact="compact"
    @dismiss="emit('dismiss')"
  >
    <slot />
  </Tooltip>
</template>
