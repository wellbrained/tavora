<script setup lang="ts">
import { Loader } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { MAX_SHARE_BATCH } from "../../shared/host-actions";
import type { HostAction } from "../../shared/host-api";
import { account, act, api, dialog, openSettings, showToast, state, type ShareIconsRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ request: ShareIconsRequest }>();

/** Most icons in one action; more are sent in turns. */
const BATCH = MAX_SHARE_BATCH;

interface Row {
  key: string;
  name: string;
  icon: string;
}

const steam = props.request.steam;
/** The games of the Steam import with an icon on this PC, once main has looked. */
const steamRows = ref<Row[] | null>(null);
const looking = ref(steam !== undefined);

// Every game whose own icon Tavora does not have yet, with the icon this PC has for it.
const rows = computed<Row[]>(() => {
  if (steam) return steamRows.value ?? [];
  return Object.values(state.value!.library.games)
    .filter((game) => game.shareIcon !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((game) => ({ key: game.id, name: game.name, icon: game.shareIcon! }));
});

const ticked = ref(new Set<string>(props.request.gameIds));
const busy = ref(false);
const progress = ref<{ done: number; total: number } | null>(null);
const error = ref<string | null>(null);
const chosen = computed(() => rows.value.filter((row) => ticked.value.has(row.key)));
/** Only signed-in players can share. */
const signedIn = computed(() => Boolean(account.value?.account));

function signIn() {
  dialog.value = null;
  openSettings({ section: "account" });
}
const count = computed(() => chosen.value.length);
/** Nothing found to share: the dialog says just that and offers Close. */
const empty = computed(() => !looking.value && !error.value && rows.value.length === 0);
const description = computed(() => {
  if (looking.value || error.value) return undefined;
  if (empty.value) return t("shareIcons.empty");
  return t(steam ? "shareIcons.foundSteam" : "shareIcons.found", { count: rows.value.length });
});

onMounted(async () => {
  if (!steam) return;
  const result = await api.steamShareIcons(steam);
  looking.value = false;
  if (result.status === "error") {
    error.value = result.error;
    steamRows.value = [];
    return;
  }
  steamRows.value = result.games.map((game) => ({ key: String(game.appid), name: game.name, icon: game.icon }));
  // Everything is ticked at first: the player asked for these games.
  ticked.value = new Set(steamRows.value.map((row) => row.key));
});

function toggle(key: string, on: boolean) {
  const next = new Set(ticked.value);
  if (on) next.add(key);
  else next.delete(key);
  ticked.value = next;
}

function tickAll(on: boolean) {
  ticked.value = on ? new Set(rows.value.map((row) => row.key)) : new Set();
}

async function share() {
  busy.value = true;
  error.value = null;
  const keys = chosen.value.map((row) => row.key);
  let shared = 0;
  let sentAny = false;
  progress.value = { done: 0, total: keys.length };
  for (let at = 0; at < keys.length; at += BATCH) {
    const part = keys.slice(at, at + BATCH);
    const action: HostAction = steam ? { type: "share-steam-icons", appids: part.map(Number) } : { type: "share-icons", gameIds: part };
    const result = await act(action, { quiet: true });
    if (!result.ok) {
      // Once a turn went through, a later one with nothing left to send changes nothing.
      if (sentAny) continue;
      error.value = result.error;
      break;
    }
    sentAny = true;
    shared += result.shared ?? 0;
    progress.value = { done: Math.min(at + BATCH, keys.length), total: keys.length };
    if (result.limited) {
      // The service takes only so many an hour: the rest stay to be shared later.
      busy.value = false;
      progress.value = null;
      dialog.value = null;
      showToast(t("shareIcons.limited", { count: shared }));
      return;
    }
  }
  busy.value = false;
  progress.value = null;
  if (!sentAny) return;
  dialog.value = null;
  showToast(shared ? t("shareIcons.thanks") : t("shareIcons.nothingNeeded"));
}
</script>

<template>
  <ModalDialog
    :title="t('shareIcons.title')"
    :description="description"
    testid="share-icons-dialog"
    class="sm:max-w-[460px]"
    @close="dialog = null"
  >
    <p v-if="looking" class="text-muted-foreground text-sm" data-testid="share-icons-looking">{{ t("shareIcons.looking") }}</p>
    <template v-else-if="rows.length">
      <div class="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" data-testid="share-icons-all" :disabled="busy || count === rows.length" @click="tickAll(true)">
          {{ t("shareIcons.all") }}
        </Button>
        <Button type="button" variant="secondary" size="sm" data-testid="share-icons-none" :disabled="busy || count === 0" @click="tickAll(false)">
          {{ t("shareIcons.none") }}
        </Button>
      </div>
      <ul class="-mx-2 max-h-[280px] overflow-y-auto" :aria-label="t('shareIcons.list')">
        <li v-for="row in rows" :key="row.key">
          <label class="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md px-2 py-2">
            <Checkbox :model-value="ticked.has(row.key)" :disabled="busy" :data-testid="`share-icon-${row.key}`" @update:model-value="toggle(row.key, $event === true)" />
            <img :src="row.icon" alt="" class="bg-secondary size-10 flex-none rounded-lg object-contain p-1" draggable="false" />
            <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
          </label>
        </li>
      </ul>
    </template>

    <div v-if="!steam" class="flex items-center justify-between gap-3">
      <p class="text-muted-foreground text-xs">{{ t("shareIcons.fromSteamHelp") }}</p>
      <Button type="button" variant="secondary" size="sm" class="flex-none" data-testid="share-icons-from-steam" :disabled="busy" @click="dialog = { kind: 'steam-import' }">
        {{ t("shareIcons.fromSteam") }}
      </Button>
    </div>

    <p v-if="!empty" class="text-muted-foreground text-xs leading-relaxed">
      {{ t("shareIcons.notice") }}
    </p>
    <p v-if="!empty && !signedIn" class="text-sm" data-testid="share-icons-sign-in">{{ t("shareIcons.signIn") }}</p>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="share-icons-error">{{ error }}</p>
    <div class="flex items-center justify-end gap-2">
      <span v-if="progress" class="text-muted-foreground mr-auto flex items-center gap-2 text-sm tabular-nums" role="status" data-testid="share-icons-progress">
        <Loader class="size-4 animate-spin motion-reduce:animate-none" :stroke-width="1.5" aria-hidden="true" />
        {{ t("shareIcons.progress", progress) }}
      </span>
      <Button type="button" variant="secondary" :disabled="busy" @click="dialog = null">{{ empty ? t("common.close") : t("common.cancel") }}</Button>
      <Button v-if="!empty && !signedIn" type="button" data-testid="share-icons-sign-in-button" @click="signIn">{{ t("account.signIn") }}</Button>
      <Button v-else-if="!empty" type="button" data-testid="share-icons-submit" :disabled="busy || looking || count === 0" @click="share">
        {{ t("shareIcons.submit", { count: Math.max(count, 1) }) }}
      </Button>
    </div>
  </ModalDialog>
</template>
