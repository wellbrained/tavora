<script setup lang="ts">
import type { DropdownMenuTriggerProps } from "reka-ui"
import { DropdownMenuTrigger, useForwardProps } from "reka-ui"
import { useToolbarJoin } from "../toolbar/context"
import ToolbarItem from "../toolbar/ToolbarItem.vue"

const props = defineProps<DropdownMenuTriggerProps>()

const forwardedProps = useForwardProps(props)
/** In a kit Toolbar its own button is one of the toolbar's stops. With `as-child` around a kit Button, the Button joins instead. */
const { joined } = useToolbarJoin()
</script>

<template>
  <ToolbarItem :join="joined && !asChild" :focusable="!disabled">
    <DropdownMenuTrigger
      data-slot="dropdown-menu-trigger"
      v-bind="forwardedProps"
    >
      <slot />
    </DropdownMenuTrigger>
  </ToolbarItem>
</template>
