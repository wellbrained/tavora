<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
// Steps of a made-up production line.
const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
/** Save the view, move around, put it back. */
const remembering = ref<InstanceType<typeof ZoomPane> | null>(null);
const savedView = ref<{ x: number; y: number; zoom: number }>();
function saveView() {
  const view = remembering.value?.view;
  if (view) savedView.value = { ...view };
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ZoomPane ref="remembering" class="h-64" label="Remembered line">
      <div class="flex items-center gap-10 p-4">
        <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
          <span class="font-medium">{{ step }}</span>
          <span class="text-muted-foreground text-xs">60 / min</span>
        </div>
      </div>
    </ZoomPane>
    <div class="flex flex-wrap gap-2">
      <Button size="xs" variant="secondary" :disabled="off" @click="saveView">Save this view</Button>
      <Button size="xs" variant="secondary" :disabled="off" @click="remembering?.showArea({ x: 0, y: 0, width: 200, height: 100 })">Show the top-left corner</Button>
      <Button size="xs" variant="secondary" :disabled="off || !savedView" @click="savedView && remembering?.setView(savedView)">Back to saved view</Button>
    </div>
  </div>
</template>
