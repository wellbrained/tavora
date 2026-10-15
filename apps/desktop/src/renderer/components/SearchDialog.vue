<script setup lang="ts">
// Ctrl+K: one box to jump to a game, open a module, use a saved layout,
// run an action or find a setting. Arrow keys move, Enter runs, Escape
// closes.
import { Blocks, Home, Keyboard, LayoutPanelLeft, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, SlidersHorizontal } from "@lucide/vue";
import { computed, nextTick, ref, watch, type Component } from "vue";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { rank } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { GameView } from "../../shared/host-api";
import { act, dialog, openSettings, searchOpen, shortcutsOpen, state } from "../host";
import GameIcon from "./GameIcon.vue";
import { SECTION_LABEL, SETTINGS } from "./settings/settings-index";

interface Item {
  id: string;
  label: string;
  /** Shown on the right, e.g. the section a setting is in. */
  hint?: string;
  /** Other words that find the item. */
  keywords?: string[];
  icon?: Component;
  game?: GameView;
  run: () => unknown;
}

interface Group {
  label: string;
  items: Item[];
}

const query = ref("");
const active = ref(0);
const list = ref<HTMLElement | null>(null);

watch(searchOpen, (open) => {
  if (open) {
    query.value = "";
    active.value = 0;
  }
});

const view = computed(() => state.value!);
const library = computed(() => view.value.library);
const currentGame = computed(() => (view.value.screen === "game" && view.value.currentGameId ? library.value.games[view.value.currentGameId] : undefined));

/** Closes the box first, so the action's own dialog or screen takes over. */
const close = (then: () => unknown) => () => {
  searchOpen.value = false;
  return then();
};

