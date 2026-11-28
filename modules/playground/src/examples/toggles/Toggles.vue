<script setup lang="ts">
// rules-allow-file: font-weight a letter drawn bold stands for the Bold button
import { Bold, History, Pin, Volume2 } from "@lucide/vue";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { ref } from "vue";

const bold = ref(true);
const pinned = ref(false);
const history = ref(true);
const sound = ref(false);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <Toggle v-model="bold" label="Bold"><Bold /></Toggle>
      <Toggle v-model="pinned"><Pin /> Pin</Toggle>
      <Toggle v-model="bold" label="Bold" class="font-bold">B</Toggle>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <Toggle v-model="history" variant="ghost" label="Show history"><History /></Toggle>
      <Toggle v-model="pinned" variant="ghost"><Pin /> Pin</Toggle>
      <Toggle v-model="sound" variant="ghost" label="Sound" disabled disabled-reason="Pick a sound first."><Volume2 /></Toggle>
    </div>
  </div>
</template>
