<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

// Steps of a made-up production line.
const STEPS = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame"];
const picked = ref<string>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <ZoomPane class="h-64" align="end" :fit-floor="0.6" label="Production line">
      <div class="flex items-center gap-10 p-4">
        <div v-for="step in STEPS" :key="step" class="bg-card flex w-44 flex-none flex-col gap-2 rounded-lg border p-3">
          <span class="font-medium">{{ step }}</span>
          <span class="text-muted-foreground text-xs">60 / min</span>
          <Button size="xs" variant="secondary" :disabled="disabled" @click="picked = step">Pick</Button>
        </div>
      </div>
    </ZoomPane>
    <p class="text-muted-foreground text-xs">{{ picked ? `Picked ${picked}.` : "Buttons inside still work." }}</p>
  </div>
</template>
