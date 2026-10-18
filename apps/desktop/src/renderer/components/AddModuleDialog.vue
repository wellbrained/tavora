<script setup lang="ts">
// The module library: every installed module, to open in the current game. A module with panel
// types lists them under its row, each with its own Add (the decision log, named panels round 1).
// A module made for other games (its manifest's `games`) is not listed at all. The Browse tab lists
// modules from Tavora's catalog instead (CatalogBrowse.vue).
import { computed, ref } from "vue";
import { addModule, dialog, openSettings, state, type AddModuleRequest } from "../host";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { Search, Settings2 } from "@lucide/vue";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import SegmentedControl from "./settings/SegmentedControl.vue";
import ModuleIcon from "./ModuleIcon.vue";
import CatalogBrowse from "./CatalogBrowse.vue";

/** Who publishes a module: Tavora itself, or a package found on this computer. */
const provenanceLabel = (provenance: "official" | "local") => (provenance === "official" ? t("common.official") : t("common.local"));

type Category = "all" | "official" | "local" | "development";

const CATEGORY_IDS: Category[] = ["all", "official", "local", "development"];
const CATEGORIES = computed(() => CATEGORY_IDS.map((id) => ({ id, label: t(`addModule.category.${id}`) })));

type ModuleView = NonNullable<typeof state.value>["modules"][number];

/** The one category a module is listed under; playgrounds and examples go to Development. */
function categoryOf(module: ModuleView): Exclude<Category, "all"> {
  return module.development ? "development" : module.provenance;
}

type Tab = "installed" | "browse";
const tab = ref<Tab>("installed");
const TABS = computed(() => (["installed", "browse"] as const).map((value) => ({ value, label: t(`addModule.tab.${value}`), testid: `module-tab-${value}` })));

const query = ref("");
const category = ref<Category>("all");
type GameFilter = "all" | "inGame" | "notInGame";
const gameFilter = ref<GameFilter>("all");
const FILTER_IDS: GameFilter[] = ["all", "inGame", "notInGame"];

// Count modules, not panels: a module can have several panels in this game.
const panelCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const panel of state.value!.panels) counts.set(panel.moduleId, (counts.get(panel.moduleId) ?? 0) + 1);
  return counts;
});
const searched = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  return state.value!.modules.filter((module) => module.available && (
    !text || [module.name, module.description ?? "", module.id, ...module.panels.map((type) => type.name)].some((value) => value.toLocaleLowerCase().includes(text))),
  );
});
function matchesGame(module: ModuleView, filter: GameFilter): boolean {
  return filter === "all" || (filter === "inGame" ? openCount(module.id) > 0 : openCount(module.id) === 0);
}
const inCategory = computed(() => searched.value.filter((module) => category.value === "all" || categoryOf(module) === category.value));
const filters = computed(() => FILTER_IDS.map((value) => ({
  value,
  label: t(`addModule.filter.${value}`) + " (" + inCategory.value.filter((module) => matchesGame(module, value)).length + ")",
  testid: `module-filter-${value}`,
})));
const resultCount = computed(() => groups.value.reduce((total, group) => total + group.items.length, 0));

function manage() {
  dialog.value = null;
  openSettings({ section: "modules" });
}

function count(id: Category): number {
  return searched.value.filter((module) => (id === "all" || categoryOf(module) === id) && matchesGame(module, gameFilter.value)).length;
}

