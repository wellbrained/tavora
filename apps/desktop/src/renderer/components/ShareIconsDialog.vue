<script setup lang="ts">
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import type { GameView } from "../../shared/host-api";
import { act, dialog, showToast, state, type ShareIconsRequest } from "../host";
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
    result.shared
      ? "Thank you. A person at Tavora checks each icon before anyone else sees it."
      : "Tavora does not need those icons right now.",
  );
}
</script>

<template>
  <ModalDialog
    title="Share icons with Tavora"
    description="Tavora does not have these games' icons yet. Share the icon your PC has, so other players can see it too."
    testid="share-icons-dialog"
    class="sm:max-w-[460px]"
    @close="dialog = null"
  >
    <ul v-if="games.length" class="-mx-2 max-h-[280px] overflow-y-auto" aria-label="Games with an icon to share">
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
      There is nothing to share right now. Games whose own icon Tavora already has, or that have none on this PC, are not listed.
    </p>

    <p class="text-muted-foreground text-xs leading-relaxed">
      Only the icon file, the game's id and its name are sent. Nothing that identifies you. A person at Tavora checks every
      icon before anyone else sees it. Game names and icons belong to their publishers; Tavora is not affiliated with them.
    </p>
    <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="share-icons-error">{{ error }}</p>
    <div class="flex justify-end gap-2">
      <Button type="button" variant="secondary" @click="dialog = null">Cancel</Button>
      <Button type="button" data-testid="share-icons-submit" :disabled="busy || count === 0" @click="share">
        {{ count > 1 ? `Share ${count} icons` : "Share icon" }}
      </Button>
    </div>
  </ModalDialog>
</template>
