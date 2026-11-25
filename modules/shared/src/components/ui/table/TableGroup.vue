<script setup lang="ts">
// A heading row for the rows under it (Defence, Resistances), across the whole table. Put each group in its own
// `TableBody`. `colspan` is the table's number of columns.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<{ colspan: number; class?: HTMLAttributes["class"] }>()
</script>

<template>
  <tr data-slot="table-group" class="border-b">
    <th scope="colgroup" :colspan="colspan" :class="cn('text-muted-foreground px-2 pt-4 pb-1.5 text-start text-xs font-medium', props.class)">
      <slot />
    </th>
  </tr>
</template>
