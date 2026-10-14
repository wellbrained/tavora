<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CatalogMatch } from "../../shared/host-api";
import { act, api, dialog } from "../host";
import { Input } from "@/components/ui/input";
import ModalDialog from "./ModalDialog.vue";

const query = ref("");
const matches = ref<CatalogMatch[]>([]);
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

async function add(input: { catalogId: string } | { name: string }) {
  busy.value = true;
  error.value = null;
  const added = await act({ type: "add-game", ...input }, { quiet: true });
  if (added.ok && added.id) {
    dialog.value = null;
    // A new game starts with an empty workspace; take the player there.
    await act({ type: "open-game", gameId: added.id });
  } else if (!added.ok) {
    error.value = added.error;
  }
  busy.value = false;
}

function submit() {
  const exact = matches.value.find((match) => match.name.toLowerCase() === name.value.toLowerCase());
  const first = exact ?? (name.value ? undefined : matches.value[0]);
  if (first) void add({ catalogId: first.id });
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
      <li v-for="match in matches" :key="match.id">
        <button
          type="button"
          class="hover:bg-accent focus-visible:bg-accent w-full rounded-md px-2 py-2 text-left"
          :data-testid="`catalog-${match.id}`"
          :disabled="busy"
          @click="add({ catalogId: match.id })"
        >
          {{ match.name }}
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
    <p class="text-muted-foreground text-xs">Can't find it? Type its name and add it as your own game.</p>
  </ModalDialog>
</template>
