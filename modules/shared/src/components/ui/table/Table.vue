<script setup lang="ts">
// A data table: rows of facts that share columns. Header, body, rows, heads and cells go inside it.
// `class` styles the table itself (column widths, fixed layout); a table wider than its panel scrolls sideways.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <div data-slot="table-container" class="relative w-full overflow-x-auto">
    <table data-slot="table" :class="cn('w-full caption-bottom text-sm', props.class)">
      <slot />
    </table>
  </div>
</template>
