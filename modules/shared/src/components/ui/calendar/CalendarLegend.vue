<script setup lang="ts">
// What a Calendar's marks mean: a small swatch in each tone and its words, placed wherever the module wants it.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { TONE_CLASSES, type CalendarMark } from "./days"

defineProps<{ items: CalendarMark[]; class?: HTMLAttributes["class"] }>()
</script>

<template>
  <ul data-slot="calendar-legend" :class="cn('text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs', $props.class)">
    <li v-for="item in items" :key="`${item.tone}-${item.label}`" class="flex items-center gap-1.5">
      <span :class="cn('size-2.5 rounded-sm', TONE_CLASSES[item.tone].swatch)" aria-hidden="true" />{{ item.label }}
    </li>
  </ul>
</template>
