<script setup lang="ts">
// One control with its label, hint and error. Put one kit control inside: Input, Textarea, NumberField, Select,
// Combobox, Switch or Checkbox. The label names it (a click on the label reaches it), the hint and the error describe
// it, an error marks it invalid and is read out when it appears or changes (not when the field first shows).
// `orientation="horizontal"` puts the control beside the label, for a switch or a short field; when the row is too
// narrow the control moves under the label instead of squeezing it.
import type { HTMLAttributes } from "vue"
import { FieldDescription, FieldError, FieldLabel, FieldRoot } from "reka-ui"
import { computed } from "vue"
import { cn } from "../../../lib/utils"
import { Label } from "../label"

const props = withDefaults(defineProps<{
  /** Names the control. Leave it out only where something else names it (a settings row, an `aria-label`). */
  label?: string
  /** One short line under it. The `hint` slot takes richer content (two lines, a test id) instead. */
  hint?: string
  /** What is wrong, as one short sentence. While it is set, the control is invalid. */
  error?: string
  orientation?: "vertical" | "horizontal"
  class?: HTMLAttributes["class"]
}>(), { orientation: "vertical" })

const invalid = computed(() => !!props.error?.trim())
</script>

<template>
  <FieldRoot
    as="div"
    data-slot="field"
    :data-orientation="orientation"
    :invalid="invalid"
    :class="cn('flex flex-col', props.class)"
  >
    <template v-if="orientation === 'horizontal'">
      <!-- The row wraps the control under the text when it is too narrow. The space between them is a top margin on
           both, taken back by the row, so it is only there once they are on two lines. -->
      <div class="-mt-2 flex flex-wrap items-center gap-x-6">
        <div class="mt-2 flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
          <FieldLabel v-if="label" as-child><Label class="leading-5">{{ label }}</Label></FieldLabel>
          <FieldDescription v-if="hint || $slots.hint" data-slot="field-hint" class="text-muted-foreground text-xs"><slot name="hint">{{ hint }}</slot></FieldDescription>
        </div>
        <div class="mt-2 flex flex-none items-center" data-slot="field-control"><slot /></div>
      </div>
      <!-- Always there, so the error is read out when it appears; under the control, wrapped or not. -->
      <div aria-live="polite"><FieldError data-slot="field-error" class="text-destructive mt-1 text-xs">{{ error }}</FieldError></div>
    </template>
    <template v-else>
      <FieldLabel v-if="label" as-child><Label class="mb-1 leading-5">{{ label }}</Label></FieldLabel>
      <slot />
      <FieldDescription v-if="hint || $slots.hint" data-slot="field-hint" class="text-muted-foreground mt-1 text-xs"><slot name="hint">{{ hint }}</slot></FieldDescription>
      <div aria-live="polite"><FieldError data-slot="field-error" class="text-destructive mt-1 text-xs">{{ error }}</FieldError></div>
    </template>
  </FieldRoot>
</template>
