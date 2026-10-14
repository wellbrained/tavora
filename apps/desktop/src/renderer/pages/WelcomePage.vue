<script setup lang="ts">
import { Plus } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import GameIcon from "../components/GameIcon.vue";
import { act, dialog, state } from "../host";

const library = computed(() => state.value!.library);
const recent = computed(() => library.value.recent.map((id) => library.value.games[id]!).filter(Boolean));
const empty = computed(() => Object.keys(library.value.games).length === 0);
</script>

<template>
  <main class="flex h-full flex-col items-center overflow-y-auto px-8 pt-16 pb-8 text-center" data-testid="welcome">
    <img class="mb-6" src="/brand/emblem-240.png" alt="" width="111" height="120" draggable="false" />
    <h1 class="text-3xl font-semibold">{{ empty ? "Welcome to Tavora" : "Welcome back" }}</h1>
    <p class="text-muted-foreground mt-2 mb-8">Your home between adventures.</p>

    <section v-if="empty" class="flex flex-col items-center gap-4">
      <p>Add the first game you play. Each game gets its own workspace.</p>
      <Button data-testid="welcome-add-game" @click="dialog = { kind: 'add-game' }">
        <Plus :stroke-width="1.5" /> Add game
      </Button>
    </section>

    <section v-else class="w-full max-w-[720px]" aria-labelledby="recent-title">
      <h2 id="recent-title" class="text-muted-foreground mb-4 text-sm font-medium">Recently played</h2>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
        <li v-for="game in recent" :key="game.id">
          <button
            type="button"
            class="hover:bg-card flex w-full flex-col items-center gap-2 rounded-lg px-2 py-3"
            :data-testid="`recent-${game.id}`"
            @click="act({ type: 'open-game', gameId: game.id })"
          >
            <GameIcon :game="game" :size="64" />
            <span class="max-w-full truncate text-sm">{{ game.name }}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            class="hover:bg-card flex w-full flex-col items-center gap-2 rounded-lg px-2 py-3"
            data-testid="welcome-add-game"
            @click="dialog = { kind: 'add-game' }"
          >
            <span class="border-input text-muted-foreground grid size-16 place-items-center rounded-2xl border border-dashed">
              <Plus class="size-6" :stroke-width="1.5" />
            </span>
            <span class="text-muted-foreground text-sm">Add game</span>
          </button>
        </li>
      </ul>
    </section>
  </main>
</template>
