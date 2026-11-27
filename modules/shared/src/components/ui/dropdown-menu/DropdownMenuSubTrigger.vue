<script setup lang="ts">
import type { DropdownMenuSubTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ChevronRight } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DropdownMenuSubTrigger,
  useForwardProps,
} from "reka-ui"
import { cn } from "../../../lib/utils"
import { choiceSubmenu } from "../choice-row"

const props = defineProps<DropdownMenuSubTriggerProps & {
  class?: HTMLAttributes["class"]
  inset?: boolean
  /** Its submenu holds the chosen choice: the entry gets the chosen row's look, as the radio items in it do. */
  chosen?: boolean
}>()

const delegatedProps = reactiveOmit(props, "class", "inset", "chosen")
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DropdownMenuSubTrigger
    data-slot="dropdown-menu-sub-trigger"
    v-bind="forwardedProps"
    :data-inset="inset ? '' : undefined"
    :data-chosen="chosen ? '' : undefined"
    :class="cn(
      `relative flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none focus:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--accent))] focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-(--disabled-opacity) data-[inset]:pl-8 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground focus:[&_svg:not([class*='text-'])]:text-accent-foreground data-[state=open]:[&_svg:not([class*='text-'])]:text-accent-foreground data-[variant=destructive]:*:[svg]:text-destructive!`,
      choiceSubmenu,
      props.class,
    )"
  >
    <slot />
    <ChevronRight class="ml-auto size-4" />
  </DropdownMenuSubTrigger>
</template>
