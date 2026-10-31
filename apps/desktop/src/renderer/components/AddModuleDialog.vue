<script setup lang="ts">
// The module library: every installed module, to open in the current workspace. The menu on the left
// works like Settings' (plates in groups, the search on top, Module settings at its foot) and picks what
// is shown: all modules (in sections by kind), the ones already in this workspace, updates, Tavora's
// catalog (CatalogBrowse.vue), and for developers their own. Each module is a card with its Add; a module with panel types lists
// them in a list that drops over the card below, each with its own Add (the decision log, named
// panels round 1), next to an Add all that opens one of each; adding one of those panels keeps the
// library open for the next. A module
// made for other games (its manifest's `games`) is not listed at all. A card's icon or name opens the
// module's page (CatalogModuleDialog.vue), from the catalog or, without it, from the module's own files.
import { computed, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import { account, addModule, dialog, makesModules, openSettings, publishModule, saveModuleZip, state, type AddModuleRequest, type MenuItem } from "../host";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { NavList, type NavGroup } from "@tavora/official-ui/components/ui/nav-list";
import { Input } from "@tavora/official-ui/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { Activity, Blocks, ChevronDown, CloudDownload, Code, FileArchive, Globe, LayoutGrid, NotebookPen, Search, Settings2, Upload, X } from "@lucide/vue";
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
/** What the library shows: installed modules (all, the ones in this workspace, or the developer's own), updates, or the catalog. */
type View = "all" | "inWorkspace" | "development" | "catalog" | "updates";

const KINDS: Kind[] = ["official", "local", "development"];
const VIEW_ICONS = { all: Blocks, inWorkspace: LayoutGrid, development: Code } as const;

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
/** The search opens focused; it shows its focus ring only once the user uses it. */
const searchUsed = ref(false);
/** How many modules the catalog lists for the search, once it has loaded. */
const catalogCount = ref<number | null>(null);

// Count modules, not panels: a module can have several panels in this workspace.
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
  if (id === "inWorkspace") return openCount(module.id) > 0;
  return kindOf(module) === id;
}

function count(id: View): number {
  return searched.value.filter((module) => inView(module, id)).length;
}


function viewItem(id: "all" | "inWorkspace" | "development") {
  return { id, label: t(`addModule.category.${id}`), icon: VIEW_ICONS[id], badge: count(id), title: t(`addModule.about.${id}`), testid: `module-category-${id}` };
}

/**
 * The menu on the left: one short, plain list of your modules (Updates while there are some; Development only for
 * people who make modules, as Settings' developer pages, since the bundled examples alone don't make a developer).
 * Community modules is a tile of its own below it, the way out to the shop.
 */
const navGroups = computed<NavGroup[]>(() => [
  {
    items: [
      viewItem("all"),
      viewItem("inWorkspace"),
      ...(updateCount.value || view.value === "updates"
        ? [{ id: "updates", label: t("addModule.category.updates"), icon: CloudDownload, badge: updateCount.value, badgeAccent: true, badgeTestid: "module-updates-count", title: t("addModule.about.updates"), testid: "module-category-updates" }]
        : []),
      ...(makesModules.value || view.value === "development" ? [viewItem("development")] : []),
    ],
  },
]);

/** The Community modules entry's three fanned icons: plain line icons, back to front, the last one on top. */
const TILE_ICONS = [Globe, Activity, NotebookPen];

/** The modules shown, by kind; a kind with nothing shown is left out. */
const groups = computed(() => {
  const shown = searched.value.filter((module) => inView(module, view.value));
  return KINDS.map((id) => ({ id, label: t(`addModule.category.${id}`), items: shown.filter((module) => kindOf(module) === id).sort((a, b) => a.name.localeCompare(b.name)) })).filter(
    (group) => group.items.length,
  );
});
const resultCount = computed(() => groups.value.reduce((total, group) => total + group.items.length, 0));
/** Headings only where the list mixes kinds. */
const showHeadings = computed(() => view.value === "all" || view.value === "inWorkspace");

const title = computed(() => (view.value === "catalog" ? t("addModule.tab.browse") : t(`addModule.category.${view.value}`)));
const shownCount = computed(() => (view.value === "catalog" ? catalogCount.value : view.value === "updates" ? updateCount.value : resultCount.value));

