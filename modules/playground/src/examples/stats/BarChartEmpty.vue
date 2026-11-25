<script setup lang="ts">
import { BarChart } from "@tavora/official-ui/components/ui/bar-chart";
import { computed } from "vue";
import { t } from "../../i18n";
const text = computed(() => ({ byGuesses: t("demo.stats.byGuesses"), empty: t("demo.stats.empty"), emptyHint: t("demo.stats.emptyHint") }));
</script>

<template>
  <BarChart :bars="[]" :label="text.byGuesses" :empty-title="text.empty" :empty-description="text.emptyHint" class="max-w-sm" />
</template>
