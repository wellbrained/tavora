<script setup lang="ts">
// Game covers: art that arrives late, a game without art (its fallback), and one being added.
import { Button } from "@tavora/official-ui/components/ui/button";
import { GameCover } from "@tavora/official-ui/components/ui/game-cover";
import { onBeforeUnmount, ref } from "vue";

const ART = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAGElEQVR4nGPIq+iZtmALhGSAs4AkA04ZALkyGuGrUrMPAAAAAElFTkSuQmCC";
const art = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
function load() {
  clearTimeout(timer);
  art.value = null;
  timer = setTimeout(() => (art.value = `${ART}#${Date.now()}`), 900);
}
load();
onBeforeUnmount(() => clearTimeout(timer));

const GAMES = [
  { name: "Late art", busy: false },
  { name: "No art", busy: false },
  { name: "Adding", busy: true },
];
</script>

<template>
  <div class="flex flex-col items-start gap-3">
    <div class="grid w-full max-w-md grid-cols-3 gap-2">
      <div v-for="(game, index) in GAMES" :key="game.name" class="flex min-w-0 flex-col gap-1.5">
        <GameCover :src="index === 0 ? art : null" :pending="index === 0 && art === null" :busy="game.busy" :data-testid="`game-cover-${index}`">
          <template #fallback><span class="bg-secondary text-secondary-foreground grid size-full place-items-center text-lg font-semibold">{{ game.name.slice(0, 2).toUpperCase() }}</span></template>
        </GameCover>
        <span class="truncate text-sm font-medium">{{ game.name }}</span>
      </div>
    </div>
    <Button size="xs" variant="secondary" @click="load">Load again</Button>
  </div>
</template>
