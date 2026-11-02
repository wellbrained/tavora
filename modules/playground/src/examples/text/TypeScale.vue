<script setup lang="ts">
// The five text sizes. Each class sets the size and its line height together, so you never write either by hand.
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

const SIZES: { cls: string; size: string; use: TextKey }[] = [
  { cls: "text-xl font-semibold", size: "20 / 26 px", use: "demo.text.xl" },
  { cls: "text-lg font-semibold", size: "16 / 22 px", use: "demo.text.lg" },
  { cls: "text-base", size: "14 / 20 px", use: "demo.text.base" },
  { cls: "text-sm font-medium", size: "13 / 18 px", use: "demo.text.sm" },
  { cls: "text-xs", size: "12 / 16 px", use: "demo.text.xs" },
];
</script>

<template>
  <div class="grid grid-cols-[11rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-3">
    <template v-for="row in SIZES" :key="row.cls">
      <p class="text-muted-foreground flex flex-col font-mono text-xs">
        <span class="text-foreground">{{ row.cls }}</span>
        <span>{{ row.size }}</span>
      </p>
      <p :class="row.cls">{{ t(row.use) }}</p>
    </template>
  </div>
</template>
