<script setup lang="ts">
// Add a game: one search field, the games on this PC (most recently played first) on the left, and for the
// highlighted game a panel on the right with the modules made for it to tick. Enter adds the game and the
// ticked modules. Keyboard first, in the style of Ctrl+K.
import { Loader, Search } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { act, dialog, openPanels, state } from "../host";
import { useListNav } from "@/lib/list-nav";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { t } from "../i18n";
import { addInputFor, defaultTicks, type PickerRow } from "../lib/game-picker";
import { useGamePicker, whenOf } from "../lib/use-game-picker";
import CatalogIcon from "./CatalogIcon.vue";
import GamePickerList, { type PickerBadge } from "./GamePickerList.vue";
import GameTile from "./GameTile.vue";

const query = ref("");
const { name, rows, custom, count, installedLoaded, onlineStatus, catalogModules, modulesOf } = useGamePicker(query);
const error = ref<string | null>(null);
const busy = ref(false);
const ownHint = ref(false);
const input = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);

/** Placeholder rows shown while the games on this PC are found, with a few widths so they do not look stamped. */
const SKELETON_ROWS = 6;
const SKELETON_WIDTHS = [48, 36, 58, 42, 52, 32];

const optionId = (index: number) => `game-results-option-${index}`;

// The row in front is highlighted again whenever the list of results changes.
const { active, onKey } = useListNav({ count: () => count.value, list, onEnter: () => void pick(active.value) });
watch(
  () => rows.value.map((row) => row.key).join("\n") + (custom.value ?? ""),
  () => (active.value = 0),
);
const activeId = computed(() => (count.value ? optionId(Math.min(active.value, count.value - 1)) : undefined));
const activeRow = computed<PickerRow | null>(() => rows.value[active.value] ?? null);

// ── Modules ────────────────────────────────────────────────────────────

const panelModules = computed(() => modulesOf(activeRow.value));
/** What the user ticked per game while this dialog is open; a game not touched has Tavora's own modules ticked. */
const ticked = ref<Record<string, string[]>>({});
const ticksOf = (row: PickerRow | null): string[] => (row ? (ticked.value[row.key] ?? defaultTicks(modulesOf(row))) : []);
const panelTicks = computed(() => ticksOf(activeRow.value));

function toggle(moduleId: string, on: boolean) {
  const row = activeRow.value;
  if (!row) return;
  const rest = ticksOf(row).filter((id) => id !== moduleId);
  ticked.value = { ...ticked.value, [row.key]: on ? [...rest, moduleId] : rest };
}

// ── Words ──────────────────────────────────────────────────────────────

const info = (row: PickerRow): PickerBadge => ({ modules: modulesOf(row).length, when: whenOf(row) });
const addLabel = computed(() => (activeRow.value?.workspaceId ? t("addGame.open") : panelTicks.value.length && activeRow.value ? t("addGame.addWith", { count: panelTicks.value.length }) : t("addGame.add")));
const lineOf = (row: PickerRow | null) => {
  if (!row) return t("addGame.line.own");
  const where = row.installed ? t("addGame.line.pc") : t("addGame.line.list");
  const when = whenOf(row);
  return when ? `${where} · ${when}` : where;
};

// ── Adding ─────────────────────────────────────────────────────────────

/** Enter, or a click: opens a game the user has, else adds the game and the ticked modules. */
async function pick(index: number) {
  if (busy.value) return;
  const row = rows.value[index];
  if (row) await confirm(row);
  else if (custom.value) await confirm(null);
}

async function confirm(row: PickerRow | null) {
  busy.value = true;
  error.value = null;
  try {
    if (row?.workspaceId) {
      dialog.value = null;
      await act({ type: "open-workspace", workspaceId: row.workspaceId });
      return;
    }
    const moduleIds = ticksOf(row);
    const added = await act({ type: "add-workspace", ...addInputFor(row, name.value) }, { quiet: true });
    if (!added.ok) {
      error.value = added.error;
      return;
    }
    if (!added.id) return;
    // Modules install the way Browse installs them; a failure is shown and the game stays added.
    const ready: string[] = [];
    for (const id of moduleIds) {
      if (state.value?.modules.some((module) => module.id === id)) {
        ready.push(id);
        continue;
      }
      const result = await act({ type: "install-catalog-module", moduleId: id }, { quiet: true });
      if (result.ok) ready.push(id);
      else error.value = result.error;
    }
    if (error.value) return;
    dialog.value = null;
    // A new workspace starts empty; take the user there, unless they are still in the first-run welcome, which lists it.
    // Ticked modules need the workspace open to add their panels.
    if (state.value?.library.onboarded || ready.length) await act({ type: "open-workspace", workspaceId: added.id });
    for (const id of ready) await openPanels(id, null, []);
  } finally {
    busy.value = false;
  }
}

