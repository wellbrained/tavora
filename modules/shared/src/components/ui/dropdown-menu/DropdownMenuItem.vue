<script setup lang="ts">
import type { DropdownMenuItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { DropdownMenuItem, useForwardProps } from "reka-ui"
import { cn } from "../../../lib/utils"
import { ActionRow } from "../action-row"

const props = withDefaults(defineProps<DropdownMenuItemProps & {
  class?: HTMLAttributes["class"]
  inset?: boolean
  variant?: "default" | "destructive"
  /** One line under the name. With it, or with the `icon` slot, the item shows as a row with an icon tile. */
  description?: string
}>(), {
  variant: "default",
})

const delegatedProps = reactiveOmit(props, "inset", "variant", "description", "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    :data-inset="inset ? '' : undefined"
    :data-variant="variant"
    v-bind="forwardedProps"
    :class="cn(`relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none focus:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--accent))] focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground focus:[&_svg:not([class*='text-'])]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive!`, (description || $slots.icon) && 'gap-3 py-2', props.class)"
  >
    <ActionRow v-if="description || $slots.icon" :description="description">
      <template v-if="$slots.icon" #icon><slot name="icon" /></template>
      <slot />
    </ActionRow>
    <slot v-else />
  </DropdownMenuItem>
</template>
