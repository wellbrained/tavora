<script setup lang="ts">
// A number with minus and plus buttons, for a count that is nudged more often than typed: a quantity, a
// number of copies. Arrow keys step, Page Up and Down step by ten, Home and End jump to the limits; a typed
// number is clamped to min and max when the field is left. A longer range, or one picked by feel, is a slider.
import { Minus, Plus } from "@lucide/vue"
import { NumberFieldDecrement, NumberFieldIncrement, NumberFieldInput, NumberFieldRoot } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { ref, useAttrs } from "vue"
import { cn } from "../../../lib/utils"
import { useFieldControl } from "../field/use-field-control"
import { uiLocale, uiText } from "../text"

defineOptions({ inheritAttrs: false })
const props = withDefaults(defineProps<{
  min?: number
  max?: number
  step?: number
  /** How the number is shown and read, such as `{ style: "percent" }`. It is typed and read in Tavora's language. */
  formatOptions?: Intl.NumberFormatOptions
  /** Names the number for screen readers ("Quantity of Meat Wrap"). Inside a Field with a label, leave it out. */
  label?: string
  /** The buttons have no text; modules pass translated names. */
  decreaseLabel?: string
  increaseLabel?: string
  disabled?: boolean
  class?: HTMLAttributes["class"]
}>(), { step: 1 })
const model = defineModel<number>({ required: true })
const input = ref<{ $el?: HTMLElement } | null>(null)
const field = useFieldControl({ element: () => input.value?.$el, value: () => model.value })
// What names, describes or marks the number goes on the box you type in; everything else on the frame around it.
const ARIA = new Set(["aria-label", "aria-labelledby", "aria-describedby", "aria-invalid"])
const attrs = useAttrs()
function split() {
  const frame: Record<string, unknown> = {}
  const input: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(attrs)) (ARIA.has(name) ? input : frame)[name] = value
  return { frame, input: { ...input, ...field.attrs() } }
}
</script>

<template>
  <NumberFieldRoot
    v-model="model"
    v-bind="split().frame"
    data-slot="number-field"
    :id="field.id() ?? (attrs.id as string | undefined)"
    :min="min"
    :max="max"
    :step="step"
    :locale="uiLocale"
    :format-options="formatOptions"
    :disabled="disabled"
    :class="cn(
      'border-input dark:bg-input/10 focus-within:border-ring focus-within:ring-ring/50 inline-flex h-[var(--style-control-height,32px)] w-fit items-center overflow-hidden rounded-md border bg-transparent shadow-xs transition-[color,box-shadow] focus-within:ring-3 data-[disabled]:opacity-50',
      props.class,
    )"
  >
    <NumberFieldDecrement
      data-slot="number-field-decrement"
      :aria-label="decreaseLabel ?? uiText.decrease"
      class="text-muted-foreground hover:text-foreground flex size-[var(--style-control-height,32px)] flex-none items-center justify-center outline-none hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] disabled:pointer-events-none disabled:opacity-50"
    >
      <Minus class="size-3.5" aria-hidden="true" />
    </NumberFieldDecrement>
    <NumberFieldInput
      ref="input"
      data-slot="number-field-input"
      :aria-label="label"
      v-bind="split().input"
      class="h-full w-12 min-w-0 bg-transparent text-center text-sm tabular-nums outline-none disabled:cursor-not-allowed"
    />
    <NumberFieldIncrement
      data-slot="number-field-increment"
      :aria-label="increaseLabel ?? uiText.increase"
      class="text-muted-foreground hover:text-foreground flex size-[var(--style-control-height,32px)] flex-none items-center justify-center outline-none hover:bg-[color-mix(in_srgb,var(--foreground)_10%,var(--accent))] disabled:pointer-events-none disabled:opacity-50"
    >
      <Plus class="size-3.5" aria-hidden="true" />
    </NumberFieldIncrement>
  </NumberFieldRoot>
</template>
