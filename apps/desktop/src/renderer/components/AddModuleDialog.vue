<script setup lang="ts">
// The module library: every installed module, to open in the current game. The list on the left
// picks what is shown: all modules, the ones already in this game, one kind of module, or Tavora's
// catalog (CatalogBrowse.vue). Each module is a card with its Add; a module with panel types lists
// them on its card, each with its own Add (the decision log, named panels round 1), and an Add all
// that opens one of each; adding one of those panels keeps the library open for the next. A module
// made for other games (its manifest's `games`) is not listed at all.
import { computed, ref } from "vue";
import { addModule, dialog, openSettings, state, type AddModuleRequest } from "../host";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { Blocks, Code, Download, Gamepad2, Search, Settings2, ShieldCheck, Store, X } from "@lucide/vue";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import ModuleIcon from "./ModuleIcon.vue";
import CatalogBrowse from "./CatalogBrowse.vue";

type ModuleView = NonNullable<typeof state.value>["modules"][number];
type Kind = "official" | "local" | "development";
/** What the library shows: installed modules (all, the ones in this game, or one kind), or the catalog. */
type View = "all" | "inGame" | Kind | "catalog";

const KINDS: Kind[] = ["official", "local", "development"];
const VIEWS = [
  { id: "all", icon: Blocks },
  { id: "inGame", icon: Gamepad2 },
  { id: "official", icon: ShieldCheck },
  { id: "local", icon: Download },
  { id: "development", icon: Code },
] as const;

/** Who publishes a module: Tavora itself, or a package found on this computer. */
const provenanceLabel = (provenance: "official" | "local") => (provenance === "official" ? t("common.official") : t("common.local"));

/** The one kind a module is listed under; playgrounds and examples go to Development. */
function kindOf(module: ModuleView): Kind {
  return module.development ? "development" : module.provenance;
}

const view = ref<View>("all");
const query = ref("");
/** How many modules the catalog lists for the search, once it has loaded. */
const catalogCount = ref<number | null>(null);

// Count modules, not panels: a module can have several panels in this game.
const panelCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const panel of state.value!.panels) counts.set(panel.moduleId, (counts.get(panel.moduleId) ?? 0) + 1);
  return counts;
});
const searched = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  return state.value!.modules.filter(
    (module) =>
      module.available &&
      (!text || [module.name, module.description ?? "", module.id, ...module.panels.map((type) => type.name)].some((value) => value.toLocaleLowerCase().includes(text))),
  );
});

function inView(module: ModuleView, id: View): boolean {
  if (id === "all") return true;
  if (id === "inGame") return openCount(module.id) > 0;
  return kindOf(module) === id;
}

function count(id: View): number {
  return searched.value.filter((module) => inView(module, id)).length;
}

/** The modules shown, by kind; a kind with nothing shown is left out. */
const groups = computed(() => {
  const shown = searched.value.filter((module) => inView(module, view.value));
  return KINDS.map((id) => ({ id, label: t(`addModule.category.${id}`), items: shown.filter((module) => kindOf(module) === id).sort((a, b) => a.name.localeCompare(b.name)) })).filter(
    (group) => group.items.length,
  );
});
const resultCount = computed(() => groups.value.reduce((total, group) => total + group.items.length, 0));
/** Headings only where the list mixes kinds. */
const showHeadings = computed(() => view.value === "all" || view.value === "inGame");

const title = computed(() => (view.value === "catalog" ? t("addModule.tab.browse") : t(`addModule.category.${view.value}`)));
/** The header's icon: the chosen view's own from the list on the left. */
const viewIcon = computed(() => (view.value === "catalog" ? Store : (VIEWS.find((item) => item.id === view.value)?.icon ?? Blocks)));
const shownCount = computed(() => (view.value === "catalog" ? catalogCount.value : resultCount.value));

/** How many panels of a module (of one of its panel types, if given) are already open in this game. */
function openCount(moduleId: string, panelType?: string): number {
  if (panelType === undefined) return panelCounts.value.get(moduleId) ?? 0;
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId && panel.panelType === panelType).length;
}

/**
 * Adds it, or asks for what it needs first (the consent dialog takes this dialog's place). A module
 * with panel types keeps the library open, so the player can add several of its panels in a row.
 */
function add(moduleId: string, panelTypes: string[] = []) {
  addModule(moduleId, (dialog.value as AddModuleRequest).slot ?? null, panelTypes, { stay: panelTypes.length > 0 });
}

