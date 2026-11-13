<script setup lang="ts">
// Add: a game, or (Personal, on the switch beside the search) a personal workspace that belongs to no game.
//
// Game: one search field. With nothing typed, the covers of the games played lately on this PC, and the rest of
// this PC's games below them; typed, one list: this PC's games, then the built-in and online ones. Enter or a click
// adds the game with Tavora's own modules for it and opens it; a game already added just opens. Keyboard first, in the
// style of Ctrl+K.
//
// Personal: the field takes the new workspace's name, Enter adds it and opens it. Below it, the personal workspaces
// there are, to open one instead. The dialog keeps its size either way.
import { Loader, Search, UserRound } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { act, closeDialog, dialog, openPanels, state } from "../host";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Skeleton } from "@tavora/official-ui/components/ui/skeleton";
import { useTask } from "@tavora/official-ui/use-task";
import { t } from "../i18n";
import { addedWithGame, modulesFor, type PickerLine, type PickerRow } from "../lib/game-picker";
import { noteAdded } from "../lib/installed-games";
import { useGamePicker } from "../lib/use-game-picker";
import GamePickerList from "./GamePickerList.vue";
import WorkspaceIcon from "./WorkspaceIcon.vue";

const query = ref("");
const input = ref<HTMLInputElement | null>(null);
const list = ref<HTMLElement | null>(null);
const shownRequest = dialog.value;
const picker = useGamePicker(query, { covers: true, listId: "game-results", list, search: () => input.value, onEnter: (key) => pick(key) });
const { name, lines, covers, custom, installed, installedLoaded, onlineStatus, info, coverOf, active, activeId, onKey, keepSearchFocus, keysToSearch } = picker;

/** Made-up games for the Skeleton while the games on this PC are found, with names of a few lengths. */
const placeholder = (name: string, index: number): PickerRow => ({ key: `placeholder:${index}`, name, gameId: null, icon: null, installed: null, online: null, workspaceId: null, section: "pc" });
const PLACEHOLDER_COVERS = ["Placeholder", "Game", "Another one", "Game", "One more", "Game"].map(placeholder);
const PLACEHOLDER_LINES: PickerLine[] = ["A game with a long name", "Short game", "A middle one"].map((game, index) => ({ key: `placeholder:${index + 6}`, row: placeholder(game, index + 6) }));

// ── Adding ─────────────────────────────────────────────────────────────

/** Adding the picked game: it always ends, a failure is said under the search and the list works again. */
const adder = useTask({ describe: () => t("error.generic") });
/** The item picked last, by key: while adding it shows the spinner. */
const picked = ref<string | null>(null);
const adding = computed(() => (adder.busy.value ? picked.value : null));
/** The workspaces added here by key, so picking a game again after a module failed doesn't add it twice. */
const made = new Map<string, { id: string; gameId: string | null; asItIs: boolean }>();

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
  const failed = await adder.run(() => add(key, game));
  if (failed) adder.fail(failed);
}

/**
 * Adds the game and its modules, then opens it. A game the user has already (added since the list was found) just
 * opens, and one in Trash comes back with its panels. Answers with what went wrong, or null.
 */
