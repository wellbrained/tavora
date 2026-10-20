<script setup lang="ts">
// Picks an even grid of empty slots by pointing at its bottom-right cell,
// like a table picker: up to GRID_LIMITS columns by rows.
import { computed, ref, type Component } from "vue";
import { DropdownMenuItem } from "@tavora/official-ui/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { GRID_LIMITS } from "../../../shared/layout-templates";
import { act } from "../../host";
import { gridLabel, t } from "../../i18n";

// In a menu the cells are menu items. On the empty workspace there is no menu, so they are plain buttons.
const props = defineProps<{ plain?: boolean }>();
const Cell = computed<Component | string>(() => (props.plain ? "button" : DropdownMenuItem));

const size = ref<{ columns: number; rows: number } | null>(null);
const cells = computed(() =>
  Array.from({ length: GRID_LIMITS.rows }, (_, row) =>
    Array.from({ length: GRID_LIMITS.columns }, (_, column) => ({ columns: column + 1, rows: row + 1 })),
  ).flat(),
);

function inside(cell: { columns: number; rows: number }) {
  return !!size.value && cell.columns <= size.value.columns && cell.rows <= size.value.rows;
}

/** Runs after the menu has closed, like the other menu entries. */
function apply(columns: number, rows: number) {
  if (props.plain) void act({ type: "apply-layout-grid", columns, rows });
  else setTimeout(() => void act({ type: "apply-layout-grid", columns, rows }), 0);
}
</script>

<template>
  <div class="flex flex-col items-center gap-2 px-2 pb-2" @pointerleave="size = null">
    <div class="grid gap-1" :style="{ gridTemplateColumns: `repeat(${GRID_LIMITS.columns}, auto)` }" role="group" :aria-label="t('layouts.grid')">
      <component
        :is="Cell"
        v-for="cell in cells"
        :key="`${cell.columns}x${cell.rows}`"
        :class="
          cn(
            'h-7 w-10 rounded-sm border p-0 focus:bg-transparent',
            plain && 'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
            inside(cell) ? 'border-primary bg-primary/25 focus:bg-primary/25' : 'bg-card',
          )
        "
        :aria-label="gridLabel(cell.columns, cell.rows)"
        :data-testid="`layout-grid-${cell.columns}x${cell.rows}`"
        @focus="size = cell"
        @pointerenter="size = cell"
        v-bind="plain ? { type: 'button' } : {}"
        @click="plain && apply(cell.columns, cell.rows)"
        @select="apply(cell.columns, cell.rows)"
      />
    </div>
    <span class="text-muted-foreground text-xs tabular-nums" aria-hidden="true" data-testid="layout-grid-size">{{
      size ? `${size.columns} × ${size.rows}` : t("layouts.gridPoint")
    }}</span>
  </div>
</template>
