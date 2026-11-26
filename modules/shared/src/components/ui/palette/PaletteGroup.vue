<script setup lang="ts">
// A part of a palette's list under its heading ("Workspaces", "On this PC"), set off from the part above by a line.
// Without a `label` it is a part with no heading (still under a line). The heading names the group for screen readers.
import { useId, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<{
  label?: string
  class?: HTMLAttributes["class"]
}>()
defineSlots<{ default?: () => unknown, label?: () => unknown }>()
const headingId = useId()
</script>

<template>
  <div
    :role="label || $slots.label ? 'group' : undefined"
    :aria-labelledby="label || $slots.label ? headingId : undefined"
    data-slot="palette-group"
    :class="cn('flex flex-col not-first:mt-1 not-first:border-t not-first:pt-1', props.class)"
  >
    <div v-if="label || $slots.label" :id="headingId" role="presentation" data-slot="palette-group-label" class="text-muted-foreground flex h-7 flex-none items-center gap-2 px-3 text-xs font-medium">
      <slot name="label">{{ label }}</slot>
    </div>
    <slot />
  </div>
</template>
