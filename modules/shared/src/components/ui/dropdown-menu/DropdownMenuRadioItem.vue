<script setup lang="ts">
import type { DropdownMenuRadioItemEmits, DropdownMenuRadioItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import {
  DropdownMenuRadioItem,
  useForwardPropsEmits,
} from "reka-ui"
import { computed, mergeProps, ref } from "vue"
import { ACTIVATE_KEYS, useAriaDisabled, useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"
import { menuReason, menuReasonRow } from "../menu-reason"
import { choiceFocused, choiceRow } from "../choice-row"

defineOptions({ inheritAttrs: false })
const props = defineProps<DropdownMenuRadioItemProps & {
  class?: HTMLAttributes["class"]
  /**
   * Why it is off. With `disabled` the choice stays reachable by hover and the arrow keys, shows the reason where a hint sits
   * and can't be picked. Without a reason a disabled choice is skipped, as before.
   */
  disabledReason?: string
}>()

const emits = defineEmits<DropdownMenuRadioItemEmits>()

const delegatedProps = reactiveOmit(props, "class", "disabledReason")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
// As on DropdownMenuItem: Reka skips rows marked `data-disabled`, so a choice with a reason is `aria-disabled` instead.
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason }), { keys: ACTIVATE_KEYS, dataDisabled: false, shownInside: true })
const item = ref<{ $el?: unknown } | null>(null)
useAriaDisabled(() => item.value, soft.soft)
/** The reason the row shows, while it is off. */
const reason = computed(() => (soft.soft() ? props.disabledReason?.trim() || undefined : undefined))
</script>

<template>
  <DropdownMenuRadioItem
    ref="item"
    data-slot="dropdown-menu-radio-item"
    v-bind="mergeProps(forwarded, soft.attrs())"
    :value="props.value"
    :disabled="soft.disabled()"
    :data-reason="reason ? '' : undefined"
    :class="cn(
      `focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-lg py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-(--disabled-opacity) aria-disabled:cursor-not-allowed aria-disabled:opacity-(--disabled-opacity) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
      choiceRow,
      choiceFocused,
      menuReasonRow,
      props.class,
    )"
  >
    <slot />
    <span v-if="reason" data-slot="menu-reason" :class="menuReason" aria-hidden="true">{{ reason }}</span>
  </DropdownMenuRadioItem>
</template>
