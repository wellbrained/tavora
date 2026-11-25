<script setup lang="ts">
import type { ContextMenuRadioItemEmits, ContextMenuRadioItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  ContextMenuRadioItem,
  useForwardPropsEmits,
} from "reka-ui"
import { cn } from "../../../lib/utils"
import { choiceFocused, choiceRow } from "../choice-row"

const props = defineProps<ContextMenuRadioItemProps & { class?: HTMLAttributes["class"] }>()
const emits = defineEmits<ContextMenuRadioItemEmits>()

const delegatedProps = reactiveOmit(props, "class")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ContextMenuRadioItem
    data-slot="context-menu-radio-item"
    v-bind="forwarded"
    :class="cn(
      `focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-lg py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
      choiceRow,
      choiceFocused,
      props.class,
    )"
  >
    <slot />
  </ContextMenuRadioItem>
</template>
