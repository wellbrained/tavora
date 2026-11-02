<script setup lang="ts">
import { ColorPicker } from "@tavora/official-ui/components/ui/color-picker";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
// Sample swatches: a module picks the colours its users choose from.
const SWATCHES = ["#ffffff", "#facc15", "#fb923c", "#f87171", "#60a5fa", "#4ade80", "#111111"];
const SWATCH_NAMES = ["White", "Yellow", "Orange", "Red", "Blue", "Green", "Black"];
const colour = ref("#60a5fa");
</script>

<template>
  <ColorPicker v-model="colour" label="Colour" :colors="SWATCHES" :labels="SWATCH_NAMES" :disabled="off" />
</template>
