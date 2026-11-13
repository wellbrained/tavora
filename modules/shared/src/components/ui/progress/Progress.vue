<script setup lang="ts">
import type { ProgressRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { ProgressIndicator, ProgressRoot } from "reka-ui"
import { computed } from "vue"
import { cn } from "../../../lib/utils"
import { uiLocale } from "../text"

const props = withDefaults(
  defineProps<ProgressRootProps & { class?: HTMLAttributes["class"] }>(),
  {
    modelValue: 0,
    max: 100,
  },
)

const delegatedProps = reactiveOmit(props, "class")

const max = computed(() => (props.max > 0 ? props.max : 100))

/** The value kept between 0 and max, so screen readers never hear "150 %"; null (amount not known) stays null. */
const value = computed(() => (props.modelValue == null ? props.modelValue : Math.min(max.value, Math.max(0, props.modelValue))))

/** How full the bar is, 0 to 100, whatever `max` is. */
const filled = computed(() => ((value.value ?? 0) / max.value) * 100)

/** Screen readers hear "40 %" in the user's language, not the raw value. Callers may still pass their own. */
const valueText = (value: number | null | undefined, max: number) =>
  value == null ? undefined : new Intl.NumberFormat(uiLocale.value, { style: "percent", maximumFractionDigits: 0 }).format(value / (max > 0 ? max : 100))
</script>

<template>
  <ProgressRoot
    data-slot="progress"
    v-bind="delegatedProps"
    :model-value="value"
    :max="max"
    :get-value-text="props.getValueText ?? valueText"
    :class="cn('bg-secondary relative h-1.5 w-full overflow-hidden rounded-full', props.class)"
  >
    <ProgressIndicator
      data-slot="progress-indicator"
      class="bg-primary h-full w-full flex-1 transition-transform"
      :style="`transform: translateX(-${100 - filled}%);`"
    />
  </ProgressRoot>
</template>
