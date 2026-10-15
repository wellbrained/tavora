<script setup lang="ts">
// Ctrl+K: one box to jump to a game, open a module, use a saved layout,
// run an action or find a setting. Arrow keys move, Enter runs, Escape
// closes.
import { Blocks, Home, LayoutPanelLeft, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, SlidersHorizontal } from "@lucide/vue";
import { computed, nextTick, ref, watch, type Component } from "vue";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { rank } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { CatalogMatch, GameView, OnlineGame } from "../../shared/host-api";
import { LAYOUT_TEMPLATES } from "../../shared/layout-templates";
import { act, api, dialog, openSettings, searchOpen, state } from "../host";
import { t, templateName } from "../i18n";

import GameIcon from "./GameIcon.vue";
import { sectionLabel, settingEntries } from "./settings/settings-index";

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
  id: "games" | "game" | "actions" | "settings" | "add";
  label: string;
  items: Item[];
}

/** A comma-separated list from the locale files as search words. */
const splitWords = (text: string) =>
  text
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);

const query = ref("");
const active = ref(0);
const list = ref<HTMLElement | null>(null);

watch(searchOpen, (open) => {
  if (open) {
    query.value = "";
    active.value = 0;
  }
});

// Games Tavora knows but the player has not added yet: the built-in list at
// once, the Tavora service a moment after typing stops.
const ONLINE_DELAY_MS = 250;
const MAX_ADD_ITEMS = 5;
const known = ref<CatalogMatch[]>([]);
const online = ref<OnlineGame[]>([]);
let knownId = 0;
let onlineId = 0;
let onlineTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, (text) => {
  clearTimeout(onlineTimer);
  const thisKnown = ++knownId;
  const thisOnline = ++onlineId;
  if ([...text.trim()].length < 2) {
    known.value = [];
    online.value = [];
    return;
  }
  void api.searchCatalog(text).then((found) => {
    if (thisKnown === knownId) known.value = found;
  });
  onlineTimer = setTimeout(async () => {
    const result = await api.searchOnline(text);
    if (thisOnline === onlineId) online.value = result.games;
  }, ONLINE_DELAY_MS);
});

type NewGame = { catalogId: string } | { online: OnlineGame };
async function addAndOpen(input: NewGame) {
  const added = await act({ type: "add-game", ...input });
  if (added.ok && added.id) await act({ type: "open-game", gameId: added.id });
}

