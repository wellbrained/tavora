<script setup lang="ts">
// One kit control with its label, hint and error, tied together for screen readers. The error is read out when it
// appears or changes. `orientation="horizontal"` puts a short control beside the label; it moves under the label
// when the row is too narrow, so neither is squeezed. A switch with its label stays a SwitchField.
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
          <FieldLabel v-if="label" as-child><Label class="leading-5 wrap-anywhere">{{ label }}</Label></FieldLabel>
          <FieldDescription v-if="hint || $slots.hint" data-slot="field-hint" class="text-muted-foreground text-xs wrap-anywhere"><slot name="hint">{{ hint }}</slot></FieldDescription>
        </div>
        <div class="mt-2 flex flex-none items-center" data-slot="field-control"><slot /></div>
      </div>
      <!-- Always there, so the error is read out when it appears; under the control, wrapped or not. -->
      <div aria-live="polite"><FieldError data-slot="field-error" class="text-destructive mt-1 text-xs wrap-anywhere">{{ error }}</FieldError></div>
    </template>
    <template v-else>
      <FieldLabel v-if="label" as-child><Label class="mb-1 leading-5 wrap-anywhere">{{ label }}</Label></FieldLabel>
      <slot />
      <FieldDescription v-if="hint || $slots.hint" data-slot="field-hint" class="text-muted-foreground mt-1 text-xs wrap-anywhere"><slot name="hint">{{ hint }}</slot></FieldDescription>
      <div aria-live="polite"><FieldError data-slot="field-error" class="text-destructive mt-1 text-xs wrap-anywhere">{{ error }}</FieldError></div>
    </template>
  </FieldRoot>
</template>