/** How many panels of a module (of one of its panel types, if given) are already open in this workspace. */
function openCount(moduleId: string, panelType?: string): number {
  if (panelType === undefined) return panelCounts.value.get(moduleId) ?? 0;
  return state.value!.panels.filter((panel) => panel.moduleId === moduleId && panel.panelType === panelType).length;
}

/**
 * Adds it, or asks for what it needs first (the consent dialog takes this dialog's place). A module
 * with panel types keeps the library open, so the user can add several of its panels in a row.
 */
function add(moduleId: string, panelTypes: string[] = []) {
  addModule(moduleId, (dialog.value as AddModuleRequest).slot ?? null, panelTypes, { stay: panelTypes.length > 0 });
}

/** The module whose page is open. */
const info = ref<ModuleView | null>(null);
const infoError = ref<string | undefined>();

function openInfo(module: ModuleView) {
  infoError.value = undefined;
  info.value = module;
}

/** Add on the page does what the card's Add does, then the page closes. */
function addFromInfo(module: ModuleView) {
  add(module.id, module.panels.map((type) => type.id));
  info.value = null;
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
    { label: t("publish.button"), testid: `menu-publish-${module.id}`, glyph: Upload, run: () => publishModule(module.id) },
    { label: t("publish.saveZip"), testid: `menu-save-zip-${module.id}`, glyph: FileArchive, run: () => saveModuleZip(module.id) },
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
      <aside class="thin-scroll module-menu bg-background flex shrink-0 flex-col gap-3 border-b px-4 pb-4 sm:w-56 sm:overflow-y-auto sm:border-r sm:border-b-0 lg:w-64">
        <form class="relative flex h-16 flex-none items-center" @submit.prevent="submit">
          <Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" :stroke-width="1.5" aria-hidden="true" />
          <label class="sr-only" for="module-search">{{ t("addModule.search") }}</label>
          <!-- Opens focused, so typing searches; the focus ring shows only once the search is used, as in Settings. -->
          <Input
            id="module-search"
            v-model="query"
            :class="cn('h-10 pr-3 pl-9', !searchUsed && 'focus-visible:border-input focus-visible:ring-0')"
            :placeholder="t('addModule.search')"
            autocomplete="off"
            data-testid="module-search"
            autofocus
            @pointerdown="searchUsed = true"
            @input="searchUsed = true"
            @blur="searchUsed = true"
          />
        </form>
        <NavList
          v-model="view"
          class="flex-row overflow-x-auto sm:flex-col sm:overflow-visible"
          icon-class="hidden sm:block"
          :label="t('addModule.categories')"
          :groups="navGroups"
        />
        <!-- Community modules: the way out to the shop, right under your modules and set off by a line. A menu entry
             like the ones above (same hover, lit the same while its page is open), with three module icons fanned out. -->
        <div class="border-t pt-3 sm:mt-1">
          <button
            type="button"
            :class="
              cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2',
                view === 'catalog' && 'bg-primary/10 text-foreground hover:bg-primary/15',
              )
            "
            :aria-current="view === 'catalog' ? 'page' : undefined"
            :title="t('addModule.about.catalog')"
            data-testid="module-tab-browse"
            @click="view = 'catalog'"
          >
            <span class="relative hidden h-8 w-12 flex-none sm:block" aria-hidden="true" data-testid="community-tile-icons">
              <span
                v-for="(icon, index) in TILE_ICONS"
                :key="index"
                :class="
                  cn(
                    'bg-background absolute top-2 grid size-6 place-items-center rounded-md border shadow-sm',
                    index === 0 && 'left-0 -rotate-12',
                    index === 1 && 'left-6 rotate-12',
                    index === 2 && 'top-0.5 left-3 z-10 transition-colors',
                    index === 2 && (view === 'catalog' ? 'border-primary/60 text-primary' : 'group-hover:border-primary/40 group-hover:text-primary/80'),
                  )
                "
              >
                <component :is="icon" class="size-3.5" :stroke-width="1.75" />
              </span>
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium">{{ t("addModule.tab.browse") }}</span>
              <span class="text-muted-foreground hidden truncate text-xs sm:block">{{ t("addModule.catalogTile") }}</span>
            </span>
          </button>
        </div>
        <!-- Module settings, as Settings' About & updates: rarely needed, so it sits at the foot. -->
        <button
          type="button"
          class="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring flex h-9 flex-none items-center gap-3 rounded-lg px-3 text-left text-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 sm:mt-auto"
          data-testid="manage-modules"
          @click="manage"
        >
          <Settings2 class="size-4 flex-none" :stroke-width="1.75" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ t("addModule.manage") }}</span>
        </button>
      </aside>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <!-- Where you are, as in Settings: Modules / the view, with how many it shows. -->
        <header class="flex h-16 shrink-0 items-center gap-4 border-b px-6 lg:px-10">
          <div class="flex min-w-0 flex-1 items-center gap-2.5 text-base">
            <DialogTitle class="text-muted-foreground flex-none text-base font-medium">{{ t("addModule.title") }}</DialogTitle>
            <span class="text-muted-foreground/60 flex-none" aria-hidden="true">/</span>
            <h2 class="truncate font-semibold" :title="t(`addModule.about.${view}`)" data-testid="module-view-title">{{ title }}</h2>
            <span v-if="shownCount !== null" class="text-muted-foreground flex-none pl-1 text-sm tabular-nums" role="status" data-testid="module-result-count">{{
              t("addModule.results", { count: shownCount })
            }}</span>
          </div>
          <DialogClose as-child>
            <Button variant="ghost" size="icon" class="flex-none" :aria-label="t('common.close')" :title="t('common.close')"><X :stroke-width="1.5" /></Button>
          </DialogClose>
        </header>

        <CatalogBrowse v-if="view === 'catalog'" :query="query" :open="browse" @count="catalogCount = $event" />
        <ModuleUpdates v-else-if="view === 'updates'" :query="query" />
        <div v-else class="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-8 [scrollbar-gutter:stable] lg:px-10" data-testid="module-results">
          <section v-for="group in groups" :key="group.id" :aria-label="group.label" class="pt-6">
            <h3 v-if="showHeadings" class="text-muted-foreground flex items-center gap-2 pb-3 text-xs font-semibold tracking-wider uppercase">
              {{ group.label }} <span class="text-muted-foreground/70 font-normal tabular-nums">{{ group.items.length }}</span>
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
                  <button type="button" class="module-tile focus-visible:ring-ring size-10 outline-none focus-visible:ring-2" tabindex="-1" aria-hidden="true" @click="openInfo(module)">
                    <ModuleIcon :module-id="module.id" size="size-[34px]" />
                  </button>
                  <div class="min-w-0 flex-1">
                    <div class="flex min-w-0 items-center gap-2">
                      <button type="button" class="hover:text-primary focus-visible:ring-ring truncate rounded-sm text-left font-medium outline-none focus-visible:ring-2" :title="module.name"
                        :aria-label="t('catalog.infoLabel', { name: module.name })" :data-testid="`module-name-${module.id}`" @click="openInfo(module)"
                      >{{ module.name }}</button>
                      <!-- Where a copy came from, for your own modules (Catalog, From file, Local…). Official ones always sit in their own Official group, so the tag would only repeat it. -->
                      <Badge
                        v-if="group.id !== 'official'"
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
                        · <span class="text-primary" :data-testid="`in-workspace-${module.id}`">{{ t("addModule.inWorkspace", { count: openCount(module.id) }) }}</span>
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
                    <span v-if="openCount(module.id)" class="text-primary text-xs" :data-testid="`in-workspace-${module.id}`">{{ t("addModule.inWorkspace", { count: openCount(module.id) }) }}</span>
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
      <CatalogModuleDialog v-if="info" :module="pageModule(info)" :local="info" installed :installing="false" :error="infoError"
        @close="info = null" @add="addFromInfo(info)"
      />
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* The menu fits a normal window; there it scrolls by wheel or keys without a bar beside it. */
@media (min-height: 640px) {
  .module-menu::-webkit-scrollbar {
    width: 0;
  }
}
</style>
