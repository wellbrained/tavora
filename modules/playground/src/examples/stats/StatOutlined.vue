<script setup lang="ts">
// Outlined tiles; a text value shows as it is, and `compact` writes a big number short.
import { StatStrip, StatTile } from "@tavora/official-ui/components/ui/stat-tile";
import { computed } from "vue";
import { t } from "../../i18n";
const text = computed(() => ({ played: t("demo.stats.played"), bestTime: t("demo.stats.bestTime"), points: t("demo.stats.points") }));
</script>

<template>
  <StatStrip variant="outlined" class="max-w-xl">
    <StatTile :value="1240" :label="text.played" />
    <StatTile value="3:42" :label="text.bestTime" />
    <StatTile :value="12345678" :label="text.points" />
    <StatTile :value="12345678" :label="text.points" compact />
  </StatStrip>
</template>
