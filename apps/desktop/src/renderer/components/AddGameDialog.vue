<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import type { CatalogMatch, OnlineGame, OnlineSearchResult } from "../../shared/host-api";
import { act, api, dialog, state } from "../host";
import { rankByName } from "@/lib/search";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

/** How long the user has to stop typing before the Tavora service is asked. */
const ONLINE_DELAY_MS = 250;

const query = ref("");
const matches = ref<CatalogMatch[]>([]);
const online = ref<OnlineGame[]>([]);
const onlineStatus = ref<OnlineSearchResult["status"]>("ok");
const error = ref<string | null>(null);
const busy = ref(false);
/** Adding a game (its game workspace), or making a personal workspace, which belongs to no game. */
const mode = ref<"game" | "personal">("game");
const personalName = ref("");
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

// Built-in and online games as one list, ranked by how well the name fits what
// was typed: "eld" lists Elden Ring before Battlefield 6. Same game once only.
const rows = computed<Row[]>(() => {
  const known = new Set(matches.value.map((match) => match.id));
  return rankByName([...matches.value, ...online.value.filter((game) => !known.has(game.id))], query.value, (row) => row.name);
});

function addRow(row: Row) {
  if (matches.value.some((match) => match.id === row.id)) return add({ catalogId: row.id });
  // The online result carries the game's Steam id, which the host needs for its icon.
  return add({ online: online.value.find((game) => game.id === row.id) ?? { id: row.id, name: row.name, steamAppId: null } });
}

async function add(input: { catalogId: string } | { name: string } | { online: OnlineGame } | { personal: string }) {
  busy.value = true;
  error.value = null;
  const added = await act({ type: "add-workspace", ...input }, { quiet: true });
  if (added.ok && added.id) {
    dialog.value = null;
    // A new workspace starts empty; take the user there,
    // unless they are still in the first-run welcome, which lists it.
    if (state.value?.library.onboarded) await act({ type: "open-workspace", workspaceId: added.id });
  } else if (!added.ok) {
    error.value = added.error;
  }
  busy.value = false;
}

function switchMode(to: "game" | "personal") {
  // What was typed as a game's name is a fair start for the personal workspace's, and back.
  if (to === "personal") personalName.value = name.value;
  else query.value = personalName.value.trim();
  error.value = null;
  mode.value = to;
}

function submitPersonal() {
  const value = personalName.value.replace(/\s+/g, " ").trim();
  if (value) void add({ personal: value });
}

function submit() {
  const exact = rows.value.find((row) => row.name.toLowerCase() === name.value.toLowerCase());
  const first = exact ?? (name.value ? undefined : rows.value[0]);
  if (first) void addRow(first);
  else if (name.value) void add({ name: name.value });
}
</script>

<template>
  <ModalDialog v-if="mode === 'personal'" :title="t('addPersonal.title')" testid="add-personal-dialog" @close="dialog = null">
    <form class="flex flex-col gap-3" @submit.prevent="submitPersonal">
      <label class="text-sm font-medium" for="personal-name">{{ t("addPersonal.name") }}</label>
      <Input
        id="personal-name"
        v-model="personalName"
        :placeholder="t('addPersonal.placeholder')"
        autocomplete="off"
        maxlength="80"
        data-testid="personal-name"
        autofocus
      />
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="add-game-error">{{ error }}</p>
      <p class="text-muted-foreground text-xs">{{ t("addPersonal.hint") }}</p>
      <Button type="submit" class="w-fit" data-testid="create-personal" :disabled="busy || !personalName.trim()">
        {{ t("addPersonal.create") }}
      </Button>
    </form>
    <button
      type="button"
      class="text-primary w-fit text-xs underline-offset-2 hover:underline"
      data-testid="add-game-instead"
      @click="switchMode('game')"
    >
      {{ t("addPersonal.toGame") }}
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
    <ul class="-mx-2 max-h-[300px] overflow-y-auto [@media(max-height:640px)]:max-h-[136px]" :aria-label="t('common.games')">
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
      data-testid="open-add-personal"
      @click="switchMode('personal')"
    >
      {{ t("addGame.toPersonal") }}
    </button>
  </ModalDialog>
</template>
