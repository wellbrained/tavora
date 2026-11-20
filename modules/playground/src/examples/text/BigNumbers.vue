<script setup lang="ts">
// A big number a panel is about (a clock, a counter, a reading) gets tavora-numerals, so a style can draw it its own
// way: a dot-matrix face in Nothing, thin in Rabbit. Pick a style above to see it.
const VALUES = [
  { value: "21:47", label: "Clock" },
  { value: "42%", label: "CPU" },
  { value: "1 280", label: "Counter" },
];
</script>

<template>
  <div class="flex flex-wrap gap-x-10 gap-y-4">
    <div v-for="item in VALUES" :key="item.label" class="flex flex-col gap-1">
      <span class="text-muted-foreground text-xs">{{ item.label }}</span>
      <span class="text-[2.125rem] leading-none font-semibold tabular-nums tavora-numerals">{{ item.value }}</span>
    </div>
  </div>
</template>
