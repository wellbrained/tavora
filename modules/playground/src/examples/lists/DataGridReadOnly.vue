<script setup lang="ts">
// 5,000 rows to look through, select and copy, but not change. Only the rows in view are drawn. The first row and
// column stay put while the rest scrolls.
import { DataGrid } from "@tavora/official-ui/components/ui/data-grid";

const HEADERS = ["Run", "Boss", "Drops", "Minutes"];
const BOSSES = ["Warden", "Hollow King", "Ash Drake", "Mire Witch"];
const text = (row: number, col: number) => {
  if (row === 0) return HEADERS[col] ?? "";
  if (col === 0) return `#${row}`;
  if (col === 1) return BOSSES[row % BOSSES.length]!;
  if (col === 2) return String((row * 7) % 5);
  return String(3 + ((row * 13) % 9));
};
</script>

<template>
  <DataGrid
    readonly
    class="h-64 border border-border"
    :rows="5001"
    :cols="4"
    :frozen-rows="1"
    :frozen-cols="1"
    :text="text"
    :cell-class="(row, col) => [row === 0 && 'font-medium', col >= 2 && 'justify-end']"
  />
</template>
