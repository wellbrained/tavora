<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CatalogMatch, OnlineGame, OnlineSearchResult } from "../../shared/host-api";
import { act, api, dialog, state } from "../host";
import { Input } from "@/components/ui/input";
import ModalDialog from "./ModalDialog.vue";

/** How long the player has to stop typing before the Tavora service is asked. */
const ONLINE_DELAY_MS = 250;

const query = ref("");
const matches = ref<CatalogMatch[]>([]);
const online = ref<OnlineGame[]>([]);
const onlineStatus = ref<OnlineSearchResult["status"]>("ok");
const error = ref<string | null>(null);
const busy = ref(false);
const name = computed(() => query.value.replace(/\s+/g, " ").trim());

let searchId = 0;
watch(
  query,
  async (text) => {
    const id = ++searchId;
    const found = await api.searchCatalog(text);
    if (id === searchId) matches.value = found;
  },
  { immediate: true },
);

let onlineId = 0;
let onlineTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, (text) => {
  clearTimeout(onlineTimer);
  const id = ++onlineId;
  if ([...text.trim()].length < 2) {
    online.value = [];
    onlineStatus.value = "ok";
    return;
  }
  onlineTimer = setTimeout(async () => {
    const result = await api.searchOnline(text);
    if (id !== onlineId) return;
    online.value = result.games;
    onlineStatus.value = result.status;
  }, ONLINE_DELAY_MS);
});
onBeforeUnmount(() => clearTimeout(onlineTimer));

interface Row {
  id: string;
  name: string;
}

// Built-in matches first, then the online ones that are not the same game.
const rows = computed<Row[]>(() => {
  const known = new Set(matches.value.map((match) => match.id));
  return [...matches.value, ...online.value.filter((game) => !known.has(game.id))];
});

function addRow(row: Row) {
  return add(matches.value.some((match) => match.id === row.id) ? { catalogId: row.id } : { online: { id: row.id, name: row.name } });
}

async function add(input: { catalogId: string } | { name: string } | { online: OnlineGame }) {
  busy.value = true;
  error.value = null;
  const added = await act({ type: "add-game", ...input }, { quiet: true });
  if (added.ok && added.id) {
    dialog.value = null;
    // A new game starts with an empty workspace; take the player there,
    // unless they are still in the first-run welcome, which lists it.
    if (state.value?.library.onboarded) await act({ type: "open-game", gameId: added.id });
  } else if (!added.ok) {
    error.value = added.error;
  }
  busy.value = false;
}

function submit() {
  const exact = rows.value.find((row) => row.name.toLowerCase() === name.value.toLowerCase());
  const first = exact ?? (name.value ? undefined : rows.value[0]);
  if (first) void addRow(first);
  else if (name.value) void add({ name: name.value });
}
</script>

<template>
  <ModalDialog title="Add a game" testid="add-game-dialog" @close="dialog = null">
    <form @submit.prevent="submit">
      <label class="sr-only" for="game-search">Search games or type a name</label>
      <Input
        id="game-search"
        v-model="query"
        placeholder="Search games or type a name"
        autocomplete="off"
        maxlength="80"
        data-testid="game-search"
        autofocus
      />
    </form>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="add-game-error">{{ error }}</p>
    <ul class="-mx-2 max-h-[300px] overflow-y-auto" aria-label="Games">
      <li v-for="row in rows" :key="row.id">
        <button
          type="button"
          class="hover:bg-accent focus-visible:bg-accent w-full rounded-md px-2 py-2 text-left"
          :data-testid="`catalog-${row.id}`"
          :disabled="busy"
          @click="addRow(row)"
        >
          {{ row.name }}
        </button>
      </li>
      <li v-if="name">
        <button
          type="button"
          class="text-primary hover:bg-accent focus-visible:bg-accent w-full rounded-md px-2 py-2 text-left"
          data-testid="add-custom"
          :disabled="busy"
          @click="add({ name })"
        >
          Add “{{ name }}” as your own game
        </button>
      </li>
    </ul>
    <p v-if="onlineStatus === 'unreachable' && name" class="text-muted-foreground text-xs" data-testid="online-unreachable">
      Showing built-in games only.
    </p>
    <p class="text-muted-foreground text-xs">Can't find it? Type its name and add it as your own game.</p>
  </ModalDialog>
</template>
