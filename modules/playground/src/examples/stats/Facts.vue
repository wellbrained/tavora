<script setup lang="ts">
// The same rows a tooltip shows with TooltipRows: numbers lined up on the right, each unit in its own column.
import { FactList, type FactRow } from "@tavora/official-ui/components/ui/fact-list";
import { computed } from "vue";
import { locale, t } from "../../i18n";

const rows = computed<FactRow[]>(() => [
  { label: t("demo.stats.power"), value: (1240).toLocaleString(locale()), unit: "MW" },
  { label: t("demo.stats.belt"), value: "780", unit: "/min", trend: "better" },
  { label: t("demo.stats.machines"), value: "12" },
  { label: t("demo.stats.clock"), value: "85", unit: "%", trend: "worse" },
]);
</script>

<template>
  <FactList :rows="rows" class="max-w-xs" />
</template>
