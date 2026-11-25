<script setup lang="ts">
// Play time per day in hours, standing on a value axis; today is highlighted. `format` adds the unit.
import { BarChart, type BarChartBar } from "@tavora/official-ui/components/ui/bar-chart";
import { computed } from "vue";
import { locale, t } from "../../i18n";

const hours = [0.7, 1.6, 0.5, 2.5, 1.2, 3.5, 0];
// 2026-11-23 was a Monday.
const day = (index: number, weekday: "short" | "long") => new Date(2026, 10, 23 + index).toLocaleDateString(locale(), { weekday });
const bars = computed<BarChartBar[]>(() => hours.map((value, index) => ({ label: day(index, "short"), title: day(index, "long"), value, highlight: index === 3 })));
const inHours = (value: number) => `${value.toLocaleString(locale())} h`;
const text = computed(() => ({ playTime: t("demo.stats.playTime"), time: t("demo.stats.time") }));
</script>

<template>
  <BarChart :bars="bars" orientation="vertical" :label="text.playTime" :value-label="text.time" :format="inHours" class="max-w-md" />
</template>
