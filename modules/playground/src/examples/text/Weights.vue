<script setup lang="ts">
// Three weights and nothing else.
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

const WEIGHTS: { cls: string; weight: number; use: TextKey }[] = [
  { cls: "font-normal", weight: 400, use: "demo.text.w400" },
  { cls: "font-medium", weight: 500, use: "demo.text.w500" },
  { cls: "font-semibold", weight: 600, use: "demo.text.w600" },
];
</script>

<template>
  <div class="grid grid-cols-[11rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3">
    <template v-for="row in WEIGHTS" :key="row.cls">
      <p class="text-muted-foreground flex flex-col font-mono text-xs">
        <span class="text-foreground">{{ row.cls }}</span>
        <span>{{ row.weight }}</span>
      </p>
      <p class="text-base" :class="row.cls">{{ t(row.use) }}</p>
    </template>
  </div>
</template>
