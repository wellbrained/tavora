<script setup lang="ts">
// UI Playground: every control the official modules share, one page per kind, each example live with its own code.
// This file is the shell: the side menu with its search (a page picker when the panel is narrow), the fixed page
// header and the page. The examples live in examples/<page>/<Name>.vue and are listed in pages.ts.
// Saved: the open page and Show disabled with the panel; Developer tools for the whole module (storage.app).
import { Wrench } from "@lucide/vue";
import { connectModule } from "@tavora/official-ui";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { usePageMotion } from "@tavora/official-ui/components/ui/motion";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { SwitchField } from "@tavora/official-ui/components/ui/switch";
import { Toaster } from "@tavora/official-ui/components/ui/toast";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import type { TavoraSDK } from "@tavora/sdk";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { exampleFor } from "./examples";
import { maybe, setLanguage, t } from "./i18n";
import type { TextKey } from "./locales";
import { FIRST_PAGE, GROUPS, OLD_TABS, PAGES, isPageId, keys, matches, pageById, searchText, type PageId } from "./pages";
import ExampleBox from "./shell/ExampleBox.vue";

interface PanelState {
  page: PageId;
  disabled: boolean;
}
const DEV_TOOLS_KEY = "devTools";
/** Below this width the menu and a page don't fit side by side; the menu becomes a picker on top. */
const NARROW = "(max-width: 679px)";

const sdk = shallowRef<TavoraSDK | null>(null);
const page = ref<PageId>(FIRST_PAGE);
const query = ref("");
const devTools = ref(false);
const showDisabled = ref(false);
/** Developer tools off puts every helper back, so nothing stays switched on out of sight. */
const off = computed(() => devTools.value && showDisabled.value);
const narrow = ref(false);
const cleanup: (() => void)[] = [];

const text = (key: string) => t(key as TextKey);
const current = computed(() => pageById(page.value));
const haystacks = computed(() => new Map(PAGES.map((entry) => [entry.id, searchText(entry, maybe)])));
const found = computed(() => PAGES.filter((entry) => !query.value.trim() || matches(haystacks.value.get(entry.id) ?? "", query.value)));
const menu = computed<NavGroup[]>(() =>
  GROUPS.map((group) => ({
    heading: text(keys.group(group)),
    items: found.value.filter((entry) => entry.group === group).map((entry) => ({ id: entry.id, label: text(keys.page(entry.id)), testid: `nav-${entry.id}` })),
  })).filter((group) => group.items.length),
);
const pickerOptions = computed(() => PAGES.map((entry) => ({ value: entry.id, label: text(keys.page(entry.id)), keywords: haystacks.value.get(entry.id) })));
const examples = computed(() =>
  current.value.examples.flatMap((name) => {
    const example = exampleFor(current.value.id, name);
    if (!example) return [];
    const id = current.value.id;
    return [{ name, example, title: text(keys.example(id, name)), note: maybe(keys.note(id, name)), rule: maybe(keys.rule(id, name)) }];
  }),
);

// The page scrolls under the fixed header; a new page starts at its top and, after a pick with the pointer, fades in.
const scroller = ref<HTMLElement | null>(null);
const holder = ref<HTMLElement | null>(null);
const { play } = usePageMotion(holder);
watch(
  page,
  () => {
    scroller.value?.scrollTo({ top: 0 });
    play();
    savePanel();
  },
  { flush: "post" },
);

/** A page picked before the saved one has been read back wins over it. */
let pickedEarly = false;
function open(id: string) {
  if (!isPageId(id)) return;
  pickedEarly = true;
  page.value = id;
  query.value = "";
}

const nav = ref<HTMLElement | null>(null);
function onSearchKey(event: KeyboardEvent) {
  if (event.key === "Enter" && found.value[0]) {
    event.preventDefault();
    open(found.value[0].id);
  } else if (event.key === "ArrowDown") {
    const first = nav.value?.querySelector<HTMLButtonElement>("button[data-nav-item]");
    if (first) {
      event.preventDefault();
      first.focus();
    }
  }
}

function savePanel() {
  const state: PanelState = { page: page.value, disabled: showDisabled.value };
  void sdk.value?.panel.setState({ ...state }).catch(() => undefined);
}
function setShowDisabled(value: boolean) {
  showDisabled.value = value;
  savePanel();
}
function setDevTools(value: boolean) {
  devTools.value = value;
  void sdk.value?.storage.app.set(DEV_TOOLS_KEY, value).catch(() => undefined);
}