function manage() {
  dialog.value = null;
  openSettings({ section: "modules" });
}

function reset() {
  query.value = "";
  view.value = "all";
}

/** Enter opens the first module listed. */
function submit() {
  if (view.value === "catalog") return;
  const first = groups.value[0]?.items[0];
  if (first) add(first.id);
}

const ADD_CLASS = "border-primary/50 text-primary hover:bg-primary/10 hover:text-primary shrink-0";
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && (dialog = null)">
    <DialogContent
      class="bg-card flex h-[min(880px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:flex-row"
      data-testid="add-module-dialog"
      :show-close-button="false"
      :aria-describedby="undefined"
    >
      <aside class="bg-background flex shrink-0 flex-col gap-4 border-b p-4 sm:w-64 sm:gap-5 sm:border-r sm:border-b-0">
        <DialogTitle class="hidden px-2 pt-1 text-xl font-semibold sm:block">{{ t("addModule.title") }}</DialogTitle>
        <form class="relative" @submit.prevent="submit">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" aria-hidden="true" />
          <label class="sr-only" for="module-search">{{ t("addModule.search") }}</label>
          <Input id="module-search" v-model="query" class="h-10 pr-3 pl-9" :placeholder="t('addModule.search')" autocomplete="off" data-testid="module-search" autofocus />
        </form>
        <nav class="flex gap-0.5 overflow-x-auto sm:flex-col" :aria-label="t('addModule.categories')">
          <h3 class="text-muted-foreground hidden px-3 pb-1 text-xs font-semibold tracking-wider uppercase sm:block">{{ t("addModule.installed") }}</h3>
          <button
            v-for="item in VIEWS"
            :key="item.id"
            type="button"
            :class="
              cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground group flex h-9 shrink-0 items-center gap-3 rounded-lg px-3 text-left font-medium whitespace-nowrap',
                view === item.id && 'bg-primary/10 text-foreground hover:bg-primary/15',
              )
            "
            :aria-pressed="view === item.id"
            :title="t(`addModule.about.${item.id}`)"
            :data-testid="`module-category-${item.id}`"
            @click="view = item.id"
          >
            <component :is="item.icon" :class="cn('hidden size-4 flex-none transition-colors sm:block', view === item.id ? 'text-primary' : 'group-hover:text-primary/80')" :stroke-width="1.75" />
            <span class="flex-1 truncate">{{ t(`addModule.category.${item.id}`) }}</span>
            <span :class="cn('text-xs tabular-nums', view === item.id ? 'text-primary' : 'text-muted-foreground')">{{ count(item.id) }}</span>
          </button>
          <h3 class="text-muted-foreground hidden px-3 pt-4 pb-1 text-xs font-semibold tracking-wider uppercase sm:block">{{ t("addModule.more") }}</h3>
          <button
            type="button"
            :class="
              cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground group flex h-9 shrink-0 items-center gap-3 rounded-lg px-3 text-left font-medium whitespace-nowrap',
                view === 'catalog' && 'bg-primary/10 text-foreground hover:bg-primary/15',
              )
            "
            :aria-pressed="view === 'catalog'"
            :title="t('addModule.about.catalog')"
            data-testid="module-tab-browse"
            @click="view = 'catalog'"
          >
            <Store :class="cn('hidden size-4 flex-none transition-colors sm:block', view === 'catalog' ? 'text-primary' : 'group-hover:text-primary/80')" :stroke-width="1.75" />
            <span class="flex-1">{{ t("addModule.tab.browse") }}</span>
          </button>
        </nav>
        <Button variant="ghost" class="text-muted-foreground justify-start sm:mt-auto" data-testid="manage-modules" @click="manage">
          <Settings2 :stroke-width="1.5" /> {{ t("addModule.manage") }}
        </Button>
      </aside>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="flex h-[72px] shrink-0 items-center gap-3 border-b px-5 sm:px-8">
          <span class="bg-primary/15 text-primary flex size-10 flex-none items-center justify-center rounded-lg" aria-hidden="true">
            <component :is="viewIcon" class="size-5" :stroke-width="1.75" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex min-w-0 items-baseline gap-3">
              <h2 class="truncate text-xl font-semibold" data-testid="module-view-title">{{ title }}</h2>
              <span v-if="shownCount !== null" class="text-muted-foreground text-sm tabular-nums" role="status" data-testid="module-result-count">{{
                t("addModule.results", { count: shownCount })
              }}</span>
            </div>
            <p class="text-muted-foreground truncate text-sm" data-testid="module-view-about">{{ t(`addModule.about.${view}`) }}</p>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" class="flex-none" :aria-label="t('common.close')" :title="t('common.close')"><X :stroke-width="1.5" /></Button>
          </DialogClose>
        </header>

        <CatalogBrowse v-if="view === 'catalog'" :query="query" @count="catalogCount = $event" />
        <div v-else class="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8" data-testid="module-results">
          <section v-for="group in groups" :key="group.id" :aria-label="group.label" class="pt-6">
            <h3 v-if="showHeadings" class="text-primary flex items-center gap-2 pb-3 text-xs font-semibold tracking-wider uppercase">
              {{ group.label }} <span class="text-muted-foreground tabular-nums">{{ group.items.length }}</span>
            </h3>
            <ul class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              <li
                v-for="module in group.items"
                :key="module.id"
                :class="cn('bg-background/40 hover:border-primary/40 flex flex-col gap-3 rounded-xl border p-4 transition-colors', openCount(module.id) && 'border-primary/30 bg-primary/5')"
                :data-testid="`module-${module.id}`"
              >
                <div class="flex items-start gap-3">
                  <span class="bg-primary/10 border-primary/20 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg border" aria-hidden="true"><ModuleIcon :module-id="module.id" size="size-5" /></span>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate font-medium" :title="module.name">{{ module.name }}</span>
                      <span
                        :class="cn('shrink-0 rounded-sm border px-1.5 text-xs', module.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')"
                        :data-testid="`provenance-${module.id}`"
                        >{{ provenanceLabel(module.provenance) }}</span
                      >
                    </div>
                    <p v-if="module.description" class="text-muted-foreground mt-0.5 line-clamp-2 text-sm" :title="module.description">{{ module.description }}</p>
                  </div>
                </div>
                <div v-if="!module.panels.length" class="mt-auto flex items-center gap-2">
                  <span v-if="openCount(module.id)" class="text-primary text-xs" :data-testid="`in-game-${module.id}`">{{ t("addModule.inGame", { count: openCount(module.id) }) }}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    :class="cn(ADD_CLASS, 'ml-auto')"
                    :data-testid="`open-${module.id}`"
                    :aria-label="t('addModule.addLabel', { name: module.name })"
                    @click="add(module.id)"
                    >{{ openCount(module.id) ? t("addModule.addAnother") : t("common.add") }}</Button
                  >
                </div>
                <ul v-else class="mt-auto flex flex-col gap-1 border-t pt-3" :aria-label="t('addModule.panels', { name: module.name })" :data-testid="`panel-types-${module.id}`">
                  <li v-if="module.panels.length > 1" class="flex items-center justify-end pb-1">
                    <Button
                      size="sm"
                      variant="outline"
                      :class="cn(ADD_CLASS, 'h-7')"
                      :data-testid="`open-all-${module.id}`"
                      :aria-label="t('addModule.addAllLabel', { name: module.name })"
                      @click="add(module.id, module.panels.map((type) => type.id))"
                      >{{ t("addModule.addAll") }}</Button
                    >
                  </li>
                  <li v-for="type in module.panels" :key="type.id" class="flex items-center gap-2">
                    <ModuleIcon :module-id="module.id" :panel-type="type.id" />
                    <span class="min-w-0 flex-1 truncate text-sm">{{ type.name }}</span>
                    <span v-if="openCount(module.id, type.id)" class="text-primary text-xs">{{ t("addModule.open", { count: openCount(module.id, type.id) }) }}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      :class="cn(ADD_CLASS, 'h-7')"
                      :data-testid="`open-${module.id}-${type.id}`"
                      :aria-label="t('addModule.addLabel', { name: `${module.name}: ${type.name}` })"
                      @click="add(module.id, [type.id])"
                      >{{ openCount(module.id, type.id) ? t("addModule.addAnother") : t("common.add") }}</Button
                    >
                  </li>
                </ul>
              </li>
            </ul>
          </section>
          <div v-if="!groups.length" class="text-muted-foreground py-16 text-center" data-testid="module-search-empty">
            <p>{{ query.trim() ? t("addModule.none", { query: query.trim() }) : t("addModule.emptyFilter") }}</p>
            <Button variant="ghost" class="mt-3" @click="reset">{{ t("addModule.reset") }}</Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