// ── Keys outside the list ──────────────────────────────────────────────

function focusSearch() {
  void nextTick(() => input.value?.focus());
}

/** Esc inside the panel goes back to the search; Esc in the search closes the dialog. */
function onEscape(event: Event) {
  if (panel.value?.contains(document.activeElement)) {
    event.preventDefault();
    focusSearch();
  }
}

/** Enter on a tick adds the game and the ticked modules. */
function onPanelKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement;
  if (event.key === "Enter" && target.getAttribute("role") === "checkbox") {
    event.preventDefault();
    void pick(active.value);
  }
}

function ownGame() {
  if (custom.value) void confirm(null);
  else {
    ownHint.value = true;
    focusSearch();
  }
}
</script>

<template>
  <Dialog :open="true" @update:open="(open) => !open && (dialog = null)">
    <!-- The search and the footer stay put. Side by side the list and the panel each scroll; stacked (a small window)
         the body between them is the one area that scrolls. -->
    <DialogContent
      class="bg-card top-[8vh] flex max-h-[calc(100vh-8vh-16px)] w-[min(780px,calc(100vw-48px))] max-w-none translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="add-game-dialog"
      :show-close-button="false"
      @escape-key-down="onEscape"
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
          @input="ownHint = false"
        />
        <Kbd class="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 font-sans" aria-hidden="true">{{ t("search.key.esc") }}</Kbd>
      </div>

      <div tabindex="-1" class="@container min-h-0 flex-1 overflow-y-auto focus-visible:outline-none @[620px]:overflow-hidden">
        <div class="grid @[620px]:h-[min(420px,calc(100vh-8vh-9rem))] @[620px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div tabindex="-1" class="flex min-w-0 flex-col focus-visible:outline-none @[620px]:min-h-0 @[620px]:overflow-y-auto @[620px]:border-r">
            <p v-if="!installedLoaded" class="text-muted-foreground flex items-center gap-2 px-5 pt-3 pb-1 text-xs font-medium" role="status" data-testid="add-game-loading">
              <Loader class="size-3.5 flex-none animate-spin motion-reduce:animate-none" :stroke-width="1.75" aria-hidden="true" />{{ t("addGame.loadingPc") }}
            </p>
            <p v-else class="text-muted-foreground px-5 pt-3 pb-1 text-xs font-medium">{{ name ? t("addGame.found") : t("addGame.recent") }}</p>
            <div ref="list" class="px-2 pb-2">
              <!-- Placeholder rows while the games on this PC are found; typing still searches, and its results come first. -->
              <ul v-if="!installedLoaded && !name" class="m-0 list-none p-0" aria-hidden="true" data-testid="add-game-skeleton">
                <li v-for="row in SKELETON_ROWS" :key="row" class="flex items-center gap-3 px-3 py-2">
                  <span class="bg-muted size-7 flex-none animate-pulse rounded-md motion-reduce:animate-none" />
                  <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span class="bg-muted h-3.5 animate-pulse rounded motion-reduce:animate-none" :style="{ width: `${SKELETON_WIDTHS[row % SKELETON_WIDTHS.length]}%` }" />
                    <span class="bg-muted/70 h-2.5 w-1/4 animate-pulse rounded motion-reduce:animate-none" />
                  </span>
                </li>
              </ul>
              <GamePickerList id="game-results" :label="t('common.games')" :rows="rows" :active="active" :custom="custom" :info="info" :busy="busy" @hover="active = $event" @pick="pick" />
              <p v-if="!rows.length && !custom && installedLoaded && !ownHint" class="text-muted-foreground px-3 py-4 text-sm" data-testid="add-game-empty">{{ t("addGame.nothingOnPc") }}</p>
              <p v-if="ownHint && !name" class="text-muted-foreground px-3 py-4 text-sm" data-testid="add-game-own-hint">{{ t("addGame.ownHint") }}</p>
              <p v-if="onlineStatus === 'unreachable' && name" class="text-muted-foreground px-3 py-2 text-xs" data-testid="online-unreachable">{{ t("addGame.builtInOnly") }}</p>
            </div>
          </div>

          <section
            ref="panel"
            tabindex="-1"
            class="flex min-w-0 flex-col gap-3 border-t p-5 focus-visible:outline-none @[620px]:min-h-0 @[620px]:overflow-y-auto @[620px]:border-t-0"
            :aria-label="t('addGame.panel')"
            data-testid="add-game-panel"
            @keydown="onPanelKey"
          >
            <template v-if="activeRow || custom">
              <div class="flex items-center gap-3">
                <GameTile :id="activeRow?.gameId ?? activeRow?.key ?? custom ?? ''" :name="activeRow?.name ?? custom ?? ''" :icon="activeRow?.icon ?? null" :size="40" />
                <div class="min-w-0">
                  <p class="truncate font-medium" data-testid="panel-name">{{ activeRow?.name ?? custom }}</p>
                  <p class="text-muted-foreground truncate text-xs" data-testid="panel-line">{{ lineOf(activeRow) }}</p>
                </div>
              </div>

              <template v-if="!activeRow?.workspaceId">
                <div v-if="activeRow" class="flex flex-col gap-1.5">
                  <p v-if="catalogModules === null" class="text-muted-foreground text-xs" role="status">{{ t("addGame.loadingModules") }}</p>
                  <template v-else-if="panelModules.length">
                    <p class="text-muted-foreground text-xs font-medium">{{ t("addGame.modulesFor") }}</p>
                    <label
                      v-for="module in panelModules"
                      :key="module.id"
                      class="hover:bg-accent/60 flex cursor-pointer items-start gap-2.5 rounded-lg p-1.5"
                      :data-testid="`pick-module-${module.id}`"
                    >
                      <Checkbox class="mt-2.5" :model-value="panelTicks.includes(module.id)" :aria-label="t('addGame.pickModule', { name: module.name })" @update:model-value="toggle(module.id, $event === true)" />
                      <CatalogIcon :module-id="module.id" :has="module.icon" size="size-8" />
                      <span class="min-w-0 flex-1">
                        <span class="block truncate text-sm font-medium"
                          >{{ module.name }}<span class="text-muted-foreground font-normal"> · {{ module.official ? t("addGame.byTavora") : t("addGame.community") }}</span></span
                        >
                        <span v-if="module.description" class="text-muted-foreground line-clamp-2 block text-xs">{{ module.description }}</span>
                      </span>
                    </label>
                  </template>
                  <p v-else class="text-muted-foreground text-sm" data-testid="panel-no-modules">{{ t("addGame.noModules") }}</p>
                </div>
                <p v-else class="text-muted-foreground text-sm" data-testid="panel-no-modules">{{ t("addGame.noModules") }}</p>
              </template>

              <p v-if="error" class="text-destructive text-sm" role="alert" data-testid="add-game-error">{{ error }}</p>
              <div class="bg-card sticky bottom-0 -mx-5 -mb-5 mt-auto px-5 py-3">
                <Button :disabled="busy" data-testid="panel-add" @click="pick(active)">{{ addLabel }}</Button>
              </div>
            </template>
            <p v-else-if="installedLoaded || name" class="text-muted-foreground text-sm">{{ t("addGame.noModules") }}</p>
          </section>
          <!-- Stacked in a small window the panel sits below the whole list, so its action stays in view here. -->
          <div v-if="activeRow || custom" class="bg-card sticky bottom-0 z-10 flex items-center gap-3 border-t px-4 py-2 @[620px]:hidden" aria-hidden="true">
            <GameTile :id="activeRow?.gameId ?? activeRow?.key ?? custom ?? ''" :name="activeRow?.name ?? custom ?? ''" :icon="activeRow?.icon ?? null" :size="28" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ activeRow?.name ?? custom }}</span>
            <Button size="sm" tabindex="-1" :disabled="busy" data-testid="panel-add-compact" @click="pick(active)">{{ addLabel }}</Button>
          </div>
        </div>
      </div>

      <div class="text-muted-foreground flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs">
        <span aria-hidden="true"
          ><Kbd class="font-sans">↑</Kbd> <Kbd class="font-sans">↓</Kbd> {{ t("addGame.hint.move") }} · <Kbd class="font-sans">Tab</Kbd> {{ t("addGame.hint.ticks") }} ·
          <Kbd class="font-sans">{{ t("search.key.enter") }}</Kbd> {{ t("addGame.hint.add") }}</span
        >
        <span class="ml-auto flex gap-4">
          <button type="button" class="text-primary underline-offset-2 hover:underline" data-testid="add-game-own" @click="ownGame">{{ t("addGame.own") }}</button>
          <button type="button" class="text-primary underline-offset-2 hover:underline" data-testid="open-steam-import" @click="dialog = { kind: 'steam-import' }">{{ t("addGame.steam") }}</button>
        </span>
      </div>
    </DialogContent>
  </Dialog>
</template>
