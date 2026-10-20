<script setup lang="ts">
// Settings > Trash: removed games, kept for 30 days. Tick several to restore or delete them together.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { cn } from "@/lib/utils";
import { act, confirmAction, state, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import GameIcon from "../GameIcon.vue";

defineProps<{ highlight: string | null }>();

const library = computed(() => state.value!.library);

// Games ticked to restore or delete together.
const trashTicked = ref(new Set<string>());
watch(
  () => library.value.trash,
  (trash) => {
    const there = new Set(trash.map((entry) => entry.game.id));
    if ([...trashTicked.value].some((id) => !there.has(id))) trashTicked.value = new Set([...trashTicked.value].filter((id) => there.has(id)));
  },
);
const trashAll = computed(() => library.value.trash.length > 0 && library.value.trash.every((entry) => trashTicked.value.has(entry.game.id)));

function tickTrash(id: string, on: boolean) {
  const next = new Set(trashTicked.value);
  if (on) next.add(id);
  else next.delete(id);
  trashTicked.value = next;
}

function tickAllTrash(on: boolean) {
  trashTicked.value = on ? new Set(library.value.trash.map((entry) => entry.game.id)) : new Set();
}

async function restoreTicked() {
  const gameIds = [...trashTicked.value];
  if (gameIds.length && (await act({ type: "restore-games", gameIds })).ok) trashTicked.value = new Set();
}

function deleteTicked() {
  const gameIds = [...trashTicked.value];
  if (!gameIds.length) return;
  confirmAction({
    title: t("settings.trash.deleteManyTitle", { count: gameIds.length }),
    message: t("settings.trash.deleteManyMessage"),
    confirm: t("settings.trash.deleteConfirm"),
    danger: true,
    run: () => submitAction({ type: "delete-games", gameIds }),
  });
}

function deleteNow(gameId: string, name: string) {
  confirmAction({
    title: t("settings.trash.deleteTitle", { name }),
    message: t("settings.trash.deleteMessage"),
    confirm: t("settings.trash.deleteConfirm"),
    danger: true,
    run: () => submitAction({ type: "delete-game", gameId }),
  });
}
</script>

<template>
  <p class="text-muted-foreground mb-4 text-sm">{{ t("settings.trash.description") }}</p>
  <div data-testid="trash">
    <p v-if="!library.trash.length" class="text-muted-foreground rounded-xl border border-dashed py-10 text-center" data-testid="trash-empty">{{ t("settings.trash.empty") }}</p>
    <div v-else class="bg-card sticky top-0 z-[5] -mx-3 flex min-h-12 flex-wrap items-center gap-3 border-b px-3 py-2">
      <label class="flex flex-1 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          class="accent-primary size-4"
          :checked="trashAll"
          :indeterminate="!trashAll && trashTicked.size > 0"
          data-testid="trash-select-all"
          @change="tickAllTrash(($event.target as HTMLInputElement).checked)"
        />
        <span>{{ t("settings.trash.selectAll") }}</span>
      </label>
      <span class="text-muted-foreground text-sm tabular-nums">{{ t("settings.games.selected", { count: trashTicked.size }) }}</span>
      <Button variant="secondary" :disabled="!trashTicked.size" data-testid="trash-restore-selected" @click="restoreTicked">
        {{ t("settings.trash.restoreSelected") }}
      </Button>
      <Button variant="danger" :disabled="!trashTicked.size" data-testid="trash-delete-selected" @click="deleteTicked">
        {{ t("settings.trash.deleteSelected") }}
      </Button>
    </div>
    <ul v-if="library.trash.length">
      <li
        v-for="entry in library.trash"
        :key="entry.game.id"
        :class="
          cn(
            '-mx-3 flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-3 transition-colors duration-500 last:border-b-0',
            highlight === `trash-${entry.game.id}` && 'bg-primary/10',
          )
        "
        :data-testid="`trash-${entry.game.id}`"
        :data-setting="`trash-${entry.game.id}`"
      >
        <input
          type="checkbox"
          class="accent-primary size-4 flex-none"
          :checked="trashTicked.has(entry.game.id)"
          :aria-label="entry.game.name"
          :data-testid="`trash-tick-${entry.game.id}`"
          @change="tickTrash(entry.game.id, ($event.target as HTMLInputElement).checked)"
        />
        <GameIcon :game="entry.game" :size="40" />
        <span class="flex min-w-0 flex-1 basis-40 flex-col gap-1">
          <span class="truncate font-medium">{{ entry.game.name }}</span>
          <span class="text-muted-foreground text-sm">{{ t("settings.trash.deleteOn", { date: formatDate(entry.purgeAt) }) }}</span>
        </span>
        <Button variant="secondary" :data-testid="`restore-${entry.game.id}`" @click="act({ type: 'restore-game', gameId: entry.game.id })">
          {{ t("settings.trash.restore") }}
        </Button>
        <Button variant="danger" :data-testid="`delete-${entry.game.id}`" @click="deleteNow(entry.game.id, entry.game.name)">
          {{ t("settings.trash.deleteNow") }}
        </Button>
      </li>
    </ul>
  </div>
</template>
