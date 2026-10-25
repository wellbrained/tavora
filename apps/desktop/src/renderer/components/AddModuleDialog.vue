<script setup lang="ts">
// The module library: every installed module, to open in the current game. The list on the left
// picks what is shown: all modules, the ones already in this game, one kind of module, or Tavora's
// catalog (CatalogBrowse.vue). Each module is a card with its Add; a module with panel types lists
// them in a list that drops over the card below, each with its own Add (the decision log, named
// panels round 1), next to an Add all that opens one of each; adding one of those panels keeps the
// library open for the next. A module
// made for other games (its manifest's `games`) is not listed at all. A card's icon or name opens the
// module's page (CatalogModuleDialog.vue), from the catalog or, without it, from the module's own files.
import { computed, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { account, act, addModule, dialog, openSettings, publishModule, saveModuleZip, state, type AddModuleRequest, type MenuItem } from "../host";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { Blocks, ChevronDown, CloudDownload, Code, Download, Gamepad2, Search, Settings2, ShieldCheck, Store, X } from "@lucide/vue";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import ModuleIcon from "./ModuleIcon.vue";
import CatalogBrowse from "./CatalogBrowse.vue";
import CatalogModuleDialog from "./CatalogModuleDialog.vue";
import { pageModule } from "../module-page";
import ModuleUpdates from "./ModuleUpdates.vue";
import MenuButton from "./menus/MenuButton.vue";
import { MODULE_TAG_TEXT, moduleTag, type TaggedModule } from "../../shared/module-tag";

type ModuleView = NonNullable<typeof state.value>["modules"][number];
type Kind = "official" | "local" | "development";
/** What the library shows: installed modules (all, the ones in this game, or one kind), or the catalog. */
type View = "all" | "inGame" | Kind | "catalog" | "updates";

const KINDS: Kind[] = ["official", "local", "development"];
const VIEWS = [
  { id: "all", icon: Blocks },
  { id: "inGame", icon: Gamepad2 },
  { id: "official", icon: ShieldCheck },
  { id: "local", icon: Download },
  { id: "development", icon: Code },
] as const;

/** Who publishes a module: Tavora itself, or a package found on this computer. */
/** Where this copy of a module came from: Official, Catalog, From file, Local, Release or Example (shared/module-tag.ts). */
const provenanceLabel = (module: TaggedModule) => t(MODULE_TAG_TEXT[moduleTag(module)]);

/** The one kind a module is listed under; playgrounds and examples go to Development. */
function kindOf(module: ModuleView): Kind {
  return module.development ? "development" : module.provenance;
}

/** A module whose catalog page to open, such as one just published: the library starts in the catalog. */
const browse = (dialog.value as AddModuleRequest).browse;
const view = ref<View>(browse ? "catalog" : ((dialog.value as AddModuleRequest).view ?? "all"));
/** How many modules have an update waiting. The Updates entry is listed while there are some (and while it is open, so it can say all is done). */
const updateCount = computed(() => state.value!.modules.filter((module) => module.update).length);
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

/** The list on the left: the installed modules by view, then Updates (while there are some) and the catalog. */
const navGroups = computed<NavGroup[]>(() => [
  {
    heading: t("addModule.installed"),
    items: VIEWS.map((item) => ({
      id: item.id,
      label: t(`addModule.category.${item.id}`),
      icon: item.icon,
      badge: count(item.id),
      title: t(`addModule.about.${item.id}`),
      testid: `module-category-${item.id}`,
    })),
  },
  {
    heading: t("addModule.more"),
    items: [
      ...(updateCount.value || view.value === "updates"
        ? [{ id: "updates", label: t("addModule.category.updates"), icon: CloudDownload, badge: updateCount.value, badgeAccent: true, badgeTestid: "module-updates-count", title: t("addModule.about.updates"), testid: "module-category-updates" }]
        : []),
      { id: "catalog", label: t("addModule.tab.browse"), icon: Store, title: t("addModule.about.catalog"), testid: "module-tab-browse" },
    ],
  },
]);

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
const viewIcon = computed(() => (view.value === "catalog" ? Store : view.value === "updates" ? CloudDownload : (VIEWS.find((item) => item.id === view.value)?.icon ?? Blocks)));
const shownCount = computed(() => (view.value === "catalog" ? catalogCount.value : view.value === "updates" ? updateCount.value : resultCount.value));

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

/** The module whose page is open, and the report being sent from it (the catalog ones). */
const info = ref<ModuleView | null>(null);
const infoError = ref<string | undefined>();
const reporting = ref(false);
const reported = ref<Set<string>>(new Set());

function openInfo(module: ModuleView) {
  infoError.value = undefined;
  info.value = module;
}

/** Add on the page does what the card's Add does, then the page closes. */
function addFromInfo(module: ModuleView) {
  add(module.id, module.panels.map((type) => type.id));
  info.value = null;
}

async function report(module: ModuleView) {
  reporting.value = true;
  const outcome = await act({ type: "report-catalog-module", moduleId: module.id }, { quiet: true });
  reporting.value = false;
  if (outcome.ok) reported.value = new Set([...reported.value, module.id]);
  else infoError.value = outcome.error;
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
  if (view.value === "catalog" || view.value === "updates") return;
  const first = groups.value[0]?.items[0];
  if (first) add(first.id);
}

/** The module whose panel list is open, if any. */
const expanded = ref<string | null>(null);

function toggle(moduleId: string) {
  expanded.value = expanded.value === moduleId ? null : moduleId;
}

// A click outside its card closes the panel list.
useEventListener(document, "pointerdown", (event) => {
  if (expanded.value && !(event.target as Element | null)?.closest(`[data-panel-menu="${CSS.escape(expanded.value)}"]`)) expanded.value = null;
});

/** Escape closes an open panel list before the library itself. */
function closeMenuFirst(event: KeyboardEvent) {
  if (!expanded.value) return;
  event.preventDefault();
  expanded.value = null;
}

/** A module from a project folder can be published or saved as a zip from its menu (with accounts on). */
function projectMenu(module: ModuleView): MenuItem[] {
  return [
    { label: t("publish.button"), testid: `menu-publish-${module.id}`, run: () => publishModule(module.id) },
    { label: t("publish.saveZip"), testid: `menu-save-zip-${module.id}`, run: () => saveModuleZip(module.id) },
  ];
}
const accounts = computed(() => account.value?.enabled === true);

const ADD_CLASS = "border-primary/50 text-primary hover:bg-primary/10 hover:text-primary shrink-0";
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && (dialog = null)">
    <DialogContent
      class="bg-card flex h-[min(880px,calc(100vh-48px))] w-[min(1240px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:flex-row"
      data-testid="add-module-dialog"
      :show-close-button="false"
      :aria-describedby="undefined"
      @escape-key-down="closeMenuFirst"
    >
      <aside class="bg-background flex shrink-0 flex-col gap-4 border-b p-4 sm:w-64 sm:gap-5 sm:border-r sm:border-b-0">
        <DialogTitle class="sr-only px-2 pt-1 text-xl font-semibold sm:not-sr-only">{{ t("addModule.title") }}</DialogTitle>
        <form class="relative" @submit.prevent="submit">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" aria-hidden="true" />
          <label class="sr-only" for="module-search">{{ t("addModule.search") }}</label>
          <Input id="module-search" v-model="query" class="h-10 pr-3 pl-9" :placeholder="t('addModule.search')" autocomplete="off" data-testid="module-search" autofocus />
        </form>
        <NavList v-model="view" class="flex-row overflow-x-auto sm:flex-col" heading-class="hidden sm:block" icon-class="hidden sm:block" :label="t('addModule.categories')" :groups="navGroups" />
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

        <CatalogBrowse v-if="view === 'catalog'" :query="query" :open="browse" @count="catalogCount = $event" />
        <ModuleUpdates v-else-if="view === 'updates'" :query="query" />
        <div v-else class="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8" data-testid="module-results">
          <section v-for="group in groups" :key="group.id" :aria-label="group.label" class="pt-6">
            <h3 v-if="showHeadings" class="text-primary flex items-center gap-2 pb-3 text-xs font-semibold tracking-wider uppercase">
              {{ group.label }} <span class="text-muted-foreground tabular-nums">{{ group.items.length }}</span>
            </h3>
            <ul class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              <li
                v-for="module in group.items"
                :key="module.id"
                :class="
                  cn(
                    'bg-background/40 hover:border-primary/40 relative flex flex-col gap-3 rounded-xl border p-4 transition-colors',
                    openCount(module.id) && 'border-primary/30 bg-primary/5',
                    expanded === module.id && 'border-primary/40 z-10 rounded-b-none',
                  )
                "
                :data-testid="`module-${module.id}`"
                :data-panel-menu="module.id"
              >
                <div class="flex items-start gap-3">
                  <button type="button" class="bg-primary/10 border-primary/20 text-primary focus-visible:ring-ring flex size-10 shrink-0 items-center justify-center rounded-lg border outline-none focus-visible:ring-2" tabindex="-1" aria-hidden="true" @click="openInfo(module)">
                    <ModuleIcon :module-id="module.id" size="size-[34px]" />
                  </button>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <button type="button" class="hover:text-primary focus-visible:ring-ring truncate rounded-sm text-left font-medium outline-none focus-visible:ring-2" :title="module.name"
                        :aria-label="t('catalog.infoLabel', { name: module.name })" :data-testid="`module-name-${module.id}`" @click="openInfo(module)"
                      >{{ module.name }}</button>
                      <Badge
                        variant="outline"
                        :class="cn('py-0 font-normal', module.provenance === 'official' ? 'border-primary/40 text-primary' : 'text-muted-foreground')"
                        :data-testid="`provenance-${module.id}`"
                        >{{ provenanceLabel(module) }}</Badge
                      >
                      <MenuButton
                        v-if="module.project && accounts"
                        :items="() => projectMenu(module)"
                        :title="module.name"
                        :label="t('publish.more', { name: module.name })"
                        :testid="`module-menu-${module.id}`"
                        side="bottom"
                        align="end"
                        class="-my-1 ml-auto"
                      />
                    </div>
                    <p v-if="module.description" class="text-muted-foreground mt-0.5 line-clamp-2 text-sm" :title="module.description">{{ module.description }}</p>
                  </div>
                </div>
                <div class="mt-auto flex items-center gap-2 pl-13">
                  <template v-if="module.panels.length > 1">
                    <button
                      type="button"
                      class="text-muted-foreground hover:text-foreground min-w-0 flex-1 truncate text-left text-xs transition-colors"
                      :aria-expanded="expanded === module.id"
                      :aria-controls="`panel-menu-${module.id}`"
                      :data-testid="`panel-count-${module.id}`"
                      @click="toggle(module.id)"
                    >
                      {{ t("addModule.panelCount", { count: module.panels.length }) }}
                      <template v-if="openCount(module.id)">
                        · <span class="text-primary" :data-testid="`in-game-${module.id}`">{{ t("addModule.inGame", { count: openCount(module.id) }) }}</span>
                      </template>
                    </button>
                    <ButtonGroup class="shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        :class="ADD_CLASS"
                        :data-testid="`open-all-${module.id}`"
                        :aria-label="t('addModule.addAllLabel', { name: module.name })"
                        @click="add(module.id, module.panels.map((type) => type.id))"
                        >{{ t("addModule.addAll") }}</Button
                      >
                      <Button
                        size="sm"
                        variant="outline"
                        :class="cn(ADD_CLASS, 'px-2')"
                        :aria-label="t('addModule.showPanels', { name: module.name })"
                        :aria-expanded="expanded === module.id"
                        :aria-controls="`panel-menu-${module.id}`"
                        :data-testid="`panel-menu-toggle-${module.id}`"
                        @click="toggle(module.id)"
                        ><ChevronDown :class="cn('size-4 transition-transform motion-reduce:transition-none', expanded === module.id && 'rotate-180')" :stroke-width="1.75"
                      /></Button>
                    </ButtonGroup>
                  </template>
                  <template v-else>
                    <span v-if="openCount(module.id)" class="text-primary text-xs" :data-testid="`in-game-${module.id}`">{{ t("addModule.inGame", { count: openCount(module.id) }) }}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      :class="cn(ADD_CLASS, 'ml-auto')"
                      :data-testid="`open-${module.id}`"
                      :aria-label="t('addModule.addLabel', { name: module.name })"
                      @click="add(module.id, module.panels.map((type) => type.id))"
                      >{{ openCount(module.id) ? t("addModule.addAnother") : t("common.add") }}</Button
                    >
                  </template>
                </div>
                <!-- Drops over the card below, so the grid keeps its rows. -->
                <div
                  v-if="expanded === module.id"
                  :id="`panel-menu-${module.id}`"
                  class="bg-card absolute inset-x-[-1px] top-[calc(100%-0.5rem)] z-10 rounded-b-xl border border-t-0 border-primary/40 shadow-xl"
                >
                  <div :class="cn('bg-background/40 rounded-b-xl px-4 pt-2 pb-3', openCount(module.id) && 'bg-primary/5')">
                    <ul class="flex flex-col gap-1 border-t pt-3" :aria-label="t('addModule.panels', { name: module.name })" :data-testid="`panel-types-${module.id}`">
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
                  </div>
                </div>
              </li>
            </ul>
          </section>
          <div v-if="!groups.length" class="text-muted-foreground py-16 text-center" data-testid="module-search-empty">
            <p>{{ query.trim() ? t("addModule.none", { query: query.trim() }) : t("addModule.emptyFilter") }}</p>
            <Button variant="ghost" class="mt-3" @click="reset">{{ t("addModule.reset") }}</Button>
          </div>
        </div>
      </div>
      <CatalogModuleDialog v-if="info" :module="pageModule(info)" :local="info" installed :installing="false" :error="infoError" :reporting="reporting" :reported="reported.has(info.id)"
        @close="info = null" @add="addFromInfo(info)" @report="report(info)"
      />
    </DialogContent>
  </Dialog>
</template>
