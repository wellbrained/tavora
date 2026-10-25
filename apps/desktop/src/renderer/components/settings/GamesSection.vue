<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import { confirmAction, showToast, state, submitAction } from "../../host";
import { t } from "../../i18n";
import GameIcon from "../GameIcon.vue";
import SettingGroup from "./SettingGroup.vue";
import SteamSection from "./SteamSection.vue";

// Settings > Games: every game in one list, to move many to Trash at once
// (a Steam import can add hundreds). Shift-click ticks a run of games. The
// Steam import itself sits on top, as it is Tavora's own and not a module's.
defineProps<{ highlight: string | null }>();

const filter = ref("");
const ticked = ref(new Set<string>());
/** The row clicked last, where a Shift-click run starts. */
let anchor: string | null = null;

const games = computed(() =>
  Object.values(state.value!.library.games)
    .filter((game) => game.kind === "game")
    .sort((a, b) => a.name.localeCompare(b.name)),
);
const shown = computed(() => {
  const text = filter.value.trim().toLowerCase();
  return text ? games.value.filter((game) => game.name.toLowerCase().includes(text)) : games.value;
});
// Games that left the library (removed elsewhere) are no longer selected.
watch(games, (now) => {
  const live = new Set(now.map((game) => game.id));
  if ([...ticked.value].some((id) => !live.has(id))) ticked.value = new Set([...ticked.value].filter((id) => live.has(id)));
});
const selected = computed(() => games.value.filter((game) => ticked.value.has(game.id)));
const allShown = computed(() => shown.value.length > 0 && shown.value.every((game) => ticked.value.has(game.id)));
const someShown = computed(() => !allShown.value && shown.value.some((game) => ticked.value.has(game.id)));

/** Ticks or clears a game; with Shift, the run from the game clicked last. */
function toggle(id: string, shift: boolean) {
  const on = !ticked.value.has(id);
  const next = new Set(ticked.value);
  const ids = shown.value.map((game) => game.id);
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  const to = ids.indexOf(id);
  const run = shift && from !== -1 ? ids.slice(Math.min(from, to), Math.max(from, to) + 1) : [id];
  for (const each of run) {
    if (on) next.add(each);
    else next.delete(each);
  }
  ticked.value = next;
  anchor = id;
}

/** Ticks or clears every game the filter shows, leaving the others as they are. */
function tickShown(on: boolean) {
  const next = new Set(ticked.value);
  for (const game of shown.value) {
    if (on) next.add(game.id);
    else next.delete(game.id);
  }
  ticked.value = next;
}

function removeSelected() {
  const gameIds = selected.value.map((game) => game.id);
  if (!gameIds.length) return;
  confirmAction({
    title: t("settings.games.removeTitle", { count: gameIds.length }),
    message: t("settings.games.removeMessage"),
    confirm: t("settings.games.remove"),
    danger: true,
    run: async () => {
      const error = await submitAction({ type: "trash-games", gameIds });
      if (error) return error;
      ticked.value = new Set();
      showToast(t("settings.games.removed", { count: gameIds.length }));
      return null;
    },
  });
}
</script>

<template>
  <SteamSection :highlight="highlight" />
  <SettingGroup :title="t('settings.games.listTitle')">
    <div :class="cn('-mx-5 border-b px-5 py-4 transition-colors duration-500 last:border-b-0', highlight === 'games' && 'bg-primary/10')" data-setting="games">
      <p class="text-muted-foreground text-sm">{{ t("settings.games.intro") }}</p>
    </div>
    <p v-if="!games.length" class="text-muted-foreground py-4 text-sm" data-testid="games-empty">{{ t("settings.games.empty") }}</p>
    <template v-else>
      <div class="py-3">
        <Input v-model="filter" :placeholder="t('steamImport.filter')" :aria-label="t('steamImport.filterLabel')" autocomplete="off" maxlength="80" data-testid="games-filter" />
      </div>
      <div class="bg-card sticky top-0 z-[5] -mx-5 flex min-h-12 flex-wrap items-center gap-3 border-y px-5 py-2">
        <label class="flex flex-1 cursor-pointer items-center gap-3">
          <Checkbox
            :model-value="allShown ? true : someShown ? 'indeterminate' : false"
            :disabled="!shown.length"
            data-testid="games-select-all"
            @update:model-value="tickShown($event === true)"
          />
          <span>{{ t("settings.games.selectAll") }}</span>
        </label>
        <span class="text-muted-foreground text-sm tabular-nums" data-testid="games-selected">{{ t("settings.games.selected", { count: selected.length }) }}</span>
        <Button variant="danger" :disabled="!selected.length" data-testid="games-remove" @click="removeSelected">
          {{ t("settings.games.remove") }}
        </Button>
      </div>
      <ul class="-mx-5" :aria-label="t('settings.games.list')" data-testid="games-list">
        <li v-for="game in shown" :key="game.id">
          <!-- The whole row ticks; the click of the box itself lands here too, so it counts once. -->
          <div class="hover:bg-accent flex min-h-14 cursor-pointer items-center gap-4 px-5 py-2 select-none" @click="toggle(game.id, $event.shiftKey)">
            <Checkbox :model-value="ticked.has(game.id)" :aria-label="game.name" :data-testid="`games-tick-${game.id}`" />
            <GameIcon :game="game" :size="32" />
            <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
          </div>
        </li>
        <li v-if="!shown.length" class="text-muted-foreground px-5 py-4 text-sm">{{ t("steamImport.noMatch") }}</li>
      </ul>
    </template>
  </SettingGroup>
</template>
