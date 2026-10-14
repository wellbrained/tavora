<script setup lang="ts">
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { RootSort, Startup } from "../../shared/host-api";
import GameIcon from "../components/GameIcon.vue";
import { act, confirmAction, state, submitAction } from "../host";

const library = computed(() => state.value!.library);
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));

const startup = computed({
  get: () => library.value.startup,
  set: (value: Startup) => void act({ type: "set-startup", startup: value }),
});
const sort = computed({
  get: () => library.value.sort,
  set: (value: RootSort) => void act({ type: "set-sort", sort: value }),
});

function deleteNow(gameId: string, name: string) {
  confirmAction({
    title: `Delete ${name} for good?`,
    message: "Its workspace, notes and all other module data are deleted now. This cannot be undone.",
    confirm: "Delete for good",
    danger: true,
    run: () => submitAction({ type: "delete-game", gameId }),
  });
}
</script>

<template>
  <main class="h-full max-w-[720px] overflow-y-auto p-8" data-testid="settings">
    <h1 class="mb-6 text-xl font-semibold">Settings</h1>

    <section class="bg-card mb-6 rounded-lg border p-4" aria-labelledby="startup-title">
      <h2 id="startup-title" class="mb-3 text-lg font-semibold">When Tavora starts</h2>
      <RadioGroup v-model="startup" aria-labelledby="startup-title">
        <div class="flex items-center gap-2">
          <RadioGroupItem id="startup-welcome" value="welcome" data-testid="startup-welcome" />
          <Label for="startup-welcome" class="font-normal">Show the Home page</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroupItem id="startup-last-game" value="last-game" data-testid="startup-last-game" />
          <Label for="startup-last-game" class="font-normal">Open the last game I played</Label>
        </div>
      </RadioGroup>
    </section>

    <section class="bg-card mb-6 rounded-lg border p-4" aria-labelledby="sort-title">
      <h2 id="sort-title" class="mb-3 text-lg font-semibold">Game list order</h2>
      <RadioGroup v-model="sort" aria-labelledby="sort-title">
        <div class="flex items-center gap-2">
          <RadioGroupItem id="sort-recent" value="recent" data-testid="sort-recent" />
          <Label for="sort-recent" class="font-normal">Recently played first</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroupItem id="sort-manual" value="manual" data-testid="sort-manual" />
          <Label for="sort-manual" class="font-normal">My own order (drag games to arrange them)</Label>
        </div>
      </RadioGroup>
    </section>

    <section class="bg-card mb-6 rounded-lg border p-4" aria-labelledby="trash-title" data-testid="trash">
      <h2 id="trash-title" class="mb-3 text-lg font-semibold">Trash</h2>
      <p class="text-muted-foreground mb-3">Removed games and all their data stay here for 30 days, then they are deleted for good.</p>
      <p v-if="!library.trash.length" class="text-muted-foreground" data-testid="trash-empty">Trash is empty.</p>
      <ul v-else class="flex flex-col gap-2">
        <li v-for="entry in library.trash" :key="entry.game.id" class="flex items-center gap-3" :data-testid="`trash-${entry.game.id}`">
          <GameIcon :game="entry.game" :size="32" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate">{{ entry.game.name }}</span>
            <span class="text-muted-foreground text-xs">Deleted on {{ formatDate(entry.purgeAt) }}</span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            :data-testid="`restore-${entry.game.id}`"
            @click="act({ type: 'restore-game', gameId: entry.game.id })"
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="secondary"
            class="text-destructive"
            :data-testid="`delete-${entry.game.id}`"
            @click="deleteNow(entry.game.id, entry.game.name)"
          >
            Delete now
          </Button>
        </li>
      </ul>
    </section>
  </main>
</template>
