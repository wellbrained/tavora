<script setup lang="ts">
// A right-click opens the menu next to the element, never at the pointer, where it would sit on top of what was
// clicked. Reka anchors a pointer-opened menu to the pointer; opening it ourselves anchors it to the trigger, as
// the keyboard menu key already does.
import type { ContextMenuTriggerProps } from "reka-ui"
import { ContextMenuTrigger, injectContextMenuRootContext, useForwardProps } from "reka-ui"

const props = defineProps<ContextMenuTriggerProps>()

const forwardedProps = useForwardProps(props)
const root = injectContextMenuRootContext()

function open(event: MouseEvent) {
  if (props.disabled || event.defaultPrevented) return
  // Reka checks this after a tick and then leaves the event alone.
  event.preventDefault()
  root.onOpenChange(true)
}
</script>

<template>
  <ContextMenuTrigger
    data-slot="context-menu-trigger"
    v-bind="forwardedProps"
    @contextmenu="open"
  >
    <slot />
  </ContextMenuTrigger>
</template>
