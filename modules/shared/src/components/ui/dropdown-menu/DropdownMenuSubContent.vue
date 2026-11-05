<script setup lang="ts">
import type { DropdownMenuSubContentEmits, DropdownMenuSubContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DropdownMenuSubContent,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "../../../lib/utils"

// A submenu opens beside its parent with the same 4 px gap as other menus: its trigger row sits 5 px inside the
// parent (p-1 + border), so it moves out by 9 px, and up by 5 px so its first row lines up with the trigger.
const props = withDefaults(defineProps<DropdownMenuSubContentProps & { class?: HTMLAttributes["class"] }>(), {
  sideOffset: 9,
  alignOffset: -5,
})
const emits = defineEmits<DropdownMenuSubContentEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DropdownMenuSubContent
    data-slot="dropdown-menu-sub-content"
    v-bind="forwarded"
    :class="cn('bg-popover text-popover-foreground tavora-popup z-50 min-w-[8rem] max-w-(--reka-dropdown-menu-content-available-width) overflow-hidden rounded-xl border p-1 shadow-lg', props.class)"
  >
    <slot />
  </DropdownMenuSubContent>
</template>
