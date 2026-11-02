<script setup lang="ts">
// Six steps on a 4 px grid. In Tailwind a step is its number times 4 px: p-2, gap-4, mt-6 and so on.
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

const STEPS: { px: number; box: string; tailwind: string; use?: TextKey }[] = [
  { px: 4, box: "size-1", tailwind: "1" },
  { px: 8, box: "size-2", tailwind: "2", use: "demo.spacing.controls" },
  { px: 12, box: "size-3", tailwind: "3" },
  { px: 16, box: "size-4", tailwind: "4", use: "demo.spacing.panel" },
  { px: 24, box: "size-6", tailwind: "6", use: "demo.spacing.sections" },
  { px: 32, box: "size-8", tailwind: "8" },
];
</script>

<template>
  <div class="grid grid-cols-[2rem_3rem_2.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
    <template v-for="step in STEPS" :key="step.px">
      <span class="bg-primary rounded-sm" :class="step.box" />
      <span class="font-mono text-xs">{{ step.px }} px</span>
      <span class="text-muted-foreground font-mono text-xs">{{ step.tailwind }}</span>
      <span class="text-muted-foreground text-sm">{{ step.use ? t(step.use) : "" }}</span>
    </template>
  </div>
</template>
