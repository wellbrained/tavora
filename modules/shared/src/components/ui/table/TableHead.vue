<script setup lang="ts">
// A column's (or a row's, with `scope="row"`) heading. `align` and `numeric` match the column's cells.
// With `sort-key` the heading becomes a button that sorts by this column through the table's `v-model:sort`:
// the first press sorts `sort-first` (ascending unless you say descending, for scores), the next flips it.
// The sorted column shows its arrow; the others show a faint one on hover and focus.
import { computed, type HTMLAttributes } from "vue"
import { ArrowDown, ArrowUp, ArrowUpDown } from "@lucide/vue"
import { cn } from "../../../lib/utils"
import { nextSort, useTableContext, type TableSortDirection } from "./context"

const props = withDefaults(
  defineProps<{ class?: HTMLAttributes["class"]; scope?: "col" | "row"; align?: "start" | "end"; numeric?: boolean; sortKey?: string; sortFirst?: TableSortDirection }>(),
  { scope: "col", sortFirst: "ascending" },
)
const table = useTableContext()

const direction = computed(() => {
  const sort = table.sort()
  return props.sortKey && sort?.column === props.sortKey ? sort.direction : undefined
})
const press = () => props.sortKey && table.setSort(nextSort(table.sort(), props.sortKey, props.sortFirst))
</script>

<template>
  <th
    data-slot="table-head"
    :scope="scope"
    :aria-sort="direction"
    :data-numeric="numeric || undefined"
    :class="
      cn(
        'text-muted-foreground px-2 text-left align-middle text-xs font-medium',
        table.density() === 'compact' ? 'h-7' : 'h-9',
        align === 'end' && 'text-end',
        align === 'start' && 'text-start',
        numeric && 'tabular-nums',
        props.class,
      )
    "
  >
    <button
      v-if="sortKey"
      type="button"
      data-slot="table-sort"
      :class="cn('group/sort hover:text-foreground focus-visible:ring-ring/50 -mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 outline-none focus-visible:ring-[3px]', direction && 'text-foreground')"
      @click="press"
    >
      <slot />
      <ArrowUp v-if="direction === 'ascending'" class="size-3 shrink-0" aria-hidden="true" />
      <ArrowDown v-else-if="direction === 'descending'" class="size-3 shrink-0" aria-hidden="true" />
      <ArrowUpDown v-else class="size-3 shrink-0 opacity-0 transition-opacity group-hover/sort:opacity-55 group-focus-visible/sort:opacity-55" aria-hidden="true" />
    </button>
    <slot v-else />
  </th>
</template>
