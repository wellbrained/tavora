<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
// Steps of a made-up production line; adding one grows the content without moving the view.
const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
const grownFrom = ref(2);
const grownTo = ref(4);
const growing = ref<InstanceType<typeof ZoomPane> | null>(null);
/** A card (w-44) and the gap after it (gap-10). */
const STEP_WIDTH = 176 + 40;
function addInFront() {
  grownFrom.value--;
  // Everything moves one card to the right inside the content; the view follows so nothing jumps.
  growing.value?.moveOrigin(STEP_WIDTH, 0);
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ZoomPane ref="growing" class="h-64" :auto-fit="false" label="Growing line">
      <div class="flex items-center gap-10 p-4">
        <div v-for="step in STEPS.slice(grownFrom, grownTo)" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
          <span class="font-medium">{{ step }}</span>
          <span class="text-muted-foreground text-xs">60 / min</span>
        </div>
      </div>
    </ZoomPane>
    <div class="flex gap-2">
      <Button size="xs" variant="secondary" :disabled="off || grownFrom <= 0" @click="addInFront">Add a step in front (moveOrigin)</Button>
      <Button size="xs" variant="secondary" :disabled="off || grownTo >= STEPS.length" @click="grownTo++">Add a step after</Button>
    </div>
  </div>
</template>
