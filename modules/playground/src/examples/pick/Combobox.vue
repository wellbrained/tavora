<script setup lang="ts">
import { Combobox, ComboboxAnchor, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@tavora/official-ui/components/ui/combobox";
import { ref } from "vue";

const GAMES = ["Path of Exile 2", "Diablo IV", "Final Fantasy XIV", "Guild Wars 2", "Satisfactory", "Stardew Valley", "Enshrouded"];
const picked = ref<string>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Combobox v-model="picked">
      <ComboboxAnchor class="w-56">
        <ComboboxInput placeholder="Search games" aria-label="Game" />
      </ComboboxAnchor>
      <ComboboxList>
        <ComboboxEmpty>No game found</ComboboxEmpty>
        <ComboboxItem v-for="game in GAMES" :key="game" :value="game">{{ game }}</ComboboxItem>
      </ComboboxList>
    </Combobox>
    <span class="text-muted-foreground text-sm">{{ picked ?? "Nothing picked" }}</span>
  </div>
</template>
