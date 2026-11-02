<script setup lang="ts">
import { StyleTiles } from "@tavora/official-ui/components/ui/style-tiles";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const style = ref<"card" | "bar" | "minimal">("card");
const STYLES = [
  { value: "card" as const, label: "Card" },
  { value: "bar" as const, label: "Bar" },
  { value: "minimal" as const, label: "Minimal" },
];
</script>

<template>
  <StyleTiles v-model="style" label="Style" :options="STYLES" class="max-w-96" :disabled="off">
    <template #tile="{ option }">
      <span :class="['absolute inset-x-2 rounded-sm bg-black/70', option.value === 'card' ? 'top-2 bottom-2' : option.value === 'bar' ? 'bottom-2 h-2' : 'top-1/2 h-1 -translate-y-1/2 bg-black/40']" />
    </template>
  </StyleTiles>
</template>
