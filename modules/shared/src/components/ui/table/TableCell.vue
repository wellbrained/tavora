<script setup lang="ts">
// One cell. `align="end"` puts its content at the end of the line (right, or left in right-to-left text) and
// `numeric` gives it figures of one width, so numbers line up; set both on the column's head too.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { useTableContext } from "./context"

const props = defineProps<{ class?: HTMLAttributes["class"]; align?: "start" | "end"; numeric?: boolean }>()
const table = useTableContext()
</script>

<template>
  <td
    data-slot="table-cell"
    :data-numeric="numeric || undefined"
    :class="cn(table.density() === 'compact' ? 'px-2 py-1' : 'p-2', 'align-middle', align === 'end' && 'text-end', align === 'start' && 'text-start', numeric && 'tabular-nums', props.class)"
  >
    <slot />
  </td>
</template>
