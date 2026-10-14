<script setup lang="ts">
import { Search, X } from "@lucide/vue";
import { computed, nextTick, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { rank } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { RootSort, Startup } from "../../../shared/host-api";
import { act, confirmAction, settingsOpen, settingsTarget, state, submitAction } from "../../host";
import GameIcon from "../GameIcon.vue";
import SegmentedControl from "./SegmentedControl.vue";
import { GROUPS, SECTION_LABEL, SETTINGS, type SettingsSection } from "./settings-index";
import SettingRow from "./SettingRow.vue";

const section = ref<SettingsSection>("general");
const query = ref("");
/** The setting a search result led to, tinted for a moment. */
const highlight = ref<string | null>(null);
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

// Settings opens where it was asked to: its first section, or a setting
// found with Ctrl+K.
watch(settingsOpen, (open) => {
  if (!open) return;
  query.value = "";
  void show(settingsTarget.value.section, settingsTarget.value.setting);
});

async function show(target: SettingsSection, setting?: string) {
  section.value = target;
  query.value = "";
  clearTimeout(highlightTimer);
  highlight.value = setting ?? null;
  if (!setting) return;
  await nextTick();
  document.querySelector(`[data-setting="${CSS.escape(setting)}"]`)?.scrollIntoView({ block: "center" });
  highlightTimer = setTimeout(() => (highlight.value = null), 2000);
}

const library = computed(() => state.value!.library);
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const formatDate = (iso: string) => dateFormat.format(new Date(iso));

interface Result {
  id: string;
  section: SettingsSection;
  label: string;
  description: string;
  keywords: string[];
}

// Settings, plus the games in Trash, so "valheim" finds a removed game.
const results = computed<Result[]>(() => {
  if (!query.value.trim()) return [];
  const trashed = library.value.trash.map((entry) => ({
    id: `trash-${entry.game.id}`,
    section: "trash" as const,
    label: entry.game.name,
    description: `In Trash until ${formatDate(entry.purgeAt)}`,
    keywords: [],
  }));
  return rank([...SETTINGS, ...trashed], query.value, (item) => ({
    name: item.label,
    extra: [item.description, SECTION_LABEL[item.section], ...item.keywords],
  }));
});

function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Escape" && query.value) {
    // Clear the search first; a second Escape closes Settings.
    event.preventDefault();
    event.stopPropagation();
    query.value = "";
  } else if (event.key === "Enter" && results.value[0]) {
    void show(results.value[0].section, results.value[0].id);
  }
}

const startup = computed({
  get: () => library.value.startup,
  set: (value: Startup) => void act({ type: "set-startup", startup: value }),
});
const sort = computed({
  get: () => library.value.sort,
  set: (value: RootSort) => void act({ type: "set-sort", sort: value }),
});

function deleteNow(gameId: string, name: string) {
  confirmAction({
    title: `Delete ${name} for good?`,
    message: "Its workspace, notes and all other module data are deleted now. This cannot be undone.",
    confirm: "Delete for good",
    danger: true,
    run: () => submitAction({ type: "delete-game", gameId }),
  });
}
</script>