async function add(key: string, game: { row: PickerRow | null; name: string }): Promise<string | null> {
  let done = made.get(key);
  if (!done) {
    const resolved = await picker.addInput(game);
    const added = await act({ type: "add-workspace", ...resolved.input }, { quiet: true });
    if (!added.ok) return added.error;
    if (!added.id) return null;
    // A copy the user has, or one back from Trash, has its panels: nothing to add to it.
    done = { id: added.id, gameId: resolved.gameId, asItIs: added.existing === true || added.restored === true };
    made.set(key, done);
    if (game.row?.installed) noteAdded(game.row.key, done.id);
  }
  const { id, gameId, asItIs } = done;
  // Modules install the way Browse installs them; a failure is shown and the game stays added.
  const moduleIds = asItIs ? [] : addedWithGame(modulesFor(await picker.catalogReady, gameId));
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

// ── Personal ───────────────────────────────────────────────────────────

/** What this adds: a game (the default; most adds are games) or a personal workspace. */
type Mode = "game" | "personal";
const mode = ref<Mode>("game");
const modes = computed(() => [
  { value: "game" as const, label: t("add.mode.game"), testid: "add-mode-game" },
  { value: "personal" as const, label: t("add.mode.personal"), testid: "add-mode-personal" },
]);
const personalName = ref("");
const typedName = computed(() => personalName.value.replace(/\s+/g, " ").trim());
/** The field shows the search or the name, each kept while the other is shown. */
const text = computed({
  get: () => (mode.value === "game" ? query.value : personalName.value),
  set: (value: string) => (mode.value === "game" ? (query.value = value) : (personalName.value = value)),
});
/** The personal workspaces there are, by name. */
const personals = computed(() =>
  Object.values(state.value?.library.workspaces ?? {})
    .filter((workspace) => workspace.kind === "personal")
    .sort((a, b) => a.name.localeCompare(b.name)),
);
// A switch puts the focus back in the field and clears a failure that was about the other one.
watch(mode, () => {
  adder.reset();
  focusSearch();
});

/** Adds the personal workspace by its typed name and opens it. */
async function addPersonal() {
  const name = typedName.value;
  if (!name || adder.busy.value) return;
  picked.value = "personal";
  const failed = await adder.run(async () => {
    const added = await act({ type: "add-workspace", personal: name }, { quiet: true });
    if (!added.ok) return added.error;
    if (dialog.value !== shownRequest) return null;
    closeDialog(shownRequest);
    if (added.id && state.value?.library.onboarded) await act({ type: "open-workspace", workspaceId: added.id });
    return null;
  });
  if (failed) adder.fail(failed);
}

async function openPersonal(workspaceId: string) {
  if (adder.busy.value) return;
  closeDialog(shownRequest);
  await act({ type: "open-workspace", workspaceId });
}

/**
 * The field's keys: Tab switches between Game and Personal (Shift+Tab still moves the focus, so the switch and the
 * footer stay in reach); then the search's keys in Game, and in Personal, Enter adds.
 */
function onFieldKey(event: KeyboardEvent) {
  if (event.key === "Tab" && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault();
    if (!adder.busy.value) mode.value = mode.value === "game" ? "personal" : "game";
    return;
  }
  if (mode.value === "game") return onKey(event);
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  void addPersonal();
}

/** Keys pressed elsewhere in the dialog go to the search, in Game. */
function onDialogKey(event: KeyboardEvent) {
  if (mode.value === "game") keysToSearch(event);
}
</script>

<template>
  <Dialog :open="true" @update:open="(open) => !open && closeDialog(shownRequest)">
    <!-- In the middle of the window, as Settings is. The search and the footer stay put; the covers and the list between
         them scroll. One height whatever it shows
         (six covers and ten games fit), so the dialog never jumps while you type. -->
    <DialogContent
      class="bg-card top-[calc(50%+env(titlebar-area-height,0px)/2)] flex h-[min(944px,calc(100vh-env(titlebar-area-height,0px)-48px))] w-[min(920px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="add-game-dialog"
      :data-status="adder.state.value.status"
      :show-close-button="false"
      @open-auto-focus.prevent="focusSearch"
      @mousedown="keepSearchFocus"
      @keydown="onDialogKey"
    >
      <DialogTitle class="sr-only">{{ mode === "game" ? t("addGame.title") : t("addPersonal.new") }}</DialogTitle>
      <DialogDescription class="sr-only">{{ mode === "game" ? t("addGame.search") : t("addPersonal.placeholder") }}</DialogDescription>
      <div class="relative flex flex-none items-center gap-3 border-b pr-3">
        <component :is="mode === 'game' ? Search : UserRound" class="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" :stroke-width="1.5" />
        <input
          id="game-search"
          ref="input"
          v-model="text"
          class="placeholder:text-muted-foreground h-14 min-w-0 flex-1 bg-transparent pr-2 pl-12 text-base focus-visible:outline-none"
          :placeholder="mode === 'game' ? t('addGame.search') : t('addPersonal.placeholder')"
          :aria-label="mode === 'game' ? t('addGame.title') : t('addPersonal.new')"
          :role="mode === 'game' ? 'combobox' : undefined"
          :aria-expanded="mode === 'game' ? 'true' : undefined"
          :aria-controls="mode === 'game' ? 'game-results' : undefined"
          :aria-autocomplete="mode === 'game' ? 'list' : undefined"
          :aria-activedescendant="mode === 'game' ? activeId : undefined"
          autocomplete="off"
          spellcheck="false"
          maxlength="80"
          :data-testid="mode === 'game' ? 'game-search' : 'personal-name'"
          @keydown="onFieldKey"
        />
        <!-- Games come first; Personal is for the odd workspace that belongs to no game. -->
        <SegmentedControl v-model="mode" :options="modes" :label="t('add.mode')" :disabled="adder.busy.value" data-testid="add-mode" />
      </div>

      <div ref="list" class="min-h-0 flex-1 overflow-y-auto py-2">
        <Notice v-if="adder.error.value" variant="error" class="mx-4 mb-2" data-testid="add-game-error">{{ adder.error.value }}</Notice>
        <template v-if="mode === 'game'">
        <p v-if="!installedLoaded" class="text-muted-foreground flex items-center gap-2 px-5 pb-1 text-xs font-medium" role="status" data-testid="add-game-loading">
          <Loader class="size-3.5 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.75" aria-hidden="true" />{{ t("addGame.loadingPc") }}
        </p>
        <!-- While the games on this PC are found, the list drawn with made-up games; typing still searches, and its results show. -->
        <Skeleton v-if="!installedLoaded && !name" :loading="true" data-testid="add-game-skeleton">
          <GamePickerList id="game-results-placeholder" :label="t('common.games')" :covers="PLACEHOLDER_COVERS" :lines="PLACEHOLDER_LINES" :active="null" :custom="null" :typed="false" :info="() => ({ modules: 0, when: null })" />
        </Skeleton>
        <GamePickerList
          v-else
          id="game-results"
          :label="t('common.games')"
          :covers="covers"
          :lines="lines"
          :active="active"
          :custom="custom"
          :typed="!!name"
          :info="info"
          :cover-of="coverOf"
          :adding="adding"
          @hover="active = $event"
          @pick="pick"
        />
        <p v-if="installedLoaded && !covers.length && !lines.length" class="text-muted-foreground px-5 py-4 text-sm" data-testid="add-game-empty">
          {{ installed.length ? t("addGame.allAdded") : t("addGame.nothingOnPc") }}
        </p>
        <p v-if="onlineStatus === 'unreachable' && name" class="text-muted-foreground px-5 py-2 text-xs" data-testid="online-unreachable">{{ t("addGame.builtInOnly") }}</p>
        </template>

        <div v-else class="flex flex-col gap-1 px-2" data-testid="add-personal" :data-status="adder.state.value.status">
          <button
            v-if="typedName"
            type="button"
            class="bg-accent relative flex items-center gap-3 rounded-lg px-3 py-2 text-left"
            data-testid="create-personal"
            @click="addPersonal"
          >
            <span class="bg-primary absolute inset-y-1.5 left-0 w-0.5 rounded-full" aria-hidden="true" />
            <span class="bg-background text-primary flex size-7 flex-none items-center justify-center rounded-md" aria-hidden="true"><UserRound class="size-4" :stroke-width="1.75" /></span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium">{{ typedName }}</span>
              <span class="text-muted-foreground block truncate text-xs">{{ adder.busy.value ? t("addGame.adding") : t("addPersonal.new") }}</span>
            </span>
            <Loader v-if="adder.busy.value" class="text-muted-foreground size-4 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.75" aria-hidden="true" />
            <span v-else class="text-muted-foreground flex flex-none items-center gap-1.5 text-xs" aria-hidden="true">{{ t("addGame.actionAdd") }} <Kbd class="font-sans">↵</Kbd></span>
          </button>
          <p v-else class="text-muted-foreground px-3 py-2 text-sm" data-testid="personal-type-name">{{ t("addPersonal.typeName") }}</p>

          <template v-if="personals.length">
            <p class="text-muted-foreground px-3 pt-3 pb-1 text-xs font-medium">{{ t("addPersonal.yours") }}</p>
            <button
              v-for="workspace in personals"
              :key="workspace.id"
              type="button"
              class="hover:bg-accent group flex items-center gap-3 rounded-lg px-3 py-2 text-left"
              :data-testid="`open-personal-${workspace.id}`"
              @click="openPersonal(workspace.id)"
            >
              <span class="flex flex-none overflow-hidden rounded-md"><WorkspaceIcon :workspace="workspace" :size="28" /></span>
              <span class="min-w-0 flex-1 truncate font-medium">{{ workspace.name }}</span>
              <span class="text-muted-foreground flex-none text-xs opacity-0 group-hover:opacity-100">{{ t("addGame.actionOpen") }}</span>
            </button>
          </template>
        </div>
      </div>

      <div v-if="mode === 'personal'" class="text-muted-foreground flex flex-none items-center border-t px-4 py-2 text-xs">
        <span aria-hidden="true"
          ><Kbd class="font-sans">{{ t("search.key.enter") }}</Kbd> {{ t("addGame.hint.add") }} · <Kbd class="font-sans">{{ t("search.key.tab") }}</Kbd> {{ t("add.mode.game") }}</span
        >
      </div>
      <div v-else class="text-muted-foreground flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs">
        <span aria-hidden="true"
          ><template v-if="covers.length"><Kbd class="font-sans">←</Kbd> <Kbd class="font-sans">→</Kbd> </template><Kbd class="font-sans">↑</Kbd> <Kbd class="font-sans">↓</Kbd>
          {{ t("addGame.hint.move") }} · <Kbd class="font-sans">{{ t("search.key.enter") }}</Kbd> {{ t("addGame.hint.add") }} · <Kbd class="font-sans">{{ t("search.key.tab") }}</Kbd>
          {{ t("add.mode.personal") }}</span
        >
        <span class="ml-auto flex gap-4">
          <button type="button" class="text-primary underline-offset-2 hover:underline" data-testid="open-steam-import" @click="dialog = { kind: 'steam-import' }">{{ t("addGame.steam") }}</button>
        </span>
      </div>
    </DialogContent>
  </Dialog>
</template>
