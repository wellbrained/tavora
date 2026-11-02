<script setup lang="ts">
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";

const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
</script>

<template>
  <ZoomPane class="h-64" fit="width" label="Production tree">
    <div class="flex w-[520px] flex-col items-center gap-6 p-4">
      <div v-for="step in [...STEPS].reverse()" :key="step" class="bg-card flex w-44 flex-col gap-1 rounded-lg border p-3">
        <span class="font-medium">{{ step }}</span>
        <span class="text-muted-foreground text-xs">60 / min</span>
      </div>
    </div>
  </ZoomPane>
</template>