<template>
  <Dialog v-model:open="settingsOpen">
    <DialogContent
      class="bg-card flex h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="settings"
      :show-close-button="false"
      :aria-describedby="undefined"
    >
      <nav class="bg-background flex w-60 flex-none flex-col gap-4 overflow-y-auto border-r p-3" aria-label="Settings sections">
        <DialogTitle class="px-3 pt-2 text-lg font-semibold">Settings</DialogTitle>
        <div class="relative">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" />
          <input
            v-model="query"
            type="text"
            class="bg-card placeholder:text-muted-foreground focus-visible:ring-ring h-9 w-full rounded-lg border pr-3 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
            placeholder="Search settings"
            aria-label="Search settings"
            autocomplete="off"
            maxlength="80"
            data-testid="settings-search"
            @keydown="onSearchKey"
          />
        </div>
        <div v-for="group in GROUPS" :key="group.label" class="flex flex-col gap-0.5">
          <h3 class="text-muted-foreground px-3 pb-1 text-xs font-medium">{{ group.label }}</h3>
          <button
            v-for="item in group.sections"
            :key="item.id"
            type="button"
            :class="
              cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground flex h-9 items-center gap-3 rounded-lg px-3 text-left font-medium',
                !query && section === item.id && 'bg-accent text-foreground',
              )
            "
            :data-testid="`settings-nav-${item.id}`"
            :aria-current="!query && section === item.id ? 'page' : undefined"
            @click="show(item.id)"
          >
            <component :is="item.icon" class="size-4 flex-none" :stroke-width="1.5" />
            <span class="flex-1">{{ item.label }}</span>
            <span v-if="item.id === 'trash' && library.trash.length" class="text-muted-foreground text-xs tabular-nums">{{ library.trash.length }}</span>
          </button>
        </div>
      </nav>

      <div class="relative min-w-0 flex-1 overflow-y-auto">
        <DialogClose as-child>
          <Button variant="ghost" size="icon" class="absolute top-4 right-4" data-testid="settings-close" aria-label="Close settings" title="Close">
            <X :stroke-width="1.5" />
          </Button>
        </DialogClose>

        <div class="max-w-[760px] px-10 py-10">
          <template v-if="query.trim()">
            <h2 class="mb-4 text-xl font-semibold">Search results</h2>
            <p v-if="!results.length" class="text-muted-foreground" data-testid="settings-no-results">No settings match "{{ query.trim() }}".</p>
            <ul v-else class="-mx-3 flex flex-col gap-1" aria-label="Search results" data-testid="settings-results">
              <li v-for="result in results" :key="result.id">
                <button
                  type="button"
                  class="hover:bg-accent focus-visible:bg-accent flex w-full flex-col gap-1 rounded-lg px-3 py-3 text-left"
                  :data-testid="`settings-result-${result.id}`"
                  @click="show(result.section, result.id)"
                >
                  <span class="text-muted-foreground text-xs font-medium">{{ SECTION_LABEL[result.section] }}</span>
                  <span class="font-medium">{{ result.label }}</span>
                  <span class="text-muted-foreground">{{ result.description }}</span>
                </button>
              </li>
            </ul>
          </template>

          <template v-else-if="section === 'general'">
            <h2 class="mb-4 text-xl font-semibold">General</h2>
            <SettingRow
              label="When Tavora starts"
              description="Show Home, or go straight back to the game you played last."
              setting="startup"
              :highlighted="highlight === 'startup'"
            >
              <SegmentedControl
                v-model="startup"
                label="When Tavora starts"
                :options="[
                  { value: 'welcome', label: 'Home', testid: 'startup-welcome' },
                  { value: 'last-game', label: 'Last game', testid: 'startup-last-game' },
                ]"
              />
            </SettingRow>
            <SettingRow
              label="Game list order"
              description="How games are sorted on the rail. In your own order, drag games to arrange them."
              setting="sort"
              :highlighted="highlight === 'sort'"
            >
              <SegmentedControl
                v-model="sort"
                label="Game list order"
                :options="[
                  { value: 'recent', label: 'Recently played', testid: 'sort-recent' },
                  { value: 'manual', label: 'My own order', testid: 'sort-manual' },
                ]"
              />
            </SettingRow>
          </template>

          <template v-else-if="section === 'trash'">
            <h2 :class="cn('-mx-3 rounded-lg px-3 text-xl font-semibold transition-colors duration-500', highlight === 'trash' && 'bg-primary/10')" data-setting="trash">
              Trash
            </h2>
            <p class="text-muted-foreground mt-2 mb-4">Removed games and all their data stay here for 30 days, then they are deleted for good.</p>
            <div class="border-t" data-testid="trash">
              <p v-if="!library.trash.length" class="text-muted-foreground py-4" data-testid="trash-empty">Trash is empty.</p>
              <ul v-else>
                <li
                  v-for="entry in library.trash"
                  :key="entry.game.id"
                  :class="
                    cn(
                      '-mx-3 flex min-h-16 items-center gap-4 rounded-lg border-b px-3 py-3 transition-colors duration-500 last:border-b-0',
                      highlight === `trash-${entry.game.id}` && 'bg-primary/10',
                    )
                  "
                  :data-testid="`trash-${entry.game.id}`"
                  :data-setting="`trash-${entry.game.id}`"
                >
                  <GameIcon :game="entry.game" :size="40" />
                  <span class="flex min-w-0 flex-1 flex-col gap-1">
                    <span class="truncate font-medium">{{ entry.game.name }}</span>
                    <span class="text-muted-foreground">Deleted for good on {{ formatDate(entry.purgeAt) }}</span>
                  </span>
                  <Button variant="secondary" :data-testid="`restore-${entry.game.id}`" @click="act({ type: 'restore-game', gameId: entry.game.id })">
                    Restore
                  </Button>
                  <Button variant="secondary" class="text-destructive" :data-testid="`delete-${entry.game.id}`" @click="deleteNow(entry.game.id, entry.game.name)">
                    Delete now
                  </Button>
                </li>
              </ul>
            </div>
          </template>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
