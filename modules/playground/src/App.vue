<script setup lang="ts">
// UI Playground: a reference of every control the official modules share. A side menu with a search finds the page;
// each page shows its examples live, with their code on request. Below 640 px the menu folds into a picker at the
// top. This panel remembers its page, search and developer tools (panel state).
import { connectModule } from "@tavora/official-ui";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { Toaster } from "@tavora/official-ui/components/ui/toast";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { provideOff } from "./dev";
import DevTools from "./DevTools.vue";
import { setLanguage, t } from "./i18n";
import { de, en } from "./locales";
import PageView from "./PageView.vue";
import { FIRST_PAGE, findPages, GROUPS, groupKey, OLD_TABS, pageById, pageKey, PAGES, type PageDef } from "./pages";

interface PanelState {
  page: string;
  filter: string;
  devTools: boolean;
  disabled: boolean;
}

const sdk = shallowRef<TavoraSDK | null>(null);
const panel = ref<PanelState>({ page: FIRST_PAGE, filter: "", devTools: false, disabled: false });
const scroller = ref<HTMLElement | null>(null);
const cleanup: (() => void)[] = [];

const page = computed(() => pageById(panel.value.page) ?? PAGES[0]!);
const titleOf = (entry: PageDef) => t(pageKey(entry.id));
const groupOf = (entry: PageDef) => t(groupKey(entry.group));
/** English titles too, so a search in English finds pages while Tavora shows German. */
const englishOf = (entry: PageDef) => `${en[pageKey(entry.id)]} ${en[groupKey(entry.group)]}`;

const found = computed(() => findPages(panel.value.filter, (entry) => `${titleOf(entry)} ${englishOf(entry)}`, groupOf));
const navGroups = computed<NavGroup[]>(() =>
  GROUPS.map((group) => ({
    heading: t(groupKey(group)),
    items: found.value.filter((entry) => entry.group === group).map((entry) => ({ id: entry.id, label: titleOf(entry), testid: `nav-${entry.id}` })),
  })).filter((group) => group.items.length),
);
const pickerOptions = computed(() => PAGES.map((entry) => ({ value: entry.id, label: titleOf(entry), keywords: `${groupOf(entry)} ${englishOf(entry)} ${entry.keywords}` })));

const off = computed(() => panel.value.devTools && panel.value.disabled);
provideOff(off);

function save() {
  void sdk.value?.panel.setState({ ...panel.value });
}

function setPanel(patch: Partial<PanelState>) {
  panel.value = { ...panel.value, ...patch };
  save();
}

async function open(id: string) {
  if (id === panel.value.page) return;
  setPanel({ page: id });
  await nextTick();
  scroller.value?.scrollTo({ top: 0 });
}

/** Enter in the search opens the first page it finds. */
function openFirst() {
  const first = found.value[0];
  if (first) void open(first.id);
}

function readState(state: Partial<PanelState> & { group?: string } | null): PanelState {
  const saved = typeof state?.page === "string" && pageById(state.page) ? state.page : OLD_TABS[state?.group ?? ""] ?? FIRST_PAGE;
  return {
    page: saved,
    filter: typeof state?.filter === "string" ? state.filter : "",
    devTools: state?.devTools === true,
    disabled: state?.disabled === true,
  };
}

onMounted(async () => {
  // The page also works outside Tavora (for example opened from dist/ in a browser); it then keeps the default theme.
  try {
    const connection = await connectModule({ texts: { en, de } });
    if (connection.status !== "ready" || !connection.sdk) throw connection.error;
    setLanguage(connection.language);
    cleanup.push(connection.onLanguage(setLanguage), connection.dispose);
    panel.value = readState(await connection.sdk.panel.getState<Partial<PanelState>>());
    sdk.value = connection.sdk;
  } catch {
    // Not inside Tavora.
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));
</script>

<template>
  <div class="flex h-full min-h-0" data-testid="playground-app">
    <aside class="bg-background hidden w-56 flex-none flex-col border-r sm:flex" data-testid="side-menu">
      <div class="flex h-16 flex-none items-center px-3">
        <SearchInput
          :model-value="panel.filter"
          class="w-full"
          :placeholder="t('nav.search')"
          :aria-label="t('nav.search')"
          :clear-label="t('nav.clear')"
          autocomplete="off"
          data-testid="filter"
          @update:model-value="setPanel({ filter: $event })"
          @keydown.enter="openFirst"
        />
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <NavList v-if="navGroups.length" :model-value="page.id" :label="t('nav.label')" :groups="navGroups" @select="open" />
        <p v-else class="text-muted-foreground px-3 py-6 text-sm" data-testid="no-match">{{ t("nav.none", { query: panel.filter.trim() }) }}</p>
      </div>
      <DevTools
        class="flex-none border-t px-3 py-3"
        :on="panel.devTools"
        :disabled="panel.disabled"
        @update:on="setPanel({ devTools: $event })"
        @update:disabled="setPanel({ disabled: $event })"
      />
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Where you are: the group, then the page; on a narrow panel the page is a picker that replaces the menu. -->
      <header class="flex h-16 flex-none items-center gap-2.5 border-b px-4 text-base sm:px-6" data-testid="page-header">
        <span class="text-muted-foreground flex-none font-medium" data-testid="page-group">{{ groupOf(page) }}</span>
        <span class="text-muted-foreground/60 flex-none" aria-hidden="true">/</span>
        <h2 class="hidden min-w-0 truncate font-semibold sm:block" data-testid="page-title">{{ titleOf(page) }}</h2>
        <Picker
          :model-value="page.id"
          class="min-w-0 flex-1 sm:hidden"
          :options="pickerOptions"
          :label="t('nav.page')"
          :search="t('nav.search')"
          :empty="t('nav.empty')"
          testid="page-picker"
          data-testid="page-picker"
          @update:model-value="open"
        />
      </header>
      <main ref="scroller" class="min-h-0 flex-1 overflow-y-auto" data-testid="playground-main">
        <PageView :key="page.id" :page="page" />
        <DevTools
          class="border-t px-4 py-4 sm:hidden"
          :on="panel.devTools"
          :disabled="panel.disabled"
          @update:on="setPanel({ devTools: $event })"
          @update:disabled="setPanel({ disabled: $event })"
        />
      </main>
    </div>
    <Toaster />
  </div>
</template>
