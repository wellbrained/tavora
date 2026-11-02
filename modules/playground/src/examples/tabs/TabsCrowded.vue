<script setup lang="ts">
import { TabStrip, type StripTab } from "@tavora/official-ui/components/ui/tabs";
import { ref } from "vue";

const tabs = ref<StripTab[]>(Array.from({ length: 12 }, (_, i) => ({ id: `plan-${i + 1}`, label: `Production plan ${i + 1}`, closable: true })));
const active = ref("plan-1");
</script>

<template>
  <TabStrip v-model="active" :tabs="tabs" class="w-full max-w-72" aria-label="Many tabs" data-testid="tab-strip-crowd" @close="(id) => (tabs = tabs.filter((tab) => tab.id !== id))" />
</template>
