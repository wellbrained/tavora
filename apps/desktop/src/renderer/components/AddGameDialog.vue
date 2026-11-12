<script setup lang="ts">
// Add a game: one search field. With nothing typed, the covers of the games played lately on this PC, and the rest of
// this PC's games below them; typed, one list: this PC's games, then the built-in and online ones. Enter or a click
// adds the game with Tavora's own modules for it and opens it; a game already added just opens. Keyboard first, in the
// style of Ctrl+K.
import { Loader, Search } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
import { act, closeDialog, dialog, openPanels, state } from "../host";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { Skeleton } from "@tavora/official-ui/components/ui/skeleton";
import { useTask } from "@tavora/official-ui/use-task";
import { t } from "../i18n";
import { addedWithGame, addInputFor, modulesFor, type PickerRow } from "../lib/game-picker";
import { useGamePicker } from "../lib/use-game-picker";
import GamePickerList from "./GamePickerList.vue";

const query = ref("");
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const shownRequest = dialog.value;
const picker = useGamePicker(query, { covers: true, listId: "game-results", list, onEnter: (key) => pick(key) });
const { name, listRows, covers, custom, installedLoaded, onlineStatus, info, coverOf, active, activeId, onKey } = picker;

/** Made-up games for the Skeleton while the games on this PC are found, with names of a few lengths. */
const placeholder = (name: string, index: number): PickerRow => ({ key: `placeholder:${index}`, name, gameId: null, icon: null, installed: null, online: null, workspaceId: null, section: "pc" });
const PLACEHOLDER_COVERS = ["Placeholder", "Game", "Another one", "Game"].map(placeholder);
const PLACEHOLDER_ROWS = ["A game with a long name", "Short game", "A middle one"].map((game, index) => placeholder(game, index + 4));

// ── Adding ─────────────────────────────────────────────────────────────

/** Adding the picked game: it always ends, a failure is said under the search and the list works again. */
const adder = useTask({ describe: () => t("error.generic") });
/** The item picked last, by key: while adding it shows the spinner. */
const picked = ref<string | null>(null);
const adding = computed(() => (adder.busy.value ? picked.value : null));
/** The workspaces added here by key, so picking a game again after a module failed doesn't add it twice. */
const made = new Map<string, string>();

/** Enter, or a click: opens a game the user has, else adds it with Tavora's own modules for it and opens it. */
async function pick(key: string) {
  const game = picker.target(key);
  if (adder.busy.value || !game) return;
  active.value = key;
  picked.value = key;
  if (game.row?.workspaceId) {
    closeDialog(shownRequest);
    await act({ type: "open-workspace", workspaceId: game.row.workspaceId });
    return;
  }
  const failed = await adder.run(() => add(key, game.row));
  if (failed) adder.fail(failed);
}

/** Adds the game (or brings its copy back from Trash) and its modules, then opens it. Answers with what went wrong, or null. */
async function add(key: string, row: PickerRow | null): Promise<string | null> {
  let id = made.get(key);
  let restored = false;
  if (id === undefined) {
    const added = await act({ type: "add-workspace", ...addInputFor(row, name.value) }, { quiet: true });
    if (!added.ok) return added.error;
    if (!added.id) return null;
    id = added.id;
    made.set(key, id);
    // A copy back from Trash has its panels: nothing to add to it.
    restored = added.restored === true;
  }
  // Modules install the way Browse installs them; a failure is shown and the game stays added.
  const moduleIds = restored ? [] : addedWithGame(modulesFor(await picker.catalogReady, row?.gameId ?? null));
  for (const moduleId of moduleIds) {
    if (state.value?.modules.some((module) => module.id === moduleId)) continue;
    const result = await act({ type: "install-catalog-module", moduleId }, { quiet: true });
    if (!result.ok) return result.error;
  }
  // Closed meanwhile: the game and its modules are added, but the user is not taken anywhere and whatever is shown now stays.
  if (dialog.value !== shownRequest) return null;
  closeDialog(shownRequest);
  // A new workspace starts with its starter panels; take the user there, unless they are still in the first-run
  // welcome, which lists it. Its modules need the workspace open to add their panels.
  if (state.value?.library.onboarded || moduleIds.length) await act({ type: "open-workspace", workspaceId: id });
  for (const moduleId of moduleIds) await openPanels(moduleId, null, []);
  return null;
}

