<script setup lang="ts">
// A short note under a group of rows ("Counts gear and passives only."), across the whole table.
// `colspan` is the table's number of columns.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<{ colspan: number; class?: HTMLAttributes["class"] }>()
</script>

<template>
  <tr data-slot="table-note" class="border-0">
    <td :colspan="colspan" :class="cn('text-muted-foreground px-2 pt-1 pb-2 text-start text-xs', props.class)">
      <slot />
    </td>
  </tr>
</template>
