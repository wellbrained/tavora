<script setup lang="ts">
// A pane that is hidden (a tab switch, a dialog over it) keeps its view and shows it again as it was.
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";

const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
const shown = ref(true);
</script>

<template>
  <div class="flex flex-col gap-2">
    <ZoomPane v-show="shown" class="h-64" label="Hide and show">
      <div class="flex items-center gap-10 p-4">
        <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
          <span class="font-medium">{{ step }}</span>
          <span class="text-muted-foreground text-xs">60 / min</span>
        </div>
      </div>
    </ZoomPane>
    <div class="flex flex-wrap gap-2">
      <Button size="xs" variant="secondary" @click="shown = !shown">{{ shown ? "Hide the pane" : "Show the pane" }}</Button>
    </div>
  </div>
</template>
