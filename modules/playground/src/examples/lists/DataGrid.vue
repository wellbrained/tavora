<script setup lang="ts">
// A grid you can type into. The grid only reports what you did (commit, clear, fill, resize); the page keeps the cells
// and gives them back through `text`. Try typing, F2, Delete, Ctrl+D, the fill handle, and dragging a header's edge.
import { DataGrid, type CellPos, type FillPlan, type GridRange } from "@tavora/official-ui/components/ui/data-grid";
import { reactive } from "vue";

const cells = reactive(new Map<string, string>([
  ["0:0", "Item"], ["0:1", "Need"], ["0:2", "Have"],
  ["1:0", "Iron ore"], ["1:1", "40"], ["1:2", "12"],
  ["2:0", "Copper"], ["2:1", "25"], ["2:2", "25"],
]));
const widths = reactive<Record<number, number>>({ 0: 140 });
const key = (row: number, col: number) => `${row}:${col}`;

function commit(pos: CellPos, text: string) {
  if (text === "") cells.delete(key(pos.row, pos.col));
  else cells.set(key(pos.row, pos.col), text);
}

function clear(range: GridRange) {
  for (let row = range.top; row <= range.bottom; row++) for (let col = range.left; col <= range.right; col++) cells.delete(key(row, col));
}

// Copies the source over the target, repeating it.
function fill({ source, target }: FillPlan) {
  const height = source.bottom - source.top + 1;
  const width = source.right - source.left + 1;
  for (let row = target.top; row <= target.bottom; row++) {
    for (let col = target.left; col <= target.right; col++) {
      const from = cells.get(key(source.top + ((row - source.top) % height + height) % height, source.left + ((col - source.left) % width + width) % width));
      if (from === undefined) cells.delete(key(row, col));
      else cells.set(key(row, col), from);
    }
  }
}
</script>

<template>
  <DataGrid
    class="h-64 border border-border"
    :rows="50"
    :cols="8"
    :frozen-rows="1"
    :column-widths="widths"
    :text="(row, col) => cells.get(key(row, col)) ?? ''"
    :cell-class="(row) => (row === 0 ? 'font-medium' : undefined)"
    @commit="commit"
    @clear="clear"
    @fill="fill"
    @resize-column="(col, width) => (widths[col] = width)"
  />
</template>
