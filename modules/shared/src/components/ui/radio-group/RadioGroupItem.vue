<script setup lang="ts">
import type { RadioGroupItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { CircleIcon } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import {
  RadioGroupIndicator,
  RadioGroupItem,
  useForwardProps,
} from "reka-ui"
import { ref } from "vue"
import { ACTIVATE_KEYS, useAriaDisabled, useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"

defineOptions({ inheritAttrs: false })
const props = defineProps<RadioGroupItemProps & {
  class?: HTMLAttributes["class"]
  /** Why it is off. While `disabled` the dot stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
}>()

const delegatedProps = reactiveOmit(props, "class", "disabledReason")

const forwardedProps = useForwardProps(delegatedProps)
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason }), { keys: ACTIVATE_KEYS })
// Reka writes its own state on the button, so `aria-disabled` is set on the element.
const item = ref<{ $el?: unknown } | null>(null)
useAriaDisabled(() => item.value, soft.soft)
</script>

<template>
  <RadioGroupItem
    ref="item"
    data-slot="radio-group-item"
    v-bind="{ ...forwardedProps, ...soft.attrs() }"
    :disabled="soft.disabled()"
    :class="
      cn(
        'border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/10 aspect-square size-4 shrink-0 rounded-full border shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-(--disabled-opacity) aria-disabled:cursor-not-allowed aria-disabled:opacity-(--disabled-opacity)',
        props.class,
      )
    "
  >
    <!-- Stays mounted so the dot can spring in and leave (motion.css, .tavora-dot); a custom dot in the slot fades with it. -->
    <RadioGroupIndicator
      force-mount
      data-slot="radio-group-indicator"
      class="tavora-quiet-travel relative flex items-center justify-center transition-opacity duration-(--duration-pop-out) ease-(--ease-out-strong) data-[state=unchecked]:opacity-0"
    >
      <slot>
        <CircleIcon class="tavora-dot fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </slot>
    </RadioGroupIndicator>
  </RadioGroupItem>
</template>
