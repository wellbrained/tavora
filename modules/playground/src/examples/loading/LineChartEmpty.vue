<script setup lang="ts">
// Nothing to draw: `empty-title` (and `empty-description`) are shown instead of the chart. One point is kept as a dot.
import { LineChart } from "@tavora/official-ui/components/ui/line-chart";
import { computed } from "vue";
import { t } from "../../i18n";

const label = computed(() => t("demo.lineChart.ratingOver"));
const empty = computed(() => t("demo.lineChart.empty"));
const hint = computed(() => t("demo.lineChart.emptyHint"));
const none = computed(() => [{ label: t("demo.lineChart.rating"), points: [] }]);
const one = computed(() => [{ label: t("demo.lineChart.rating"), points: [{ x: new Date(2026, 10, 5, 20, 15).getTime(), y: 3091 }] }]);
</script>

<template>
  <div class="flex max-w-xl flex-col gap-4">
    <LineChart axis="date" :series="none" :height="160" :label="label" :empty-title="empty" :empty-description="hint" />
    <div class="flex flex-col gap-1.5">
      <span class="text-muted-foreground text-xs">{{ t("demo.lineChart.oneGame") }}</span>
      <LineChart axis="date" :series="one" :height="140" :label="label" />
    </div>
  </div>
</template>