function focusSearch() {
  void nextTick(() => input.value?.focus());
}
</script>

<template>
  <Dialog :open="true" @update:open="(open) => !open && closeDialog(shownRequest)">
    <!-- The search and the footer stay put; the covers and the list between them scroll. -->
    <DialogContent
      class="bg-card top-[8vh] flex max-h-[calc(100vh-8vh-16px)] w-[min(640px,calc(100vw-48px))] max-w-none translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="add-game-dialog"
      :data-status="adder.state.value.status"
      :show-close-button="false"
      @open-auto-focus.prevent="focusSearch"
    >
      <DialogTitle class="sr-only">{{ t("addGame.title") }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t("addGame.search") }}</DialogDescription>
      <div class="relative flex-none border-b">
        <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" :stroke-width="1.5" />
        <input
          id="game-search"
          ref="input"
          v-model="query"
          class="placeholder:text-muted-foreground h-14 w-full bg-transparent pr-16 pl-12 text-base focus-visible:outline-none"
          :placeholder="t('addGame.search')"
          :aria-label="t('addGame.title')"
          role="combobox"
          aria-expanded="true"
          aria-controls="game-results"
          aria-autocomplete="list"
          :aria-activedescendant="activeId"
          autocomplete="off"
          spellcheck="false"
          maxlength="80"
          data-testid="game-search"
          @keydown="onKey"
        />
        <Kbd class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-sans" aria-hidden="true">{{ t("search.key.esc") }}</Kbd>
      </div>

      <div ref="list" tabindex="-1" class="min-h-0 flex-1 overflow-y-auto py-2 focus-visible:outline-none">
        <p v-if="adder.error.value" class="text-destructive px-5 pb-2 text-sm" role="alert" data-testid="add-game-error">{{ adder.error.value }}</p>
        <p v-if="!installedLoaded" class="text-muted-foreground flex items-center gap-2 px-5 pb-1 text-xs font-medium" role="status" data-testid="add-game-loading">
          <Loader class="size-3.5 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.75" aria-hidden="true" />{{ t("addGame.loadingPc") }}
        </p>
        <!-- While the games on this PC are found, the list drawn with made-up games; typing still searches, and its results show. -->
        <Skeleton v-if="!installedLoaded && !name" :loading="true" data-testid="add-game-skeleton">
          <GamePickerList id="game-results-placeholder" :label="t('common.games')" :covers="PLACEHOLDER_COVERS" :rows="PLACEHOLDER_ROWS" :active="null" :custom="null" :typed="false" :info="() => ({ modules: 0, when: null })" />
        </Skeleton>
        <GamePickerList
          v-else
          id="game-results"
          :label="t('common.games')"
          :covers="covers"
          :rows="listRows"
          :active="active"
          :custom="custom"
          :typed="!!name"
          :info="info"
          :cover-of="coverOf"
          :adding="adding"
          @hover="active = $event"
          @pick="pick"
        />
        <p v-if="installedLoaded && !covers.length && !listRows.length && !custom" class="text-muted-foreground px-5 py-4 text-sm" data-testid="add-game-empty">{{ t("addGame.nothingOnPc") }}</p>
        <p v-if="onlineStatus === 'unreachable' && name" class="text-muted-foreground px-5 py-2 text-xs" data-testid="online-unreachable">{{ t("addGame.builtInOnly") }}</p>
      </div>

      <div class="text-muted-foreground flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs">
        <span aria-hidden="true"
          ><template v-if="covers.length"><Kbd class="font-sans">←</Kbd> <Kbd class="font-sans">→</Kbd> </template><Kbd class="font-sans">↑</Kbd> <Kbd class="font-sans">↓</Kbd>
          {{ t("addGame.hint.move") }} · <Kbd class="font-sans">{{ t("search.key.enter") }}</Kbd> {{ t("addGame.hint.add") }}</span
        >
        <span class="ml-auto flex gap-4">
          <button type="button" class="text-primary underline-offset-2 hover:underline" data-testid="open-steam-import" @click="dialog = { kind: 'steam-import' }">{{ t("addGame.steam") }}</button>
        </span>
      </div>
    </DialogContent>
  </Dialog>
</template>
