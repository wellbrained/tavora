<script setup lang="ts">
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const pickedGame = ref("satisfactory");
const pickedLanguage = ref("en");
const LANGUAGE_OPTIONS = [
  { value: "en", label: "English", keywords: "englisch" },
  { value: "de", label: "Deutsch", keywords: "german" },
  { value: "fr", label: "Français", keywords: "french" },
  { value: "es", label: "Español", keywords: "spanish" },
  { value: "ja", label: "日本語", keywords: "japanese" },
];
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Picker
      v-model="pickedGame"
      label="Game"
      :disabled="off"
      :options="[
        { value: 'satisfactory', label: 'Satisfactory' },
        { value: 'enshrouded', label: 'Enshrouded' },
        { value: 'poe2', label: 'Path of Exile 2' },
      ]"
    />
    <Picker v-model="pickedLanguage" label="Language" search="Search languages" empty="No language found" :disabled="off" :options="LANGUAGE_OPTIONS" />
  </div>
</template>
