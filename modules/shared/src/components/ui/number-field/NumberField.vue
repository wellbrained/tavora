<script setup lang="ts">
// A number with minus and plus buttons, for a count that is nudged more often than typed: a quantity, a
// number of copies. Arrow keys step, Page Up and Down step by ten, Home and End jump to the limits; a typed
// number is clamped to min and max when the field is left. A longer range, or one picked by feel, is a slider.
import { Minus, Plus } from "@lucide/vue"
import { NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput, NumberFieldRoot } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = withDefaults(defineProps<{
  min?: number
  max?: number
  step?: number
  /** Names the number for screen readers ("Quantity of Meat Wrap"). */
  label: string
  /** The buttons have no text; modules pass translated names. */
  decreaseLabel?: string
  increaseLabel?: string
  disabled?: boolean
  class?: HTMLAttributes["class"]
}>(), { step: 1, decreaseLabel: "Decrease", increaseLabel: "Increase" })
const model = defineModel<number>({ required: true })
</script>

<template>
  <NumberFieldRoot
    v-model="model"
    data-slot="number-field"
    :min="min"
    :max="max"
    :step="step"
    :disabled="disabled"
    :class="cn(
      'border-input dark:bg-input/10 focus-within:border-ring focus-within:ring-ring/50 inline-flex h-8 w-fit items-center overflow-hidden rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] focus-within:ring-3 data-[disabled]:opacity-50',
      props.class,
    )"
  >
    <NumberFieldDecrement
      data-slot="number-field-decrement"
      :aria-label="decreaseLabel"
      class="text-muted-foreground hover:text-foreground flex size-8 flex-none items-center justify-center outline-none hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] disabled:pointer-events-none disabled:opacity-50"
    >
      <Minus class="size-3.5" aria-hidden="true" />
    </NumberFieldDecrement>
    <NumberFieldInput
      data-slot="number-field-input"
      :aria-label="label"
      class="h-full w-12 min-w-0 bg-transparent text-center text-sm tabular-nums outline-none disabled:cursor-not-allowed"
    />
    <NumberFieldIncrement
      data-slot="number-field-increment"
      :aria-label="increaseLabel"
      class="text-muted-foreground hover:text-foreground flex size-8 flex-none items-center justify-center outline-none hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] disabled:pointer-events-none disabled:opacity-50"
    >
      <Plus class="size-3.5" aria-hidden="true" />
    </NumberFieldIncrement>
  </NumberFieldRoot>
</template>
