<script setup lang="ts">
// A titled list of items with an amount each, such as the raw resources a plan needs.
// An entry can carry a short note, such as why it has to be brought in.
import { language, locale, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { useModule, useNames } from "../context";
import { itemTooltip } from "../tooltip";

defineProps<{ title: string; hint?: string; entries: { item: string; text: string; note?: string }[]; testid?: string }>();

const context = useModule();
const { data } = context.services;
const vTip = context.tip;
const names = useNames(context);
</script>

<template>
  <section class="bg-card min-w-0 rounded-lg border p-3" :data-testid="testid">
    <h3 class="text-sm font-semibold">{{ title }}</h3>
    <p v-if="hint" class="text-muted-foreground mt-0.5 text-xs">{{ hint }}</p>
    <ul class="mt-2 flex flex-col gap-1" role="list">
      <li v-for="entry in entries" :key="entry.item" class="flex min-w-0 items-center gap-2 text-sm">
        <span v-tip="() => itemTooltip(data, entry.item, language, locale(), t)" class="flex min-w-0 flex-1 items-center gap-2">
          <GameIcon :icon="data.items[entry.item]?.icon" :size="20" />
          <span class="min-w-0 truncate">{{ names.item(entry.item) }}</span>
          <span v-if="entry.note" class="text-muted-foreground flex-none text-xs" data-testid="entry-note">{{ entry.note }}</span>
        </span>
        <span class="flex-none tabular-nums">{{ entry.text }}</span>
      </li>
    </ul>
  </section>
</template>
