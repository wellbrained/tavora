<script setup lang="ts">
// Without `search` the list itself takes the arrow keys. `v-model` marks the chosen row, as in a Picker.
import { Listbox } from "@tavora/official-ui/components/ui/listbox";
import { ref } from "vue";

const sound = ref("rain");
const SOUNDS = [
  { value: "rain", label: "Rain", meta: "Weather" },
  { value: "fire", label: "Fireplace", meta: "Home" },
  { value: "cafe", label: "Café", meta: "City" },
  { value: "waves", label: "Waves", meta: "Nature" },
];
</script>

<template>
  <Listbox v-model="sound" :options="SOUNDS" label="Sound" class="w-full max-w-64" />
</template>
