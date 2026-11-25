<script setup lang="ts">
// Four tiles share a row while each gets 7rem; narrower, they go 2×2. `animate` counts to a new value.
import { Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { StatStrip, StatTile } from "@tavora/official-ui/components/ui/stat-tile";
import { computed, ref } from "vue";
import { t } from "../../i18n";

const played = ref(128);
const text = computed(() => ({ played: t("demo.stats.played"), winRate: t("demo.stats.winRate"), vsLastWeek: t("demo.stats.vsLastWeek"), streak: t("demo.stats.streak"), bestStreak: t("demo.stats.bestStreak"), narrow: t("demo.stats.narrow"), addGame: t("demo.stats.addGame") }));
</script>

<template>
  <div class="flex flex-col gap-4">
    <StatStrip class="max-w-xl">
      <StatTile :value="played" :label="text.played" animate />
      <StatTile :value="82" unit="%" :label="text.winRate" trend="better" :hint="text.vsLastWeek" />
      <StatTile :value="6" :label="text.streak" trend="worse" hint="−2" />
      <StatTile :value="14" :label="text.bestStreak" />
    </StatStrip>
    <div class="flex flex-col gap-1.5">
      <span class="text-muted-foreground text-xs">{{ text.narrow }}</span>
      <StatStrip class="w-72">
        <StatTile :value="played" :label="text.played" animate />
        <StatTile :value="82" unit="%" :label="text.winRate" trend="better" :hint="text.vsLastWeek" />
        <StatTile :value="6" :label="text.streak" trend="worse" hint="−2" />
        <StatTile :value="14" :label="text.bestStreak" />
      </StatStrip>
    </div>
    <div><Button size="xs" variant="secondary" @click="played++"><Plus />{{ text.addGame }}</Button></div>
  </div>
</template>
