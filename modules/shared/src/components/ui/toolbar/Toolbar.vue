<script setup lang="ts">
// A row of buttons, toggles and menus that is one Tab stop: the arrow keys move along it, Home and End jump to its
// ends, and it starts over at the other end. Tab out and back in, and you land on the item you used last.
// Put kit controls straight in: a `Button`, `Toggle`, `ToggleGroup`, `SegmentedControl` or menu trigger joins by itself, and a
// `Separator` turns across the row. In a choice group the arrows only move the focus; Space or Enter picks. A field
// (search, number, select) stays a Tab stop of its own, since it needs the arrows for its text; Tab from outside lands on a
// field that comes before the tools, then on the tool used last.
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
import { computed, onBeforeUnmount, onMounted, ref, useId, useSlots, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { provideToolbar, type ToolbarOrientation } from "./context"
import { toolbarVariants, type ToolbarVariant } from "./variants"

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
/** Rows under its tools (a search and filter header). Read while rendering, since a `below` may come and go. */
const stacked = () => !!slots.below

// reka-ui sends this (cancelable) event to the toolbar element when Tab brings the focus in.
const ENTRY_FOCUS = "rovingFocusGroup.onEntryFocus"
const rootEl = ref<InstanceType<typeof ToolbarRoot> | null>(null)

const id = useId()
provideToolbar({ id, orientation: computed(() => props.orientation) })

/**
 * Shift+Tab from a field in the toolbar leaves it (or goes to the tool before the field). Without this the toolbar's own
 * element, which takes the Tab stop on the way in, would catch the focus and hand it to a tool after the field.
 */
function onShiftTab(event: KeyboardEvent, root: HTMLElement) {
  const target = event.target
  if (!(target instanceof HTMLElement) || target === root || target.hasAttribute("data-toolbar-item")) return
  const before = root.tabIndex
  root.tabIndex = -1
  setTimeout(() => {
    if (root.tabIndex === -1) root.tabIndex = before
  })
}

/** The tool Tab lands on: the one used last (it holds the toolbar's one Tab stop), else the first that can take focus. */
function entryTool(root: HTMLElement) {
  const tools = [...root.querySelectorAll<HTMLElement>("[data-toolbar-item]")].filter((item) => item.closest("[data-slot=toolbar]") === root)
  return tools.find((item) => item.tabIndex === 0) ?? tools.find((item) => !item.hasAttribute("data-disabled"))
}

/** The fields of this toolbar (not its tools, not what its tools open) that Tab stops on, in page order. */
function fieldsOf(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex], [contenteditable=true]")].filter(
    (element) => element.closest("[data-slot=toolbar]") === root && !element.closest("[data-toolbar-item]") && element.tabIndex >= 0 && !(element as HTMLInputElement).disabled && !element.hidden,
  )
}

const precedes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

/**
 * Tab from outside lands on the toolbar's own element, which hands the focus to the tool used last (or the first). A
 * field that comes before that tool would be skipped, so it takes the focus instead.
 */
function onEntryFocus(event: Event) {
  const root = event.currentTarget
  if (!(root instanceof HTMLElement)) return
  const tool = entryTool(root)
  const field = fieldsOf(root)[0]
  if (!field || (tool && !precedes(field, tool))) return
  event.preventDefault()
  field.focus()
}

/**
 * Tab forward from the last field in front of the tool used last goes to that tool: the other tools aren't Tab stops, so
 * Tab would otherwise leave the toolbar past all of them. Fields after the tool, or another field first, keep Tab's way.
 */
function onFieldTab(event: KeyboardEvent, root: HTMLElement, field: HTMLElement) {
  const tool = entryTool(root)
  if (!tool || tool.tabIndex === 0 || !precedes(field, tool)) return
  if (fieldsOf(root).some((other) => precedes(field, other) && precedes(other, tool))) return
  event.preventDefault()
  tool.focus()
}

onMounted(() => (rootEl.value?.$el as HTMLElement | undefined)?.addEventListener(ENTRY_FOCUS, onEntryFocus))
onBeforeUnmount(() => (rootEl.value?.$el as HTMLElement | undefined)?.removeEventListener(ENTRY_FOCUS, onEntryFocus))

/**
 * In a column, ↓ moves to the next item, also from a menu trigger, which would open its menu on ↓ in a row. Runs before
 * the trigger sees the key, and moves the focus itself; Enter and Space still open the menu.
 */
function onKeydownCapture(event: KeyboardEvent) {
  if (event.key === "Tab" && event.currentTarget instanceof HTMLElement) {
    const target = event.target
    if (event.shiftKey) return onShiftTab(event, event.currentTarget)
    if (target instanceof HTMLElement && target !== event.currentTarget && !target.closest("[data-toolbar-item]")) return onFieldTab(event, event.currentTarget, target)
    return
  }
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
    ref="rootEl"
    :orientation="orientation"
    loop
    :aria-label="label"
    data-slot="toolbar"
    :data-toolbar-id="id"
    :data-variant="variant"
    :class="cn(toolbarVariants({ variant, orientation, wrap, stacked: stacked() }), props.class)"
    @keydown.capture="onKeydownCapture"
  >
    <template v-if="stacked()">
      <div data-slot="toolbar-row" :class="cn('flex min-w-0 items-center gap-1', orientation === 'vertical' && 'flex-col', wrap && 'flex-wrap')"><slot /></div>
      <slot name="below" />
    </template>
    <slot v-else />
  </ToolbarRoot>
</template>