onMounted(async () => {
  const media = matchMedia(NARROW);
  const follow = () => (narrow.value = media.matches);
  follow();
  media.addEventListener("change", follow);
  cleanup.push(() => media.removeEventListener("change", follow));
  // The page also works outside Tavora (for example opened from dist/ in a browser); it then keeps the default theme.
  try {
    const connection = await connectModule({});
    const connected = connection.sdk;
    if (!connected) throw connection.error;
    setLanguage(connection.language);
    cleanup.push(connection.onLanguage(setLanguage), connection.dispose);
    const [state, tools] = await Promise.all([
      connected.panel.getState<Partial<PanelState> & { group?: string }>(),
      connected.storage.app.get<boolean>(DEV_TOOLS_KEY).catch(() => null),
    ]);
    // A panel saved before the side menu has its tab instead of a page: it opens that tab's first page.
    const saved = isPageId(state?.page) ? state.page : typeof state?.group === "string" ? OLD_TABS[state.group] : undefined;
    showDisabled.value = state?.disabled === true;
    devTools.value = tools === true;
    sdk.value = connected;
    if (saved && !pickedEarly) page.value = saved;
  } catch {
    // Not inside Tavora.
  }
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));
</script>

<template>
  <div class="flex h-full min-h-0" data-testid="playground-app">
    <aside v-if="!narrow" class="bg-background flex w-60 flex-none flex-col border-r" data-testid="menu">
      <div class="flex h-14 flex-none items-center px-3">
        <SearchInput v-model="query" class="w-full" :placeholder="t('app.search')" :aria-label="t('app.search')" :clear-label="t('app.clearSearch')" autocomplete="off" data-testid="page-search" @keydown="onSearchKey" />
      </div>
      <div ref="nav" class="min-h-0 flex-1 overflow-y-auto px-3 pt-2 pb-3 [scrollbar-width:thin]">
        <NavList v-if="menu.length" :model-value="page" :label="t('app.pages')" :groups="menu" @select="open" />
        <p v-else class="text-muted-foreground px-3 py-2 text-sm" data-testid="no-match">{{ t("app.noMatch", { query: query.trim() }) }}</p>
      </div>
      <div class="flex flex-none flex-col gap-3 border-t p-4">
        <SwitchField :model-value="devTools" :label="t('app.devTools')" :description="t('app.devToolsHint')" data-testid="dev-tools" @update:model-value="setDevTools" />
        <SwitchField v-if="devTools" :model-value="showDisabled" :label="t('app.showDisabled')" :description="t('app.showDisabledHint')" data-testid="disable-all" @update:model-value="setShowDisabled" />
      </div>
    </aside>

    <div class="bg-card flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 flex-none items-center gap-2.5 border-b" :class="narrow ? 'px-4' : 'px-6'">
        <template v-if="narrow">
          <Picker :model-value="page" :options="pickerOptions" :label="t('app.page')" :search="t('app.search')" :empty="t('app.noPage')" class="max-w-none min-w-0 flex-1" testid="page-picker" @update:model-value="open" />
          <Toggle :model-value="devTools" :label="t('app.devTools')" data-testid="dev-tools-toggle" @update:model-value="setDevTools"><Wrench class="size-4" :stroke-width="1.5" /></Toggle>
        </template>
        <!-- Where you are: the group, then the page. Room on the right for a link to the docs later. -->
        <div v-else class="flex min-w-0 items-center gap-2.5 text-base">
          <span class="text-muted-foreground flex-none font-medium">{{ text(keys.group(current.group)) }}</span>
          <span class="text-muted-foreground/60 flex-none" aria-hidden="true">/</span>
          <h1 class="truncate font-semibold" data-testid="page-title">{{ text(keys.page(current.id)) }}</h1>
        </div>
      </header>
      <div v-if="narrow && devTools" class="flex-none border-b px-4 py-3">
        <SwitchField :model-value="showDisabled" :label="t('app.showDisabled')" :description="t('app.showDisabledHint')" data-testid="disable-all" @update:model-value="setShowDisabled" />
      </div>

      <main ref="scroller" class="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin]" data-testid="playground-main">
        <div ref="holder">
          <div :id="current.id" :key="current.id" class="flex flex-col gap-6 py-6" :class="narrow ? 'px-4' : 'px-6'" :data-testid="`page-${current.id}`">
            <p class="text-muted-foreground text-sm">{{ text(keys.intro(current.id)) }}</p>
            <ExampleBox v-for="item in examples" :key="item.name" :name="item.name" :example="item.example" :title="item.title" :note="item.note" :rule="item.rule" :disabled="off" />
            <EmptyState v-if="!examples.length" :title="t('app.comingTitle')" :description="t('app.coming')" class="rounded-lg border" />
          </div>
        </div>
      </main>
    </div>
    <Toaster />
  </div>
</template>
