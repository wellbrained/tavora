<script setup lang="ts">
// A row of buttons, toggles and menus that is one Tab stop: the arrow keys move along it, Home and End jump to its
// ends, and it starts over at the other end. Tab out and back in, and you land on the item you used last.
// Put kit controls straight in: a `Button`, `Toggle`, `ToggleGroup`, `SegmentedControl` or menu trigger joins by itself, and a
// `Separator` turns across the row. In a choice group the arrows only move the focus; Space or Enter picks. A field
// (search, number, select) stays a Tab stop of its own, since it needs the arrows for its text.
// A switched-off Button stays reachable here, so a keyboard user hears that it's off (and why, with `disabledReason`).
// It lays its items out in a row (or a column with `orientation="vertical"`) and has no look of its own: give the bar its
// border, background and padding where it's used.
import { ToolbarRoot } from "reka-ui"
import { computed, useId, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { provideToolbar, type ToolbarOrientation } from "./context"

const props = withDefaults(defineProps<{
  /** Its name for screen readers, such as "Text style" or "Map". */
  label: string
  orientation?: ToolbarOrientation
  class?: HTMLAttributes["class"]
}>(), { orientation: "horizontal" })

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
    :class="cn('flex min-w-0 items-center gap-1', orientation === 'vertical' && 'flex-col', props.class)"
    @keydown.capture="onKeydownCapture"
  >
    <slot />
  </ToolbarRoot>
</template>
