<script setup lang="ts">
// `persist-key` makes the pane remember its view (the point in the middle and the zoom) in the module's storage and open
// on it next time; with nothing saved it opens on the whole content. Move it, then reload the Playground.
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";

const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
</script>

<template>
  <ZoomPane class="h-64" persist-key="playground-line" label="Remembering line">
    <div class="flex items-center gap-10 p-4">
      <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
        <span class="font-medium">{{ step }}</span>
        <span class="text-muted-foreground text-xs">60 / min</span>
      </div>
    </div>
  </ZoomPane>
</template>
