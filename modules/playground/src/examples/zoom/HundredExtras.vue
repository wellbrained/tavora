<script setup lang="ts">
// `hundred` is the zoom that reads as 100 %: this content is drawn at twice the size, so 100 % is the zoom 0.5. The %, the
// + and - steps and a click on the % count from it. `extras` adds your own button after Whole map; `whole-label` changes
// that button's hint for content that is not a map.
import { Focus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";

const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
const pane = ref<InstanceType<typeof ZoomPane> | null>(null);
</script>

<template>
  <ZoomPane ref="pane" class="h-64" :hundred="0.5" :min-zoom="0.1" :max-zoom="2" wheel="zoom" whole-label="Show the whole line" label="Large line">
    <div class="flex items-center gap-20 p-8">
      <div v-for="step in STEPS" :key="step" class="bg-card flex w-88 flex-none flex-col gap-4 rounded-lg border p-6 text-xl">
        <span class="font-medium">{{ step }}</span>
        <span class="text-muted-foreground text-base">60 / min</span>
      </div>
    </div>
    <template #extras>
      <Button variant="ghost" size="icon-sm" title="Show the first step" aria-label="Show the first step" @click="pane?.showArea({ x: 0, y: 0, width: 480, height: 240 })">
        <Focus />
      </Button>
    </template>
  </ZoomPane>
</template>
