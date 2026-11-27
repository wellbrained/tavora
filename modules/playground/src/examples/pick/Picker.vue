<script setup lang="ts">
// With `search`, a field on top narrows the list by label and keywords. A label too long for the button shows whole in
// its tooltip, and `disabled-reason` says why a picker is off.
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { ref } from "vue";

const game = ref("satisfactory");
const server = ref("long");
const language = ref("en");
const LANGUAGES = [
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
      v-model="game"
      label="Game"
      :options="[
        { value: 'satisfactory', label: 'Satisfactory' },
        { value: 'enshrouded', label: 'Enshrouded' },
        { value: 'poe2', label: 'Path of Exile 2' },
      ]"
    />
    <Picker v-model="language" label="Language" search="Search languages" empty="No language found" :options="LANGUAGES" />
    <Picker v-model="server" label="Server" disabled disabled-reason="Connect first." :options="[{ value: 'long', label: 'A server with a very long name that is cut short' }]" />
  </div>
</template>
