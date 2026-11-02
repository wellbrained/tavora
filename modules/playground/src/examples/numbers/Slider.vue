<script setup lang="ts">
// A slider takes a list of values: one thumb per value, so two make a range.
import { Slider } from "@tavora/official-ui/components/ui/slider";
import { ref } from "vue";

const volume = ref([60]);
const range = ref([20, 80]);
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-3">
      <Slider v-model="volume" :max="100" :step="1" class="w-full max-w-64" aria-label="Volume" />
      <span class="text-muted-foreground text-xs tabular-nums">{{ volume[0] }}</span>
    </div>
    <div class="flex items-center gap-3">
      <Slider v-model="range" :max="100" :step="5" class="w-full max-w-64" aria-label="Level range" />
      <span class="text-muted-foreground text-xs tabular-nums">{{ range[0] }}–{{ range[1] }}</span>
    </div>
  </div>
</template>
