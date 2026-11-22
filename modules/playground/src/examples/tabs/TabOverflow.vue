<script setup lang="ts">
// The tabs that don't fit, both ways: a list button with their count, or arrows on the sides that have hidden tabs.
// Without `overflow` a strip follows the user's Settings > Appearance > Too many tabs, like Tavora's own panel tabs.
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";

const tabs = ref<StripTab[]>(Array.from({ length: 9 }, (_, i) => ({ id: `plan-${i + 1}`, label: `Production plan ${i + 1}`, closable: true })));
const listOpen = ref("plan-1");
const arrowsOpen = ref("plan-5");
const close = (id: string) => (tabs.value = tabs.value.filter((tab) => tab.id !== id));
</script>

<template>
  <div class="flex w-full max-w-80 flex-col gap-4">
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground text-xs">List</span>
      <TabStrip v-model="listOpen" :tabs="tabs" overflow="list" aria-label="Plans in a list" data-testid="tab-strip-overflow-list" @close="close" />
    </div>
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground text-xs">Arrows</span>
      <TabStrip v-model="arrowsOpen" :tabs="tabs" overflow="arrows" aria-label="Plans with arrows" data-testid="tab-strip-overflow-arrows" @close="close" />
    </div>
  </div>
</template>
