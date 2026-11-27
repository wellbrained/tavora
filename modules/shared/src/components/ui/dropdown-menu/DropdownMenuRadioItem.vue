<script setup lang="ts">
import type { DropdownMenuRadioItemEmits, DropdownMenuRadioItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DropdownMenuRadioItem,
  useForwardPropsEmits,
} from "reka-ui"
import { mergeProps, ref } from "vue"
import { ACTIVATE_KEYS, useAriaDisabled, useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { choiceFocused, choiceRow } from "../choice-row"

defineOptions({ inheritAttrs: false })
const props = defineProps<DropdownMenuRadioItemProps & {
  class?: HTMLAttributes["class"]
  /**
   * Why it is off. With `disabled` the choice stays reachable by hover and the arrow keys, shows the reason beside it
   * and can't be picked. Without a reason a disabled choice is skipped, as before.
   */
  disabledReason?: string
}>()

const emits = defineEmits<DropdownMenuRadioItemEmits>()

const delegatedProps = reactiveOmit(props, "class", "disabledReason")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
// As on DropdownMenuItem: Reka skips rows marked `data-disabled`, so a choice with a reason is `aria-disabled` instead.
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason }), { keys: ACTIVATE_KEYS, dataDisabled: false, side: "right" })
const item = ref<{ $el?: unknown } | null>(null)
useAriaDisabled(() => item.value, soft.soft)
</script>

<template>
  <DropdownMenuRadioItem
    ref="item"
    data-slot="dropdown-menu-radio-item"
    v-bind="mergeProps(forwarded, soft.attrs())"
    :value="props.value"
    :disabled="soft.disabled()"
    :class="cn(
      `focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-lg py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-(--disabled-opacity) aria-disabled:cursor-not-allowed aria-disabled:opacity-(--disabled-opacity) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
      choiceRow,
      choiceFocused,
      props.class,
    )"
  >
    <slot />
  </DropdownMenuRadioItem>
</template>
