<script setup lang="ts">
// The Codex: search items, recipes and buildings, and read one entry with
// links to the ones around it. Wide panels show the list beside the entry;
// narrow ones take turns. Each panel remembers its entry through panel.setContent.
import { ArrowLeft, Search, X } from "@lucide/vue";
import { SegmentedControl } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { Localized } from "../../contracts/data";
import { language, t } from "../../i18n";
import GameIcon from "../common/GameIcon.vue";
import { entryContentId, newPlanContentId, parseEntryContent } from "../content";
import { useModule, useNames } from "../context";
import { wikiUrl } from "../names";
import { search, type Entry, type EntryKind } from "../search";
import EntryView from "./EntryView.vue";

/** Below this width the list and the entry take turns. */
const NARROW_PX = 720;

type Filter = "all" | EntryKind;

const context = useModule();
const { sdk } = context;
const { data } = context.services;
const names = useNames(context);

const query = ref("");
const filter = ref<Filter>("all");
const entry = ref<Entry | null>(null);
const history = ref<Entry[]>([]);
const width = ref(window.innerWidth);
const narrow = computed(() => width.value < NARROW_PX);
/** In a narrow panel: whether the list or the entry is showing. */
const showList = ref(true);
const detail = ref<HTMLElement | null>(null);
const searchInput = ref<InstanceType<typeof Input> | null>(null);

const filters = computed(() => [
  { value: "all" as const, label: t("codex.all") },
  { value: "item" as const, label: t("codex.items") },
  { value: "recipe" as const, label: t("codex.recipes") },
  { value: "building" as const, label: t("codex.buildings") },
]);

const kinds = computed<EntryKind[]>(() => (filter.value === "all" ? ["item", "building", "recipe"] : [filter.value]));

/** With a query, the best matches; without one, everything of the kinds shown, A to Z. */
const hits = computed(() => {
  if (query.value.trim()) return search(data, query.value, language.value, { kinds: kinds.value, limit: 200 });
  const all: { kind: EntryKind; id: string; name: string }[] = [];
  for (const kind of kinds.value) {
    const source = kind === "item" ? data.items : kind === "recipe" ? data.recipes : data.buildings;
    for (const id of Object.keys(source)) all.push({ kind, id, name: names.entry({ kind, id }) });
  }
  return all.sort((a, b) => a.name.localeCompare(b.name));
});

const iconOf = (hit: Entry) => (hit.kind === "item" ? data.items[hit.id]?.icon : hit.kind === "building" ? data.buildings[hit.id]?.icon : undefined);
const isCurrent = (hit: Entry) => entry.value?.kind === hit.kind && entry.value.id === hit.id;

async function show(next: Entry | null, options: { remember?: boolean } = {}) {
  if (options.remember !== false && entry.value && next && !isCurrent(next)) history.value = [...history.value, entry.value];
  entry.value = next;
  if (next) showList.value = false;
  await sdk.panel.setContent(next ? { id: entryContentId(next), title: names.entry(next) } : null).catch(() => undefined);
  await nextTick();
  detail.value?.scrollTo({ top: 0 });
}

/** Back goes to the entry before, or in a narrow panel from an entry to the list. */
const canGoBack = computed(() => history.value.length > 0 || (narrow.value && !showList.value));

function back() {
  const previous = history.value[history.value.length - 1];
  if (previous) {
    history.value = history.value.slice(0, -1);
    void show(previous, { remember: false });
  } else showList.value = true;
}

function onQuery() {
  if (narrow.value) showList.value = true;
}

function clearSearch() {
  query.value = "";
  (searchInput.value?.$el as HTMLInputElement | undefined)?.focus();
}

function planThis(item: string) {
  void sdk.panels.open("planner", { content: { id: newPlanContentId(item), title: names.item(item) } }).catch(() => context.notify(t("notice.openFailed")));
}

function openWiki(name: Localized) {
  void sdk.links.open(wikiUrl(name)).catch(() => context.notify(t("notice.openFailed")));
}