const addItems = computed<Item[]>(() => {
  const rows: { id: string; name: string; input: NewGame }[] = [
    ...known.value.map((game) => ({ id: game.id, name: game.name, input: { catalogId: game.id } })),
    ...online.value.filter((game) => !known.value.some((match) => match.id === game.id)).map((game) => ({ id: game.id, name: game.name, input: { online: game } })),
  ];
  return rows.slice(0, MAX_ADD_ITEMS).map((row) => ({
    id: `add-game-${row.id}`,
    label: t("search.add", { name: row.name }),
    hint: t("search.newGame"),
    icon: Plus,
    run: close(() => addAndOpen(row.input)),
  }));
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
      id: "games",
      label: t("common.games"),
      items: [
        { id: "home", label: t("rail.home"), keywords: splitWords(t("search.homeKeywords")), icon: Home, run: close(() => act({ type: "show-welcome" })) },
        ...gamesInOrder.value.map((game) => ({
          id: `game-${game.id}`,
          label: game.name,
          hint: game.id === currentGame.value?.id ? t("search.openNow") : undefined,
          game,
          run: close(() => act({ type: "open-game", gameId: game.id })),
        })),
      ],
    },
  ];
  if (currentGame.value) {
    all.push({
      id: "game",
      label: t("search.group.in", { name: currentGame.value.name }),
      items: [
        ...view.value.modules
          .filter((module) => module.available)
          .map((module) => ({
            id: `module-${module.id}`,
            label: t("search.openModule", { name: module.name }),
            hint: t("search.module"),
            keywords: [module.name, module.description ?? "", ...splitWords(t("search.moduleKeywords"))],
            icon: Blocks,
            run: close(() => act({ type: "open-module", moduleId: module.id })),
          })),
        ...view.value.snapshots.map((snapshot) => ({
          id: `layout-${snapshot.id}`,
          label: t("search.useLayout", { name: snapshot.name }),
          hint: t("search.layout"),
          keywords: splitWords(t("search.layoutKeywords")),
          icon: LayoutPanelLeft,
          run: close(() => act({ type: "apply-snapshot", snapshotId: snapshot.id })),
        })),
        ...LAYOUT_TEMPLATES.map((template) => ({
          id: `layout-template-${template.id}`,
          label: t("search.useTemplate", { name: templateName(template) }),
          hint: t("search.layout"),
          keywords: splitWords(t("search.templateKeywords")),
          icon: LayoutPanelLeft,
          run: close(() => act({ type: "apply-layout-template", templateId: template.id })),
        })),
      ],
    });
  }
  const expanded = library.value.rail.expanded;
  all.push({
    id: "actions",
    label: t("search.group.actions"),
    items: [
      { id: "add-game", label: t("common.addGame"), keywords: splitWords(t("search.addGameKeywords")), icon: Plus, run: close(() => (dialog.value = { kind: "add-game" })) },
      { id: "settings", label: t("rail.settings"), keywords: splitWords(t("search.settingsKeywords")), icon: Settings, run: close(() => openSettings()) },
      {
        id: "toggle-rail",
        label: expanded ? t("rail.collapse") : t("rail.expand"),
        keywords: splitWords(t("search.railKeywords")),
        icon: expanded ? PanelLeftClose : PanelLeftOpen,
        run: close(() => act({ type: "set-rail", expanded: !expanded })),
      },
    ],
  });
  all.push({
    id: "settings",
    label: t("rail.settings"),
    items: settingEntries().map((setting) => ({
      id: `setting-${setting.id}`,
      label: setting.label,
      hint: sectionLabel(setting.section),
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
  if (!text) return groups.value.filter((group) => group.id !== "settings");
  const ranked = groups.value
    .map((group) => ({ ...group, items: rank(group.items, text, (item) => ({ name: item.label, extra: item.keywords })) }))
    .filter((group) => group.items.length > 0);
  // Already ranked by the search itself, and placed after the player's own games.
  if (addItems.value.length) ranked.splice(ranked[0]?.id === "games" ? 1 : 0, 0, { id: "add", label: t("addGame.title"), items: addItems.value });
  return ranked;
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
      <DialogTitle class="sr-only">{{ t("search.title") }}</DialogTitle>
      <DialogDescription class="sr-only">{{ t("search.description") }}</DialogDescription>
      <div class="relative border-b">
        <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2" :stroke-width="1.5" />
        <input
          v-model="query"
          class="placeholder:text-muted-foreground h-14 w-full bg-transparent pr-4 pl-12 text-base focus-visible:outline-none"
          :placeholder="t('search.placeholder')"
          role="combobox"
          :aria-label="t('search.title')"
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

      <div id="search-results" ref="list" class="max-h-[min(420px,60vh)] overflow-y-auto p-2" role="listbox" :aria-label="t('search.results')">
        <p v-if="!flat.length" class="text-muted-foreground px-3 py-6 text-center" data-testid="search-empty">{{ t("search.empty", { query: query.trim() }) }}</p>
        <div v-for="group in shown" :key="group.id" role="group" :aria-label="group.label" class="pb-1">
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
        <span><kbd class="font-sans">↑</kbd> <kbd class="font-sans">↓</kbd> {{ t("search.hint.move") }}</span>
        <span><kbd class="font-sans">{{ t("search.key.enter") }}</kbd> {{ t("search.hint.open") }}</span>
        <span><kbd class="font-sans">{{ t("search.key.esc") }}</kbd> {{ t("search.hint.close") }}</span>
      </div>
    </DialogContent>
  </Dialog>
</template>
