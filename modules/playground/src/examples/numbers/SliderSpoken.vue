<script setup lang="ts">
// `valueText` is what a screen reader says for the value, when the bare number isn't enough.
import { Slider } from "@tavora/official-ui/components/ui/slider";
import { computed, ref } from "vue";

const level = ref([70]);
const spoken = computed(() => `${level.value[0]} percent`);
</script>

<template>
  <div class="flex items-center gap-3">
    <Slider v-model="level" :max="100" :step="5" :value-text="spoken" class="w-full max-w-64" aria-label="Brightness" data-testid="slider-spoken" />
    <span class="text-muted-foreground text-xs tabular-nums">{{ level[0] }} %</span>
  </div>
</template>
