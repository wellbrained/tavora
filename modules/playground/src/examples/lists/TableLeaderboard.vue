<script setup lang="ts">
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type TableSort } from "@tavora/official-ui/components/ui/table";
import { computed, ref } from "vue";
import { t } from "../../i18n";

const players = [
  { name: "Mira", time: 252, wins: 14 },
  { name: "Jonas", time: 278, wins: 9 },
  { name: "Lea", time: 347, wins: 21 },
  { name: "Tomás", time: 301, wins: 6 },
  { name: "Ayla", time: 389, wins: 11 },
  { name: "Ben", time: 412, wins: 3 },
  { name: "Noor", time: 268, wins: 17 },
  { name: "Kai", time: 455, wins: 8 },
];
const you = "Lea";
const sort = ref<TableSort | null>({ column: "time", direction: "ascending" });

// The table shows and reports the sort; the rows are sorted here.
const rows = computed(() => {
  const { column, direction } = sort.value ?? { column: "time", direction: "ascending" };
  const sign = direction === "ascending" ? 1 : -1;
  const key = column as "name" | "time" | "wins";
  return [...players].sort((a, b) => sign * (key === "name" ? a.name.localeCompare(b.name) : a[key] - b[key]));
});
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
</script>

<template>
  <Table v-model:sort="sort" density="compact" layout="fixed" sticky-header container-class="max-h-56 max-w-md">
    <TableHeader>
      <TableRow>
        <TableHead class="w-10">#</TableHead>
        <TableHead sort-key="name">{{ t("demo.table.name") }}</TableHead>
        <TableHead sort-key="time" align="end" numeric class="w-24">{{ t("demo.table.time") }}</TableHead>
        <TableHead sort-key="wins" sort-first="descending" align="end" numeric class="w-24">{{ t("demo.table.wins") }}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="(row, i) in rows" :key="row.name" :current="row.name === you">
        <TableCell numeric>{{ i + 1 }}</TableCell>
        <TableCell class="truncate">
          {{ row.name }}<span v-if="row.name === you" class="text-muted-foreground font-normal"> ({{ t("demo.table.you") }})</span>
        </TableCell>
        <TableCell align="end" numeric>{{ clock(row.time) }}</TableCell>
        <TableCell align="end" numeric>{{ row.wins }}</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
