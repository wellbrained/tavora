<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SteamGameView } from "../../shared/host-api";
import { act, api, dialog, showToast, state } from "../host";
import ModalDialog from "./ModalDialog.vue";

const profile = ref(state.value?.library.steamProfile ?? "");
// Remembered on this PC only, and only once a lookup worked.
const remember = ref(state.value?.library.steamProfile != null);
const games = ref<SteamGameView[] | null>(null);
const ticked = ref(new Set<number>());
const filter = ref("");
const looking = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

const fresh = computed(() => (games.value ?? []).filter((game) => game.status === "new"));
const shown = computed(() => {
  const text = filter.value.trim().toLowerCase();
  return (games.value ?? []).filter((game) => !text || game.name.toLowerCase().includes(text));
});
const count = computed(() => fresh.value.filter((game) => ticked.value.has(game.appid)).length);
const owned = computed(() => (games.value?.length ?? 0) - fresh.value.length);

async function lookUp() {
  if (looking.value || !profile.value.trim()) return;
  looking.value = true;
  error.value = null;
  const result = await api.steamLibrary(profile.value);
  looking.value = false;
  if (result.status === "error") {
    error.value = result.error;
    return;
  }
  games.value = result.games;
  const wanted = remember.value ? profile.value.trim() : null;
  if (wanted !== (state.value?.library.steamProfile ?? null)) void act({ type: "set-steam-profile", profile: wanted }, { quiet: true });
  filter.value = "";
  ticked.value = new Set(result.games.filter((game) => game.status === "new").map((game) => game.appid));
}

function toggle(appid: number, on: boolean) {
  const next = new Set(ticked.value);
  if (on) next.add(appid);
  else next.delete(appid);
  ticked.value = next;
}

function tickAll(on: boolean) {
  ticked.value = on ? new Set(fresh.value.map((game) => game.appid)) : new Set();
}

function back() {
  games.value = null;
  error.value = null;
}

async function runImport() {
  busy.value = true;
  error.value = null;
  const chosen = fresh.value.filter((game) => ticked.value.has(game.appid)).map(({ appid, name, id }) => ({ appid, name, id }));
  const result = await act({ type: "import-steam-games", games: chosen }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  dialog.value = null;
  const added = result.added ?? 0;
  showToast(added === 0 ? "Those games were already in your library." : added === 1 ? "Added 1 game from Steam." : `Added ${added} games from Steam.`);
}

const status = (game: SteamGameView) => (game.status === "trash" ? "In Trash" : "Already in your library");
</script>

<template>
  <ModalDialog
    title="Import from Steam"
    description="Add the games you own on Steam. Tavora only lists them: it does not start games or collect anything else about them."
    testid="steam-import-dialog"
    class="sm:max-w-[500px]"
    @close="dialog = null"
  >
    <form v-if="!games" class="flex flex-col gap-3" @submit.prevent="lookUp">
      <label class="text-sm" for="steam-profile">Your Steam profile link or SteamID64</label>
      <Input
        id="steam-profile"
        v-model="profile"
        placeholder="https://steamcommunity.com/id/yourname"
        autocomplete="off"
        maxlength="200"
        data-testid="steam-profile"
        autofocus
      />
      <p class="text-muted-foreground text-xs leading-relaxed">
        On Steam, your profile's Game details must be set to Public while you import; you can set them back afterwards. The link
        goes to the Tavora service, which asks Steam for your game list and sends it straight back; the service keeps nothing. Tick the box below to keep the link on this PC for next time.
      </p>
      <label class="flex items-center gap-2 text-sm">
        <input v-model="remember" type="checkbox" class="accent-primary size-4" data-testid="steam-remember" />
        Remember this profile on this PC
      </label>
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="steam-import-error">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" @click="dialog = null">Cancel</Button>
        <Button type="submit" data-testid="steam-lookup" :disabled="looking || !profile.trim()">
          {{ looking ? "Looking…" : "Look up games" }}
        </Button>
      </div>
    </form>

    <template v-else>
      <p v-if="games.length === 0" class="text-muted-foreground text-sm" data-testid="steam-import-empty">
        Steam did not list any games for that profile.
      </p>
      <template v-else>
        <div class="flex items-center gap-2">
          <Input v-model="filter" placeholder="Filter" aria-label="Filter games" autocomplete="off" maxlength="80" data-testid="steam-filter" />
          <Button type="button" variant="secondary" :disabled="busy || fresh.length === 0" @click="tickAll(true)">All</Button>
          <Button type="button" variant="secondary" :disabled="busy || fresh.length === 0" @click="tickAll(false)">None</Button>
        </div>
        <ul class="-mx-2 max-h-[300px] overflow-y-auto" aria-label="Steam games" data-testid="steam-list">
          <li v-for="game in shown" :key="game.appid">
            <label
              class="flex items-center gap-3 rounded-md px-2 py-2"
              :class="game.status === 'new' ? 'hover:bg-accent cursor-pointer' : 'text-muted-foreground'"
            >
              <input
                type="checkbox"
                class="accent-primary size-4"
                :checked="game.status === 'new' && ticked.has(game.appid)"
                :disabled="busy || game.status !== 'new'"
                :data-testid="`steam-game-${game.appid}`"
                @change="toggle(game.appid, ($event.target as HTMLInputElement).checked)"
              />
              <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
              <span v-if="game.status !== 'new'" class="flex-none text-xs">{{ status(game) }}</span>
            </label>
          </li>
          <li v-if="shown.length === 0" class="text-muted-foreground px-2 py-2 text-sm">No game matches.</li>
        </ul>
        <p class="text-muted-foreground text-xs" data-testid="steam-summary">
          {{ fresh.length }} new{{ owned ? `, ${owned} already here` : "" }}. {{ count }} selected.
        </p>
      </template>
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="steam-import-error">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" :disabled="busy" @click="back">Back</Button>
        <Button type="button" data-testid="steam-import-submit" :disabled="busy || count === 0" @click="runImport">
          {{ count === 1 ? "Import 1 game" : `Import ${count} games` }}
        </Button>
      </div>
    </template>

    <p class="text-muted-foreground text-xs leading-relaxed">
      Game lists come from Steam. Steam and the Steam logo are trademarks of Valve Corporation; Tavora is not affiliated with,
      endorsed by or sponsored by Valve. Game names belong to their publishers.
    </p>
  </ModalDialog>
</template>
