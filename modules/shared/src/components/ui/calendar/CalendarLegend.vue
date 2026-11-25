<script setup lang="ts">
// What a Calendar's marks mean: a small swatch in each tone and its words, placed wherever the module wants it.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import type { CalendarMark } from "./days"

defineProps<{ items: CalendarMark[]; class?: HTMLAttributes["class"] }>()

const SWATCH: Record<CalendarMark["tone"], string> = {
  success: "bg-success",
  destructive: "bg-destructive",
  warning: "bg-warning",
  info: "bg-info",
  muted: "bg-muted-foreground/40",
}
</script>

<template>
  <ul data-slot="calendar-legend" :class="cn('text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs', $props.class)">
    <li v-for="item in items" :key="`${item.tone}-${item.label}`" class="flex items-center gap-1.5">
      <span :class="cn('size-2.5 rounded-[2px]', SWATCH[item.tone])" aria-hidden="true" />{{ item.label }}
    </li>
  </ul>
</template>
