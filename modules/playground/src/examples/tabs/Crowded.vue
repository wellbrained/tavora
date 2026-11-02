<script setup lang="ts">
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";

const crowdTabs = ref<StripTab[]>(Array.from({ length: 12 }, (_, i) => ({ id: `plan-${i + 1}`, label: `Production plan ${i + 1}`, closable: true })));
const crowdActive = ref("plan-1");
</script>

<template>
  <TabStrip v-model="crowdActive" :tabs="crowdTabs" class="w-72" aria-label="Many tabs" data-testid="tab-strip-crowd" @close="(id) => (crowdTabs = crowdTabs.filter((tab) => tab.id !== id))" />
</template>
