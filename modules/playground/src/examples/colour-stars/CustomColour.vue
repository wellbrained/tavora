<script setup lang="ts">
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

// The colours a user picks from: data, not the theme, so they are written out.
const SWATCHES = ["#ffffff", "#facc15", "#fb923c", "#f87171", "#60a5fa", "#4ade80", "#111111"];
const NAMES = ["White", "Yellow", "Orange", "Red", "Blue", "Green", "Black"];
const colour = ref("#60a5fa");
</script>

<template>
  <div class="flex flex-col gap-2">
    <ColorPicker v-model="colour" label="Colour" :colors="SWATCHES" :labels="NAMES" allow-custom :disabled="disabled" />
    <span class="text-muted-foreground text-xs tabular-nums">{{ colour }}</span>
  </div>
</template>
