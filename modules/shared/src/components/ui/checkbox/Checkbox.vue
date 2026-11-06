<script setup lang="ts">
import type { CheckboxRootEmits, CheckboxRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Minus } from "@lucide/vue"
import { reactiveOmit } from "@vueuse/core"
import { CheckboxIndicator, CheckboxRoot, useForwardPropsEmits } from "reka-ui"
import { ref } from "vue"
import { ACTIVATE_KEYS, useAriaDisabled, useSoftDisabled } from "../../../lib/soft-disabled"
import { cn } from "../../../lib/utils"

// Ticking plays a short motion (motion.css, .tavora-check): the box dips, the fill grows from the middle and the tick
// draws itself. The indicator stays mounted so the tick can draw and undraw; the box looks the same at rest. The
// dip waits for the first change, so a box that is ticked when it appears does not play. A tick by Space is a choice
// like a click and plays the same.
defineOptions({ inheritAttrs: false })
const props = defineProps<CheckboxRootProps & {
  class?: HTMLAttributes["class"]
  /** Why it is off. While `disabled` the box stays hoverable and focusable, and the reason shows in a tooltip beside it. */
  disabledReason?: string
}>()
const emits = defineEmits<CheckboxRootEmits>()

const delegatedProps = reactiveOmit(props, "class", "disabledReason")

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const changed = ref(false)
const soft = useSoftDisabled(() => ({ disabled: props.disabled, reason: props.disabledReason }), { keys: ACTIVATE_KEYS })
// Reka writes `aria-disabled` itself (and would blank ours), so it is set on the box's element.
const box = ref<{ $el?: unknown } | null>(null)
useAriaDisabled(() => box.value, soft.soft)
</script>

<template>
  <CheckboxRoot
    ref="box"
    v-slot="slotProps"
    data-slot="checkbox"
    v-bind="{ ...forwarded, ...soft.attrs() }"
    :disabled="soft.disabled()"
    :data-armed="changed ? '' : undefined"
    :class="cn(
      'tavora-check peer border-input data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary data-[state=indeterminate]:text-primary-foreground data-[state=indeterminate]:border-primary aria-invalid:border-destructive size-4 shrink-0 rounded-sm border transition-colors duration-(--duration-press) ease-(--ease-out-strong) outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
      props.class,
    )"
    @update:model-value="changed = true"
  >
    <CheckboxIndicator force-mount data-slot="checkbox-indicator" class="tavora-check-mark grid place-content-center text-current">
      <slot v-bind="slotProps">
        <Minus v-if="slotProps.state === 'indeterminate'" class="size-3.5" :stroke-width="2.5" />
        <!-- Lucide's Check, with its path measured as 1 so the tick can draw itself -->
        <svg v-else class="tavora-tick size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" pathLength="1" />
        </svg>
      </slot>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
