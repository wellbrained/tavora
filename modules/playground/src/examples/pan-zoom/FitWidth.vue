<script setup lang="ts">
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";

// Steps of a made-up production line, as a tree from the top.
const STEPS = ["Modular Frame", "Reinforced Plate", "Screw", "Iron Rod", "Iron Ingot", "Iron Ore"];
</script>

<template>
  <ZoomPane class="h-64" fit="width" label="Production tree">
    <div class="flex w-[520px] flex-col items-center gap-6 p-4">
      <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-col gap-1 rounded-lg border p-3">
        <span class="font-medium">{{ step }}</span>
        <span class="text-muted-foreground text-xs">60 / min</span>
      </div>
    </div>
  </ZoomPane>
</template>