// Recently played first, then the rest by name.
const gamesInOrder = computed(() => {
  const recent = library.value.recent.filter((id) => library.value.games[id]);
  const rest = Object.values(library.value.games)
    .filter((game) => !recent.includes(game.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...recent.map((id) => library.value.games[id]!), ...rest];
});

const groups = computed<Group[]>(() => {
  const all: Group[] = [
    {
      label: "Games",
      items: [
        { id: "home", label: "Home", keywords: ["welcome", "start"], icon: Home, run: close(() => act({ type: "show-welcome" })) },
        ...gamesInOrder.value.map((game) => ({
          id: `game-${game.id}`,
          label: game.name,
          hint: game.id === currentGame.value?.id ? "Open now" : undefined,
          game,
          run: close(() => act({ type: "open-game", gameId: game.id })),
        })),
      ],
    },
  ];
  if (currentGame.value) {
    all.push({
      label: `In ${currentGame.value.name}`,
      items: [
        ...view.value.modules
          .filter((module) => module.available)
          .map((module) => ({
            id: `module-${module.id}`,
            label: `Open ${module.name}`,
            hint: "Module",
            keywords: [module.name, module.description ?? "", "panel"],
            icon: Blocks,
            run: close(() => act({ type: "open-module", moduleId: module.id })),
          })),
        ...view.value.snapshots.map((snapshot) => ({
          id: `layout-${snapshot.id}`,
          label: `Use layout ${snapshot.name}`,
          hint: "Layout",
          keywords: ["snapshot", "saved layout"],
          icon: LayoutPanelLeft,
          run: close(() => act({ type: "apply-snapshot", snapshotId: snapshot.id })),
        })),
      ],
    });
  }
  const expanded = library.value.rail.expanded;
  all.push({
    label: "Actions",
    items: [
      { id: "add-game", label: "Add game", keywords: ["new game"], icon: Plus, run: close(() => (dialog.value = { kind: "add-game" })) },
      { id: "settings", label: "Settings", keywords: ["preferences", "options"], icon: Settings, run: close(() => openSettings()) },
      {
        id: "toggle-rail",
        label: expanded ? "Collapse game list" : "Expand game list",
        keywords: ["rail", "sidebar"],
        icon: expanded ? PanelLeftClose : PanelLeftOpen,
        run: close(() => act({ type: "set-rail", expanded: !expanded })),
      },
      {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        hint: "Ctrl+/",
        keywords: ["keys", "hotkeys", "keyboard", "help"],
        icon: Keyboard,
        run: close(() => (shortcutsOpen.value = true)),
      },
    ],
  });
  all.push({
    label: "Settings",
    items: SETTINGS.map((setting) => ({
      id: `setting-${setting.id}`,
      label: setting.label,
      hint: SECTION_LABEL[setting.section],
      keywords: [setting.description, ...setting.keywords],
      icon: SlidersHorizontal,
      run: close(() => openSettings({ section: setting.section, setting: setting.id })),
    })),
  });
  return all;
});

// Without a query: Home, recent games and what the current game offers.
// Settings only show up once something is typed.
const shown = computed<Group[]>(() => {
  const text = query.value.trim();
  if (!text) return groups.value.filter((group) => group.label !== "Settings");
  return groups.value
    .map((group) => ({ ...group, items: rank(group.items, text, (item) => ({ name: item.label, extra: item.keywords })) }))
    .filter((group) => group.items.length > 0);
});

const flat = computed(() => shown.value.flatMap((group) => group.items));
watch(query, () => (active.value = 0));

const optionId = (item: Item) => `search-option-${item.id}`;
const activeId = computed(() => {
  const item = flat.value[active.value];
  return item ? optionId(item) : undefined;
});

async function move(by: number) {
  const count = flat.value.length;
  if (!count) return;
  active.value = (active.value + by + count) % count;
  await nextTick();
  list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function onKey(event: KeyboardEvent) {
  if (event.key === "ArrowDown") move(1);
  else if (event.key === "ArrowUp") move(-1);
  else if (event.key === "Enter") void flat.value[active.value]?.run();
  else return;
  event.preventDefault();
}
</script>

<template>
  <Dialog v-model:open="searchOpen">
    <DialogContent
      class="bg-card top-[12vh] w-[min(560px,calc(100vw-48px))] max-w-none translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-none"
      data-testid="search"
      :show-close-button="false"
    >
      <DialogTitle class="sr-only">Search Tavora</DialogTitle>
      <DialogDescription class="sr-only">Find a game, module, layout, action or setting.</DialogDescription>
      <div class="relative border-b">
        <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" :stroke-width="1.5" />
        <input
          v-model="query"
          class="placeholder:text-muted-foreground h-14 w-full bg-transparent pr-4 pl-12 text-base focus-visible:outline-none"
          placeholder="Search games, modules, layouts and settings"
          role="combobox"
          aria-label="Search Tavora"
          aria-expanded="true"
          aria-controls="search-results"
          aria-autocomplete="list"
          :aria-activedescendant="activeId"
          autocomplete="off"
          spellcheck="false"
          maxlength="80"
          data-testid="search-input"
          @keydown="onKey"
        />
      </div>

      <div id="search-results" ref="list" class="max-h-[min(420px,60vh)] overflow-y-auto p-2" role="listbox" aria-label="Results">
        <p v-if="!flat.length" class="text-muted-foreground px-3 py-6 text-center" data-testid="search-empty">Nothing matches "{{ query.trim() }}".</p>
        <div v-for="group in shown" :key="group.label" role="group" :aria-label="group.label" class="pb-1">
          <div class="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium" aria-hidden="true">{{ group.label }}</div>
          <div
            v-for="item in group.items"
            :id="optionId(item)"
            :key="item.id"
            role="option"
            :aria-selected="flat[active] === item"
            :class="cn('flex h-10 cursor-pointer items-center gap-3 rounded-lg px-3', flat[active] === item && 'bg-accent')"
            :data-testid="`search-${item.id}`"
            @mousemove="active = flat.indexOf(item)"
            @click="item.run()"
          >
            <GameIcon v-if="item.game" :game="item.game" :size="24" />
            <component :is="item.icon" v-else class="text-muted-foreground size-5 flex-none" :stroke-width="1.5" />
            <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
            <span v-if="item.hint" class="text-muted-foreground flex-none text-xs">{{ item.hint }}</span>
          </div>
        </div>
      </div>

      <div class="text-muted-foreground flex gap-4 border-t px-4 py-2 text-xs" aria-hidden="true">
        <span><kbd class="font-sans">↑</kbd> <kbd class="font-sans">↓</kbd> to move</span>
        <span><kbd class="font-sans">Enter</kbd> to open</span>
        <span><kbd class="font-sans">Esc</kbd> to close</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
