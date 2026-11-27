<script setup lang="ts">
// An amount on a known scale: what is left of an allowance, how full a drive is, a share of all ratings. It looks
// like Progress, but tells screen readers it is a measurement (role="meter"), not work under way, and its colour can
// change at limits. Show the number beside it too: the colour alone says nothing to some people. It jumps to a new
// value without motion, since an amount is often on screen all day.
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import type { MeterTone } from "."
import { cn } from "../../../lib/utils"
import { uiLocale } from "../text"

const props = withDefaults(
  defineProps<{
    modelValue?: number
    min?: number
    max?: number
    /** The colour while no limit is reached. */
    tone?: MeterTone
    /** Limits for an amount that runs low: this colour at this value and under. */
    warningUpTo?: number
    destructiveUpTo?: number
    /** Limits for an amount that fills up: this colour at this value and over. */
    warningFrom?: number
    destructiveFrom?: number
    /** What screen readers say for the value ("40 % left"). Without it: how full the bar is, as a percentage. */
    valueText?: string
    /** `sm` 4 px, `default` 6 px (as Progress), `lg` 8 px. */
    size?: "sm" | "default" | "lg"
    class?: HTMLAttributes["class"]
  }>(),
  { modelValue: 0, min: 0, max: 100, tone: "primary", size: "default" },
)

const HEIGHT = { sm: "h-1", default: "h-1.5", lg: "h-2" } as const
const FILL = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive", muted: "bg-muted-foreground" } as const

const max = computed(() => (props.max > props.min ? props.max : props.min + 100))

/** The value kept on the scale; anything that isn't a number counts as the lowest. */
const value = computed(() => (Number.isFinite(props.modelValue) ? Math.min(max.value, Math.max(props.min, props.modelValue)) : props.min))

/** How full the bar is, 0 to 100. */
const filled = computed(() => ((value.value - props.min) / (max.value - props.min)) * 100)

/** The colour for the value: a destructive limit counts before a warning one, and both before `tone`. */
const shownTone = computed<MeterTone>(() => {
  const reached = (upTo: number | undefined, from: number | undefined) =>
    (upTo !== undefined && value.value <= upTo) || (from !== undefined && value.value >= from)
  if (reached(props.destructiveUpTo, props.destructiveFrom)) return "destructive"
  if (reached(props.warningUpTo, props.warningFrom)) return "warning"
  return props.tone
})

const spoken = computed(() => props.valueText ?? new Intl.NumberFormat(uiLocale.value, { style: "percent", maximumFractionDigits: 0 }).format(filled.value / 100))
</script>

<template>
  <div
    data-slot="meter"
    role="meter"
    :aria-valuemin="props.min"
    :aria-valuemax="max"
    :aria-valuenow="value"
    :aria-valuetext="spoken"
    :data-tone="shownTone"
    :class="cn('bg-secondary relative w-full overflow-hidden rounded-full', HEIGHT[props.size], props.class)"
  >
    <div
      data-slot="meter-indicator"
      :class="cn('h-full w-full flex-1', FILL[shownTone])"
      :style="`transform: translateX(-${100 - filled}%);`"
    />
  </div>
</template>
