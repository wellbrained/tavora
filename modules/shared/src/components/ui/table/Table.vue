<script setup lang="ts">
// A data table: rows of facts that share columns. Header, body, rows, heads and cells go inside it.
// `class` styles the table itself (column widths); a table wider than its panel scrolls sideways.
// Options, all off by default so a plain table looks as it always did:
// - `density="compact"`: lower heads and cells, for small tables in cards and leaderboards.
// - `layout="fixed"`: columns take the widths you give them, not the widths of their content.
// - `sticky-header`: the header stays put while the rows scroll. Give the table a height with `container-class`
//   (`max-h-80`), since the header sticks inside the table's own scroll box.
// - `flush`: no space at the table's outer edges, so cell text lines up with the headings around the table.
// - `v-model:sort`: which column is sorted, shown on heads with a `sort-key`. The table never re-orders rows itself.
import { provide, type HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { tableContextKey, type TableDensity, type TableSort } from "./context"

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"]
    containerClass?: HTMLAttributes["class"]
    density?: TableDensity
    layout?: "auto" | "fixed"
    stickyHeader?: boolean
    flush?: boolean
  }>(),
  { density: "default", layout: "auto", stickyHeader: false, flush: false },
)
const sort = defineModel<TableSort | null>("sort")

provide(tableContextKey, {
  density: () => props.density,
  stickyHeader: () => props.stickyHeader,
  sort: () => sort.value,
  setSort: (next) => (sort.value = next),
})
</script>

<template>
  <div data-slot="table-container" :class="cn('relative w-full overflow-x-auto', props.containerClass)">
    <table data-slot="table" :data-density="density === 'default' ? undefined : density" :class="cn('w-full caption-bottom text-sm', layout === 'fixed' && 'table-fixed', flush && '[&_:is(th,td):first-child]:ps-0 [&_:is(th,td):last-child]:pe-0 [&_tr[data-marked]>:first-child]:ps-2', props.class)">
      <slot />
    </table>
  </div>
</template>
