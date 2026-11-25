<script setup lang="ts">
import { Calendar, CalendarLegend, localToday, type CalendarMark } from "@tavora/official-ui/components/ui/calendar";
import { computed, ref } from "vue";

// An archive of daily puzzles: from the first one up to today, each day solved, missed or still being played.
const today = localToday();
const daysAgo = (n: number) => {
  const date = new Date();
  date.setDate(date.getDate() - n);
  return localToday(date.getTime());
};
const first = daysAgo(40);

const solved: CalendarMark = { tone: "success", label: "Solved" };
const missed: CalendarMark = { tone: "destructive", label: "Missed" };
const playing: CalendarMark = { tone: "warning", label: "Playing" };
const marks = computed<Record<string, CalendarMark>>(() => {
  const list: [number, CalendarMark][] = [[1, playing], [2, solved], [3, solved], [5, missed], [6, solved], [8, solved], [9, solved], [12, missed], [13, solved], [16, solved], [20, solved], [24, missed], [27, solved]];
  return Object.fromEntries(list.map(([n, mark]) => [daysAgo(n), mark]));
});

const opened = ref<string>();
</script>

<template>
  <div class="flex max-w-72 flex-col gap-2">
    <Calendar label="Earlier puzzles" :marks="marks" :min="first" :max="today" @pick="opened = $event" />
    <CalendarLegend :items="[solved, missed, playing]" />
    <span class="text-muted-foreground text-xs tabular-nums">{{ opened ? `Opens the puzzle of ${opened}` : "Pick a day to open it" }}</span>
  </div>
</template>
