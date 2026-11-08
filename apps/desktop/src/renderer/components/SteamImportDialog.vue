<script setup lang="ts">
import { Download, Gamepad2, Search, Upload } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { useTask } from "@tavora/official-ui/use-task";
import type { SteamGameView } from "../../shared/host-api";
import { act, api, closeDialog, dialog, showToast, state } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const profile = ref(state.value?.library.steamProfile ?? "");
// Remembered on this PC only, and only once a lookup worked.
const remember = ref(state.value?.library.steamProfile != null);
const games = ref<SteamGameView[] | null>(null);
const ticked = ref(new Set<number>());
const filter = ref("");
// One thing at a time: the look-up while no list is shown, then the import. The step says which one runs.
const task = useTask({ describe: () => t("error.generic") });
const looking = computed(() => !games.value && task.busy.value);
const busy = computed(() => !!games.value && task.busy.value);
const error = task.error;
const shownRequest = dialog.value;

const fresh = computed(() => (games.value ?? []).filter((game) => game.status === "new"));
const shown = computed(() => {
  const text = filter.value.trim().toLowerCase();
  return (games.value ?? []).filter((game) => !text || game.name.toLowerCase().includes(text));
});
const count = computed(() => fresh.value.filter((game) => ticked.value.has(game.appid)).length);
const owned = computed(() => (games.value?.length ?? 0) - fresh.value.length);

async function lookUp() {
  if (!profile.value.trim()) return;
  const result = await task.run(() => api.steamLibrary(profile.value));
  if (!result) return;
  if (result.status === "error") return task.fail(result.error);
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
  task.reset();
}

async function runImport() {
  const chosen = fresh.value.filter((game) => ticked.value.has(game.appid)).map(({ appid, name, id }) => ({ appid, name, id }));
  const result = await task.run(() => act({ type: "import-steam-games", games: chosen }, { quiet: true }));
  if (!result) return;
  if (!result.ok) return task.fail(result.error);
  // Closed meanwhile: the games were added all the same, and whatever is shown now stays.
  closeDialog(shownRequest);
  const added = result.added ?? 0;
  showToast(added === 0 ? t("steamImport.added.zero") : t("steamImport.added", { count: added }));
}

/** Offers the selected games' icons without adding them: the share dialog finds which ones this PC has. */
function shareOnly() {
  const appids = fresh.value.filter((game) => ticked.value.has(game.appid)).map((game) => game.appid);
  dialog.value = { kind: "share-icons", workspaceIds: [], steam: appids };
}

const status = (game: SteamGameView) => (game.status === "trash" ? t("steamImport.trash") : t("steamImport.owned"));
</script>

<template>
  <ModalDialog
    :title="t('steamImport.title')"
    :description="t('steamImport.description')"
    :icon="Gamepad2"
    testid="steam-import-dialog"
    class="sm:max-w-[500px]"
    :status="task.state.value.status"
    @close="dialog = null"
  >
    <div class="flex flex-col gap-4">
    <form v-if="!games" id="steam-lookup-form" class="flex flex-col gap-3" @submit.prevent="lookUp">
      <label class="text-sm" for="steam-profile">{{ t("steamImport.profile") }}</label>
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
        {{ t("steamImport.profileHelp") }}
      </p>
      <label class="flex items-center gap-2 text-sm">
        <Checkbox v-model="remember" data-testid="steam-remember" />
        {{ t("steamImport.remember") }}
      </label>
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="steam-import-error">{{ error }}</p>
    </form>

    <template v-else>
      <p v-if="games?.length === 0" class="text-muted-foreground text-sm" data-testid="steam-import-empty">
        {{ t("steamImport.empty") }}
      </p>
      <template v-else>
        <div class="flex items-center gap-2">
          <Input v-model="filter" :placeholder="t('steamImport.filter')" :aria-label="t('steamImport.filterLabel')" autocomplete="off" maxlength="80" data-testid="steam-filter" />
          <Button type="button" variant="secondary" :disabled="busy || fresh.length === 0" @click="tickAll(true)">{{ t("steamImport.all") }}</Button>
          <Button type="button" variant="secondary" :disabled="busy || fresh.length === 0" @click="tickAll(false)">{{ t("steamImport.none") }}</Button>
        </div>
        <ul class="-mx-2 max-h-[300px] overflow-y-auto" :aria-label="t('steamImport.list')" data-testid="steam-list">
          <li v-for="game in shown" :key="game.appid">
            <label
              class="flex items-center gap-3 rounded-md px-2 py-2"
              :class="game.status === 'new' ? 'hover:bg-accent cursor-pointer' : 'text-muted-foreground'"
            >
              <Checkbox
                :model-value="game.status === 'new' && ticked.has(game.appid)"
                :disabled="busy || game.status !== 'new'"
                :data-testid="`steam-game-${game.appid}`"
                @update:model-value="(checked) => toggle(game.appid, checked === true)"
              />
              <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
              <span v-if="game.status !== 'new'" class="flex-none text-xs">{{ status(game) }}</span>
            </label>
          </li>
          <li v-if="shown.length === 0" class="text-muted-foreground px-2 py-2 text-sm">{{ t("steamImport.noMatch") }}</li>
        </ul>
        <p class="text-muted-foreground text-xs" data-testid="steam-summary">
          {{ t("steamImport.summary", { fresh: fresh.length, owned: owned ? t("steamImport.summaryOwned", { owned }) : "", count }) }}
        </p>
      </template>
      <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="steam-import-error">{{ error }}</p>
    </template>

    <p class="text-muted-foreground text-xs leading-relaxed">
      {{ t("steamImport.trademark") }}
    </p>
    </div>
    <DialogFooter v-if="!games">
      <DialogButton type="button" close @click="dialog = null">{{ t("common.cancel") }}</DialogButton>
      <DialogButton type="submit" form="steam-lookup-form" :icon="Search" :loading="looking" data-testid="steam-lookup" :disabled="looking || !profile.trim()">
        {{ looking ? t("steamImport.looking") : t("steamImport.lookUp") }}
      </DialogButton>
    </DialogFooter>
    <DialogFooter v-else>
      <DialogButton type="button" close :variant="games.length > 0 ? 'secondary' : 'default'" :disabled="busy" data-testid="steam-back" @click="back">{{ t("common.back") }}</DialogButton>
      <DialogButton
        v-if="games.length > 0"
        type="button"
        variant="secondary"
        :icon="Upload"
        data-testid="steam-share-only"
        :title="t('steamImport.shareOnlyHelp')"
        :disabled="busy || count === 0 || !state?.library.steamIcons"
        @click="shareOnly"
      >
        {{ t("steamImport.shareOnly") }}
      </DialogButton>
      <DialogButton v-if="games.length > 0" type="button" :icon="Download" data-testid="steam-import-submit" :disabled="busy || count === 0" @click="runImport">
        {{ t("steamImport.import", { count }) }}
      </DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