const groups = computed(() => {
  const matches = inCategory.value.filter((module) => matchesGame(module, gameFilter.value));
  return CATEGORIES.value.filter((item) => item.id !== "all")
    .map((item) => ({ ...item, items: matches.filter((module) => categoryOf(module) === item.id).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((group) => group.items.length);
});

/** How many panels of a module (of one of its panel types, if given) are already open in this game. */
function openCount(moduleId: string, panelType?: string): number {
  if (panelType === undefined) return panelCounts.value.get(moduleId) ?? 0;
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId && panel.panelType === panelType).length;
}

/** Adds it, or asks for what it needs first (the consent dialog takes this dialog's place). */
function add(moduleId: string, panelType?: string) {
  addModule(moduleId, (dialog.value as AddModuleRequest).slot ?? null, panelType);
}

/** Enter opens the first module listed. */
function submit() {
  if (tab.value === "browse") return;
  const first = groups.value[0]?.items[0];
  if (first) add(first.id);
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && (dialog = null)">
    <DialogContent
      class="bg-card flex h-[min(760px,calc(100vh-48px))] w-[min(1040px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:flex-row"
      data-testid="add-module-dialog"
      :aria-describedby="undefined"
    >
      <aside class="bg-background flex shrink-0 flex-col border-b p-3 sm:w-60 sm:border-r sm:border-b-0">
        <div class="mb-3">
          <SegmentedControl v-model="tab" :options="TABS" :label="t('addModule.tabs')" />
        </div>
        <form class="relative" @submit.prevent="submit">
          <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-3 size-4" :stroke-width="1.5" aria-hidden="true" />
          <label class="sr-only" for="module-search">{{ t("addModule.search") }}</label>
          <Input id="module-search" v-model="query" class="pr-8 pl-9" :placeholder="t('addModule.search')" autocomplete="off" data-testid="module-search" autofocus />
        </form>
        <nav v-if="tab === 'installed'" class="mt-4 flex gap-0.5 overflow-x-auto sm:flex-col" :aria-label="t('addModule.categories')">
          <button
            v-for="item in CATEGORIES" :key="item.id" type="button"
            :class="cn('hover:bg-accent flex h-9 items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 text-left text-sm', category === item.id && 'bg-accent text-foreground font-medium')"
            :aria-pressed="category === item.id" :data-testid="`module-category-${item.id}`" @click="category = item.id"
          >
            <span class="truncate">{{ item.label }}</span>
            <span class="text-muted-foreground text-xs tabular-nums">{{ count(item.id) }}</span>
          </button>
        </nav>
        <Button variant="ghost" class="mt-3 justify-start sm:mt-auto" data-testid="manage-modules" @click="manage">
          <Settings2 :stroke-width="1.5" /> {{ t("addModule.manage") }}
        </Button>
      </aside>
      <div v-if="tab === 'browse'" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="shrink-0 border-b px-5 pt-5 pb-4 sm:px-8">
          <DialogTitle class="pr-6 text-xl">{{ t("addModule.title") }}</DialogTitle>
          <p class="text-muted-foreground mt-1 text-sm">{{ t("catalog.hint") }}</p>
        </header>
        <CatalogBrowse :query="query" />
      </div>
      <div v-else class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="shrink-0 border-b px-5 pt-5 pb-4 sm:px-8">
          <DialogTitle class="pr-6 text-xl">{{ t("addModule.title") }}</DialogTitle>
          <p class="text-muted-foreground mt-1 hidden text-sm sm:block">{{ t("addModule.hint") }}</p>
          <div class="mt-4 overflow-x-auto pb-1">
            <SegmentedControl v-model="gameFilter" :options="filters" :label="t('addModule.filterLabel')" />
          </div>
          <p class="text-muted-foreground mt-3 text-xs" role="status" data-testid="module-result-count">{{ t("addModule.results", { count: resultCount }) }}</p>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-8" data-testid="module-results">
          <section v-for="group in groups" :key="group.id" :aria-label="group.label" class="pt-5">
            <h3 class="text-muted-foreground flex items-center gap-2 pb-1 text-sm font-medium">
              {{ group.label }} <span class="text-xs tabular-nums">{{ group.items.length }}</span>
            </h3>
            <ul class="flex flex-col">
              <li v-for="module in group.items" :key="module.id"
                class="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
                :data-testid="`module-${module.id}`"
              >
                <span class="bg-background text-primary flex size-9 shrink-0 items-center justify-center rounded-lg border" aria-hidden="true"><ModuleIcon :module-id="module.id" size="size-5" /></span>
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span class="max-w-full truncate font-medium" :title="module.name">{{ module.name }}</span>
                    <span :class="cn('shrink-0 rounded-sm border px-1.5 text-xs', module.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')" :data-testid="`provenance-${module.id}`">{{ provenanceLabel(module.provenance) }}</span>
                    <span v-if="openCount(module.id)" class="text-primary text-xs" :data-testid="`in-game-${module.id}`">{{ t("addModule.inGame", { count: openCount(module.id) }) }}</span>
                  </div>
                  <p v-if="module.description" class="text-muted-foreground line-clamp-2 text-sm" :title="module.description">{{ module.description }}</p>
                </div>
                <Button v-if="!module.panels.length" size="sm" variant="outline" class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary shrink-0"
                  :data-testid="`open-${module.id}`" :aria-label="t('addModule.addLabel', { name: module.name })" @click="add(module.id)"
                >{{ openCount(module.id) ? t("addModule.addAnother") : t("common.add") }}</Button>
                <ul v-else class="flex basis-full flex-col gap-1 pl-12" :aria-label="t('addModule.panels', { name: module.name })" :data-testid="`panel-types-${module.id}`">
                  <li v-for="type in module.panels" :key="type.id" class="flex items-center gap-2">
                    <ModuleIcon :module-id="module.id" :panel-type="type.id" />
                    <span class="min-w-0 flex-1 truncate text-sm">{{ type.name }}</span>
                    <span v-if="openCount(module.id, type.id)" class="text-muted-foreground text-xs">{{ t("addModule.open", { count: openCount(module.id, type.id) }) }}</span>
                    <Button size="sm" variant="outline" class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary h-7 shrink-0"
                      :data-testid="`open-${module.id}-${type.id}`" :aria-label="t('addModule.addLabel', { name: `${module.name}: ${type.name}` })" @click="add(module.id, type.id)"
                    >{{ openCount(module.id, type.id) ? t("addModule.addAnother") : t("common.add") }}</Button>
                  </li>
                </ul>
              </li>
            </ul>
          </section>
          <div v-if="!groups.length" class="text-muted-foreground py-12 text-center text-sm" data-testid="module-search-empty">
            <p>{{ query.trim() ? t("addModule.none", { query: query.trim() }) : t("addModule.emptyFilter") }}</p>
            <Button variant="ghost" class="mt-3" @click="query = ''; category = 'all'; gameFilter = 'all'">{{ t("addModule.reset") }}</Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
