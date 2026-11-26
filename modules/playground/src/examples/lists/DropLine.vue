<script setup lang="ts">
// The drop line where a dragged row would land, in a list with gaps and in one without.
import { dropLine } from "@tavora/official-ui/components/ui/reorder";

const place = { id: "counter", after: false };
const rows = [
  { id: "countdown", title: "Countdown" },
  { id: "stopwatch", title: "Stopwatch" },
  { id: "counter", title: "Counter" },
];
</script>

<template>
  <div class="flex flex-wrap items-start gap-6">
    <div class="flex w-56 flex-col gap-2 [--tavora-drop-gap:--spacing(2)]" data-testid="drop-line-gap">
      <div v-for="row in rows" :key="row.id" class="bg-card rounded-lg border px-3 py-2" :class="dropLine(place, row.id)">{{ row.title }}</div>
    </div>
    <ul role="list" class="w-56" data-testid="drop-line-flush">
      <li v-for="row in rows" :key="row.id" class="px-3 py-2" :class="dropLine(place, row.id)">{{ row.title }}</li>
    </ul>
  </div>
</template>
