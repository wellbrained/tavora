<script setup lang="ts">
// Grows with the text (an OBS text source without a bounding box): the frame is as big as the text, and dragging a corner
// scales both. Here the slider stands in for that drag; the text is laid out at the real size, so it stays sharp. Sizes in
// the slot multiply with --overlay-text-scale.
import { Slider } from "@tavora/official-ui/components/ui/slider";
import { OverlayText } from "@tavora/official-ui/components/ui/overlay-text";
import { computed, ref } from "vue";

const scale = ref([100]);
// The text's natural size: 20 px high (text-xl) and about this wide, with 8 px around it.
const box = computed(() => ({ width: `${Math.round(120 * (scale.value[0]! / 100)) + 16}px`, height: `${Math.round(21 * (scale.value[0]! / 100)) + 16}px` }));
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3">
      <span class="text-muted-foreground w-16 text-xs tabular-nums">{{ scale[0] }} %</span>
      <Slider v-model="scale" :min="50" :max="250" :step="10" class="max-w-60" aria-label="Scale" />
    </div>
    <OverlayText mode="grow" :padding="8" class="bg-foreground text-background rounded-md" :style="box">
      <div class="font-semibold" style="font-size: calc(20px * var(--overlay-text-scale))">12 Deaths</div>
    </OverlayText>
  </div>
</template>
