<script setup lang="ts">
// One line over dates. `x` is `Date.getTime()`; the axis picks hours, days, months or years to fit its width, in the
// language shown. Without `y-min` and `y-max` the value axis fits the values.
import { LineChart } from "@tavora/official-ui/components/ui/line-chart";
import { computed } from "vue";
import { t } from "../../i18n";

const label = computed(() => t("demo.lineChart.ratingOver"));
const start = new Date(2026, 8, 20, 19, 30).getTime();
const day = 24 * 3_600_000;
const series = computed(() => [
  {
    label: t("demo.lineChart.rating"),
    points: Array.from({ length: 28 }, (_, i) => ({
      x: start + i * 1.5 * day + (i % 3) * 2_400_000,
      y: Math.round(3040 + 55 * Math.sin(i / 3) + i * 4 + (i % 4) * 6),
    })),
  },
]);
</script>

<template>
  <LineChart axis="date" :series="series" :label="label" class="max-w-xl" />
</template>
