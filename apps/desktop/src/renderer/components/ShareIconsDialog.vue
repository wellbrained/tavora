<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import type { GameView } from "../../shared/host-api";
import { act, dialog, showToast, state, type ShareIconsRequest } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ request: ShareIconsRequest }>();

// Every game whose own icon Tavora does not have yet, with the icon this PC has for it.
const games = computed<GameView[]>(() =>
  Object.values(state.value!.library.games)
    .filter((game) => game.shareIcon !== null)
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const ticked = ref(new Set(props.request.gameIds));
const busy = ref(false);
const error = ref<string | null>(null);
const count = computed(() => games.value.filter((game) => ticked.value.has(game.id)).length);

function toggle(id: string, on: boolean) {
  const next = new Set(ticked.value);
  if (on) next.add(id);
  else next.delete(id);
  ticked.value = next;
}

async function share() {
  busy.value = true;
  error.value = null;
  const gameIds = games.value.filter((game) => ticked.value.has(game.id)).map((game) => game.id);
  const result = await act({ type: "share-icons", gameIds }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    error.value = result.error;
    return;
  }
  dialog.value = null;
  showToast(
    result.shared ? t("shareIcons.thanks") : t("shareIcons.nothingNeeded"),
  );
}
</script>

<template>
  <ModalDialog
    :title="t('shareIcons.title')"
    :description="t('shareIcons.description')"
    testid="share-icons-dialog"
    class="sm:max-w-[460px]"
    @close="dialog = null"
  >
    <ul v-if="games.length" class="-mx-2 max-h-[280px] overflow-y-auto" :aria-label="t('shareIcons.list')">
      <li v-for="game in games" :key="game.id">
        <label class="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md px-2 py-2">
          <input
            type="checkbox"
            class="accent-primary size-4"
            :checked="ticked.has(game.id)"
            :disabled="busy"
            :data-testid="`share-icon-${game.id}`"
            @change="toggle(game.id, ($event.target as HTMLInputElement).checked)"
          />
          <img :src="game.shareIcon!" alt="" class="bg-secondary size-10 flex-none rounded-lg object-contain p-1" draggable="false" />
          <span class="min-w-0 flex-1 truncate">{{ game.name }}</span>
        </label>
      </li>
    </ul>
    <p v-else class="text-muted-foreground text-sm" data-testid="share-icons-empty">
      {{ t("shareIcons.empty") }}
    </p>

    <p class="text-muted-foreground text-xs leading-relaxed">
      {{ t("shareIcons.notice") }}
    </p>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="share-icons-error">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" @click="dialog = null">{{ t("common.cancel") }}</Button>
      <Button type="button" data-testid="share-icons-submit" :disabled="busy || count === 0" @click="share">
        {{ t("shareIcons.submit", { count: Math.max(count, 1) }) }}
      </Button>
    </div>
  </ModalDialog>
</template>
