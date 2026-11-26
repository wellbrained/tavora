<script setup lang="ts">
// A row of buttons, toggles and menus that is one Tab stop: the arrow keys move along it, Home and End jump to its
// ends, and it starts over at the other end. Tab out and back in, and you land on the item you used last.
// Put kit controls straight in: a `Button`, `Toggle`, `ToggleGroup`, `SegmentedControl` or menu trigger joins by itself, and a
// `Separator` turns across the row. In a choice group the arrows only move the focus; Space or Enter picks. A field
// (search, number, select) stays a Tab stop of its own, since it needs the arrows for its text.
// A switched-off Button stays reachable here, so a keyboard user hears that it's off (and why, with `disabledReason`).
// It lays its items out in a row (or a column with `orientation="vertical"`). Its look:
// - `plain` (the default): none of its own; give it border, background and padding where it's used.
// - `bar`: the panel's tool strip under its header, tinted with a line below (a column: a line at its right), as tall as a
//   control plus 8px. `wrap` lets a narrow panel give it a second row instead of cutting tools off.
// - `floating`: the bar over a map, canvas or text (`tavora-floating`: the style's surface, elevation 2). Where it sits and
//   its layer stay with the caller.
// The `below` slot adds rows under the tools (a search and filter header: the status line, chips, a progress bar), still
// in the one toolbar, so its buttons are on the same arrow keys.
import { ToolbarRoot } from "reka-ui"
import { computed, useId, useSlots, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { provideToolbar, type ToolbarOrientation } from "./context"
import { toolbarClasses, toolbarRowClasses, type ToolbarVariant } from "./variants"

const props = withDefaults(defineProps<{
  /** Its name for screen readers, such as "Text style" or "Map". */
  label: string
  orientation?: ToolbarOrientation
  variant?: ToolbarVariant
  /** In a narrow panel the tools go on to a second row instead of being cut off. */
  wrap?: boolean
  class?: HTMLAttributes["class"]
}>(), { orientation: "horizontal", variant: "plain", wrap: false })

const slots = useSlots()
/** Rows under its tools (a search and filter header). */
const stacked = computed(() => !!slots.below)
const look = computed(() => toolbarClasses({ variant: props.variant, orientation: props.orientation, wrap: props.wrap, stacked: stacked.value }))

const id = useId()
provideToolbar({ id, orientation: computed(() => props.orientation) })

/**
 * In a column, ↓ moves to the next item, also from a menu trigger, which would open its menu on ↓ in a row. Runs before
 * the trigger sees the key, and moves the focus itself; Enter and Space still open the menu.
 */
function onKeydownCapture(event: KeyboardEvent) {
  if (props.orientation !== "vertical" || event.key !== "ArrowDown" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const target = event.target
  const root = event.currentTarget
  if (!(target instanceof HTMLElement) || !(root instanceof HTMLElement) || !target.hasAttribute("aria-haspopup") || !target.hasAttribute("data-toolbar-item")) return
  const items = [...root.querySelectorAll<HTMLElement>("[data-toolbar-item]:not([data-disabled])")].filter((item) => item.closest("[data-slot=toolbar]") === root)
  const at = items.indexOf(target)
  if (at < 0) return
  event.preventDefault()
  event.stopPropagation()
  // The next one that takes the focus (one that's hidden doesn't), starting over at the top.
  for (let step = 1; step < items.length; step++) {
    items[(at + step) % items.length]!.focus()
    if (document.activeElement !== target) return
  }
}
</script>

<template>
  <ToolbarRoot
    :orientation="orientation"
    loop
    :aria-label="label"
    data-slot="toolbar"
    :data-toolbar-id="id"
    :data-variant="variant"
    :class="cn(look, props.class)"
    @keydown.capture="onKeydownCapture"
  >
    <template v-if="stacked">
      <div data-slot="toolbar-row" :class="toolbarRowClasses({ orientation, wrap })"><slot /></div>
      <slot name="below" />
    </template>
    <slot v-else />
  </ToolbarRoot>
</template>
