<script setup lang="ts">
import type { SwitchRootEmits, SwitchRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { SwitchRoot, SwitchThumb, useForwardPropsEmits } from "reka-ui"
import { ACTIVATE_KEYS, useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"

defineOptions({ inheritAttrs: false })
const props = defineProps<SwitchRootProps & {
  class?: HTMLAttributes["class"]
  /** Why it is off. While `disabled` the switch stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
}>()
const emits = defineEmits<SwitchRootEmits>()

const delegatedProps = reactiveOmit(props, "class", "disabledReason")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason }), { keys: ACTIVATE_KEYS })
</script>

<template>
  <SwitchRoot
    v-slot="slotProps"
    data-slot="switch"
    v-bind="{ ...forwarded, ...soft.attrs() }"
    :disabled="soft.disabled()"
    :class="cn(
      'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors outline-none focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
      props.class,
    )"
  >
    <SwitchThumb
      data-slot="switch-thumb"
      class="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full transition-transform duration-(--duration-press) ease-(--ease-out-strong) data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
    >
      <slot name="thumb" v-bind="slotProps" />
    </SwitchThumb>
  </SwitchRoot>
</template>
