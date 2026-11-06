<script setup lang="ts">
// Two lines over game time. `x` is seconds (the axis writes m:ss); the value axis starts at 0 because workers can't go
// below it. Hover a point or press the arrow keys, Home and End to read the values.
import { LineChart } from "@tavora/official-ui/components/ui/line-chart";
import { computed } from "vue";
import { t } from "../../i18n";

const label = computed(() => t("demo.lineChart.workersOver"));
const times = Array.from({ length: 37 }, (_, i) => i * 20);
const series = computed(() => [
  { label: t("demo.lineChart.you"), points: times.map((x) => ({ x, y: Math.round(12 + 54 * (1 - Math.exp(-x / 240))) })) },
  { label: t("demo.lineChart.opponent"), points: times.map((x) => ({ x, y: Math.round(12 + 44 * (1 - Math.exp(-x / 200)) - (x > 480 ? (x - 480) / 24 : 0)) })) },
]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <LineChart :series="series" :y-min="0" :label="label" class="max-w-xl" />
    <div class="flex flex-col gap-1.5">
      <span class="text-muted-foreground text-xs">{{ t("demo.lineChart.narrow") }}</span>
      <LineChart :series="series" :y-min="0" :height="140" :label="label" class="w-56" />
    </div>
  </div>
</template>