const cleanup: (() => void)[] = [];
const onResize = () => (width.value = window.innerWidth);

onMounted(async () => {
  addEventListener("resize", onResize);
  cleanup.push(() => removeEventListener("resize", onResize));
  const launch = await sdk.panel.getLaunch().catch(() => ({ reason: "add" as const }));
  const content = launch.reason === "add" ? null : launch.content;
  const start = content ? parseEntryContent(content.id) : null;
  if (start) await show(start, { remember: false });
  cleanup.push(
    sdk.panel.onNavigate(async (next) => {
      const target = parseEntryContent(next.id);
      if (!target) throw new Error("not a Codex entry");
      await show(target);
    }),
  );
});

onBeforeUnmount(() => cleanup.forEach((fn) => fn()));
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col" data-testid="codex">
    <header class="border-primary/25 bg-primary/5 flex flex-none flex-wrap items-center gap-2 border-b p-2" data-testid="codex-toolbar">
      <div class="flex min-w-48 flex-1 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          class="flex-none"
          :aria-label="t('codex.back')"
          :title="t('codex.back')"
          :disabled="!canGoBack"
          data-testid="codex-back"
          @click="back"
        >
          <ArrowLeft :stroke-width="1.5" />
        </Button>
        <div class="relative min-w-0 flex-1">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" :stroke-width="1.5" />
          <Input
            ref="searchInput"
            v-model="query"
            class="h-8 pr-8 pl-8"
            type="search"
            :placeholder="t('codex.search')"
            :aria-label="t('codex.search')"
            spellcheck="false"
            data-testid="codex-search"
            @input="onQuery"
            @focus="onQuery"
          />
          <Button
            v-if="query"
            variant="ghost"
            size="icon-xs"
            class="absolute top-1/2 right-1 -translate-y-1/2"
            :aria-label="t('codex.clearSearch')"
            :title="t('codex.clearSearch')"
            @click="clearSearch"
          >
            <X :stroke-width="1.5" />
          </Button>
        </div>
      </div>
      <SegmentedControl v-if="!narrow || showList" v-model="filter" :options="filters" :label="t('codex.filter')" class="ml-auto flex-none" />
    </header>

    <div class="flex min-h-0 flex-1">
      <nav
        v-if="!narrow || showList"
        class="min-h-0 overflow-y-auto p-1"
        :class="narrow ? 'flex-1' : 'w-72 flex-none border-r'"
        :aria-label="t('codex.results')"
        data-testid="codex-results"
      >
        <p v-if="!hits.length" class="text-muted-foreground px-3 py-6 text-center text-sm">{{ t("codex.none", { query }) }}</p>
        <ul role="list">
          <li v-for="hit in hits" :key="`${hit.kind}:${hit.id}`">
            <button
              type="button"
              class="hover:bg-accent focus-visible:outline-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2"
              :class="isCurrent(hit) ? 'bg-accent font-medium' : ''"
              :aria-current="isCurrent(hit) ? 'true' : undefined"
              data-testid="codex-hit"
              @click="show(hit)"
            >
              <GameIcon v-if="hit.kind !== 'recipe'" :icon="iconOf(hit)" :kind="hit.kind === 'building' ? 'building' : 'item'" :size="20" />
              <span v-else class="w-5 flex-none" />
              <span class="min-w-0 flex-1 truncate">{{ hit.name }}</span>
              <span v-if="filter === 'all'" class="text-muted-foreground flex-none text-xs">{{ t(`codex.kind.${hit.kind}`) }}</span>
            </button>
          </li>
        </ul>
      </nav>

      <section v-if="!narrow || !showList" ref="detail" class="min-h-0 min-w-0 flex-1 overflow-y-auto p-4" data-testid="codex-detail">
        <EntryView v-if="entry" :key="entryContentId(entry)" :entry="entry" @go="show" @plan-this="planThis" @wiki="openWiki" />
        <p v-else class="text-muted-foreground py-12 text-center text-sm">{{ t("codex.pick") }}</p>
      </section>
    </div>
  </div>
</template>
