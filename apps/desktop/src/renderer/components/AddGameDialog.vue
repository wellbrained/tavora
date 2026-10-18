<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CatalogMatch, OnlineGame, OnlineSearchResult } from "../../shared/host-api";
import { act, api, dialog, state } from "../host";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

/** How long the player has to stop typing before the Tavora service is asked. */
const ONLINE_DELAY_MS = 250;

const query = ref("");
const matches = ref<CatalogMatch[]>([]);
const online = ref<OnlineGame[]>([]);
const onlineStatus = ref<OnlineSearchResult["status"]>("ok");
const error = ref<string | null>(null);
const busy = ref(false);
/** Adding a game, or making a personal workspace, which belongs to no game. */
const mode = ref<"game" | "workspace">("game");
const workspaceName = ref("");
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
  if (matches.value.some((match) => match.id === row.id)) return add({ catalogId: row.id });
  // The online result carries the game's Steam id, which the host needs for its icon.
  return add({ online: online.value.find((game) => game.id === row.id) ?? { id: row.id, name: row.name, steamAppId: null } });
}

async function add(input: { catalogId: string } | { name: string } | { online: OnlineGame } | { workspace: string }) {
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

function switchMode(to: "game" | "workspace") {
  // What was typed as a game's name is a fair start for the workspace's, and back.
  if (to === "workspace") workspaceName.value = name.value;
  else query.value = workspaceName.value.trim();
  error.value = null;
  mode.value = to;
}

function submitWorkspace() {
  const value = workspaceName.value.replace(/\s+/g, " ").trim();
  if (value) void add({ workspace: value });
}

function submit() {
  const exact = rows.value.find((row) => row.name.toLowerCase() === name.value.toLowerCase());
  const first = exact ?? (name.value ? undefined : rows.value[0]);
  if (first) void addRow(first);
  else if (name.value) void add({ name: name.value });
}
</script>

<template>
  <ModalDialog v-if="mode === 'workspace'" :title="t('addWorkspace.title')" testid="add-workspace-dialog" @close="dialog = null">
    <form class="flex flex-col gap-3" @submit.prevent="submitWorkspace">
      <label class="text-sm font-medium" for="workspace-name">{{ t("addWorkspace.name") }}</label>
      <Input
        id="workspace-name"
        v-model="workspaceName"
        :placeholder="t('addWorkspace.placeholder')"
        autocomplete="off"
        maxlength="80"
        data-testid="workspace-name"
        autofocus
      />
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="add-game-error">{{ error }}</p>
      <p class="text-muted-foreground text-xs">{{ t("addWorkspace.hint") }}</p>
      <Button type="submit" class="w-fit" data-testid="create-workspace" :disabled="busy || !workspaceName.trim()">
        {{ t("addWorkspace.create") }}
      </Button>
    </form>
    <button
      type="button"
      class="text-primary w-fit text-xs underline-offset-2 hover:underline"
      data-testid="add-game-instead"
      @click="switchMode('game')"
    >
      {{ t("addWorkspace.toGame") }}
    </button>
  </ModalDialog>
  <ModalDialog v-else :title="t('addGame.title')" testid="add-game-dialog" @close="dialog = null">
    <form @submit.prevent="submit">
      <label class="sr-only" for="game-search">{{ t("addGame.search") }}</label>
      <Input
        id="game-search"
        v-model="query"
        :placeholder="t('addGame.search')"
        autocomplete="off"
        maxlength="80"
        data-testid="game-search"
        autofocus
      />
    </form>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="add-game-error">{{ error }}</p>
    <ul class="-mx-2 max-h-[300px] overflow-y-auto" :aria-label="t('common.games')">
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
          {{ t("addGame.custom", { name }) }}
        </button>
      </li>
    </ul>
    <p v-if="onlineStatus === 'unreachable' && name" class="text-muted-foreground text-xs" data-testid="online-unreachable">
      {{ t("addGame.builtInOnly") }}
    </p>
    <p class="text-muted-foreground text-xs">{{ t("addGame.hint") }}</p>
    <button
      type="button"
      class="text-primary w-fit text-xs underline-offset-2 hover:underline"
      data-testid="open-steam-import"
      @click="dialog = { kind: 'steam-import' }"
    >
      {{ t("addGame.steam") }}
    </button>
    <button
      type="button"
      class="text-primary w-fit text-xs underline-offset-2 hover:underline"
      data-testid="open-add-workspace"
      @click="switchMode('workspace')"
    >
      {{ t("addGame.toWorkspace") }}
    </button>
  </ModalDialog>
</template>
