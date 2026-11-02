<script setup lang="ts">
// With auto-fit off, growing content keeps the view. Adding in front moves everything inside the content, so
// moveOrigin moves the view along and nothing jumps.
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";

const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
const from = ref(2);
const to = ref(4);
const pane = ref<InstanceType<typeof ZoomPane> | null>(null);
/** A card (w-44) and the gap after it (gap-10). */
const STEP_WIDTH = 176 + 40;

function addInFront() {
  from.value--;
  pane.value?.moveOrigin(STEP_WIDTH, 0);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ZoomPane ref="pane" class="h-64" :auto-fit="false" label="Growing line">
      <div class="flex items-center gap-10 p-4">
        <div v-for="step in STEPS.slice(from, to)" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
          <span class="font-medium">{{ step }}</span>
          <span class="text-muted-foreground text-xs">60 / min</span>
        </div>
      </div>
    </ZoomPane>
    <div class="flex flex-wrap gap-2">
      <Button size="xs" variant="secondary" :disabled="from <= 0" @click="addInFront">Add a step in front (moveOrigin)</Button>
      <Button size="xs" variant="secondary" :disabled="to >= STEPS.length" @click="to++">Add a step after</Button>
    </div>
  </div>
</template>
