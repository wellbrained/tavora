<script setup lang="ts">
// view is where the pane looks now; setView puts a saved one back; showArea shows a chosen part of the content.
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";

const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
const pane = ref<InstanceType<typeof ZoomPane> | null>(null);
const saved = ref<{ x: number; y: number; zoom: number }>();

function save() {
  const view = pane.value?.view;
  if (view) saved.value = { ...view };
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <ZoomPane ref="pane" class="h-64" label="Remembered line">
      <div class="flex items-center gap-10 p-4">
        <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
          <span class="font-medium">{{ step }}</span>
          <span class="text-muted-foreground text-xs">60 / min</span>
        </div>
      </div>
    </ZoomPane>
    <div class="flex flex-wrap gap-2">
      <Button size="xs" variant="secondary" @click="save">Save this view</Button>
      <Button size="xs" variant="secondary" @click="pane?.showArea({ x: 0, y: 0, width: 200, height: 100 })">Show the top-left corner</Button>
      <Button size="xs" variant="secondary" :disabled="!saved" @click="saved && pane?.setView(saved)">Back to saved view</Button>
    </div>
  </div>
</template>
