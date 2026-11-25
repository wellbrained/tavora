<script setup lang="ts">
// Games by the guess they were won on; the highlighted bar is this game's. Hover a bar, or Tab to the chart and use the
// arrow keys, to read its count and share.
import { BarChart, type BarChartBar } from "@tavora/official-ui/components/ui/bar-chart";
import { computed } from "vue";
import { t } from "../../i18n";

const counts = [2, 9, 24, 31, 14, 0];
const bars = computed<BarChartBar[]>(() =>
  counts.map((value, index) => ({ label: String(index + 1), title: index === 0 ? t("demo.stats.guesses.one", { count: 1 }) : t("demo.stats.guesses.other", { count: index + 1 }), value, highlight: index === 2 })),
);
const text = computed(() => ({ byGuesses: t("demo.stats.byGuesses"), games: t("demo.stats.games") }));
</script>

<template>
  <BarChart :bars="bars" :label="text.byGuesses" :value-label="text.games" show-share class="max-w-sm" />
</template>
