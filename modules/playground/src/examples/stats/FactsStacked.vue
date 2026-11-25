<script setup lang="ts">
// `stacked` puts the label over the value, in as many columns as fit; `align="start"` puts a value right after its label.
import { FactList, type FactRow } from "@tavora/official-ui/components/ui/fact-list";
import { computed } from "vue";
import { t } from "../../i18n";

const rows = computed<FactRow[]>(() => [
  { label: t("demo.stats.biome"), value: "Revelwood" },
  { label: t("demo.stats.level"), value: "12–18" },
  { label: t("demo.stats.drops"), value: "Shroud core" },
]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <FactList :rows="rows" layout="stacked" class="max-w-md" />
    <FactList :rows="rows" align="start" />
  </div>
</template>
