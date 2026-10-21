<script setup lang="ts">
// The Catalog view of the module library: every module in Tavora's catalog, those for this game or personal
// workspace first, the rest with the game they are for and Install greyed out. Cards like the installed
// ones; the main process fetches and checks the list and does the install (catalog-client.ts);
// every text here is shown as plain text, and "by <name>" is only the developer name the service gave.
// Report is on the module's page: it asks once more, then sends only the module id, its key and its zip's hash (C12).
// A card's icon or name opens the module's page with its readme, screenshots, homepage and reviews (CatalogModuleDialog.vue).
// Each card shows its rating (CatalogRating.vue); the list sorts by name, rating or newest.
import { computed, onMounted, ref, watch } from "vue";
import type { CatalogListResult, CatalogModuleView } from "../../shared/host-api";
import { act, addModule, api, dialog, openSettings, state, type AddModuleRequest } from "../host";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { t } from "../i18n";
import { cn } from "@/lib/utils";
import { CircleCheck, Gamepad2, ShieldCheck } from "@lucide/vue";
import CatalogIcon from "./CatalogIcon.vue";
import CatalogModuleDialog from "./CatalogModuleDialog.vue";
import CatalogRating from "./CatalogRating.vue";
import { MIN_RATINGS_SHOWN } from "../../shared/host-api";

const props = defineProps<{ query: string }>();
/** How many modules are listed for the search, or null while there is no list. */
const emit = defineEmits<{ count: [number | null] }>();

const result = ref<CatalogListResult | null>(null);
const installing = ref<string | null>(null);
const errors = ref<Record<string, string>>({});
/** The module whose report is being sent from its page, and those sent. */
const reporting = ref<string | null>(null);
const reported = ref<Set<string>>(new Set());
/** The module whose info is open, and whether it opened at its reviews. */
const info = ref<CatalogModuleView | null>(null);
const infoAtReviews = ref(false);
type Sort = "name" | "rating" | "newest";
const sort = ref<Sort>("name");

function open(module: CatalogModuleView, atReviews = false) {
  infoAtReviews.value = atReviews;
  info.value = module;
}

/** A shown rating's average, or -1 for New, so New modules come after the rated ones. */
const ratingOf = (module: CatalogModuleView) => (module.rating && module.rating.count >= MIN_RATINGS_SHOWN ? module.rating.average : -1);
const sorters: Record<Sort, (a: CatalogModuleView, b: CatalogModuleView) => number> = {
  name: () => 0,
  rating: (a, b) => ratingOf(b) - ratingOf(a) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0),
  newest: (a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0),
};

async function load() {
  result.value = null;
  result.value = await api.browseCatalog();
}
onMounted(load);

const installed = computed(() => new Set(state.value!.modules.map((module) => module.id)));
const shown = computed(() => {
  if (result.value?.status !== "ok") return [];
  const text = props.query.trim().toLocaleLowerCase();
  // The list comes sorted by name, which a stable sort keeps among equals.
  return result.value.modules
    .filter((module) => !text || [module.name, module.description ?? "", module.id, module.publisher ?? ""].some((value) => value.toLocaleLowerCase().includes(text)))
    .sort(sorters[sort.value]);
});

watch(
  () => (result.value?.status === "ok" ? shown.value.length : null),
  (count) => emit("count", count),
  { immediate: true },
);

/** Why a module that doesn't fit here can't be installed or added, or null when it fits. */
function whereFits(module: CatalogModuleView): string | null {
  if (module.fits) return null;
  return module.forGames.length ? t("catalog.onlyFor", { games: module.forGames.join(", ") }) : t("catalog.notInWorkspaces");
}

function fitLabel(module: CatalogModuleView): string {
  if (module.fits) return t("catalog.fits");
  return module.forGames.length ? t("catalog.forGames", { games: module.forGames.join(", ") }) : t("catalog.notForWorkspaces");
}

function installs(count: number): string {
  return count ? t("catalog.installs", { count }) : t("catalog.noInstalls");
}

function size(bytes: number): string {
  return bytes < 1024 * 1024 ? t("catalog.sizeKb", { size: Math.max(1, Math.round(bytes / 1024)) }) : t("catalog.sizeMb", { size: (bytes / 1024 / 1024).toFixed(1) });
}

async function install(module: CatalogModuleView) {
  installing.value = module.id;
  const { [module.id]: _, ...rest } = errors.value;
  errors.value = rest;
  const outcome = await act({ type: "install-catalog-module", moduleId: module.id }, { quiet: true });
  installing.value = null;
  if (!outcome.ok) errors.value = { ...errors.value, [module.id]: outcome.error };
}

async function report(module: CatalogModuleView) {
  reporting.value = module.id;
  const outcome = await act({ type: "report-catalog-module", moduleId: module.id }, { quiet: true });
  reporting.value = null;
  if (outcome.ok) reported.value = new Set([...reported.value, module.id]);
  else errors.value = { ...errors.value, [module.id]: outcome.error };
}

function add(moduleId: string) {
  addModule(moduleId, (dialog.value as AddModuleRequest).slot ?? null);
}

function settings() {
  dialog.value = null;
  openSettings({ section: "online", setting: "online-search" });
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-8" data-testid="catalog-results">
    <p v-if="!result" class="text-muted-foreground py-16 text-center" role="status" data-testid="catalog-loading">{{ t("catalog.loading") }}</p>
    <div v-else-if="result.status !== 'ok'" class="text-muted-foreground py-16 text-center" role="status" :data-testid="`catalog-${result.status}`">
      <p>{{ t(`catalog.status.${result.status}`) }}</p>
      <Button v-if="result.status === 'off'" variant="secondary" class="mt-4" data-testid="catalog-settings" @click="settings">{{ t("catalog.openSettings") }}</Button>
      <Button v-else variant="ghost" class="mt-3" data-testid="catalog-retry" @click="load">{{ t("catalog.retry") }}</Button>
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-3 pt-6 pb-3">
        <p class="text-muted-foreground flex min-w-0 flex-1 items-center gap-2 text-sm"><ShieldCheck class="size-4 flex-none" :stroke-width="1.5" /> {{ t("catalog.hint") }}</p>
        <Select v-model="sort">
          <SelectTrigger size="sm" class="w-40" :aria-label="t('catalog.sort.label')" data-testid="catalog-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">{{ t("catalog.sort.name") }}</SelectItem>
            <SelectItem value="rating">{{ t("catalog.sort.rating") }}</SelectItem>
            <SelectItem value="newest">{{ t("catalog.sort.newest") }}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ul class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        <li v-for="module in shown" :key="module.id" class="bg-background/40 hover:border-primary/40 flex flex-col gap-3 rounded-xl border p-4 transition-colors" :data-testid="`catalog-${module.id}`">
          <div class="flex min-w-0 gap-3">
            <button type="button" class="focus-visible:ring-ring flex-none rounded-xl outline-none focus-visible:ring-2" tabindex="-1" aria-hidden="true" @click="open(module)">
              <CatalogIcon :module-id="module.id" :has="module.icon" />
            </button>
            <div class="min-w-0">
              <div class="flex min-w-0 items-baseline gap-2">
                <button type="button" class="hover:text-primary focus-visible:ring-ring truncate rounded-sm text-left font-medium outline-none focus-visible:ring-2" :title="module.name"
                  :aria-label="t('catalog.infoLabel', { name: module.name })" data-testid="catalog-name" :data-module="module.id" @click="open(module)"
                >{{ module.name }}</button>
                <span class="text-muted-foreground shrink-0 text-xs tabular-nums">{{ module.version }}</span>
              </div>
              <p class="text-muted-foreground truncate text-xs" :title="module.owner" data-testid="catalog-publisher">{{ module.publisher ? t("catalog.by", { name: module.publisher }) : t("catalog.byKey", { key: module.owner.slice(0, 8) }) }}</p>
              <p v-if="module.description" class="text-muted-foreground mt-1.5 line-clamp-2 text-sm" :title="module.description" data-testid="catalog-description">{{ module.description }}</p>
            </div>
          </div>
          <p v-if="errors[module.id]" class="text-destructive text-sm" role="alert" :data-testid="`catalog-error-${module.id}`">{{ errors[module.id] }}</p>
          <div class="mt-auto flex flex-col gap-2">
            <CatalogRating :rating="module.rating" :name="module.name" @reviews="open(module, true)" />
            <div class="flex items-center gap-2">
              <span class="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                <span :class="cn('flex min-w-0 items-center gap-1', module.fits && 'text-primary')" :title="whereFits(module) ?? undefined" :data-testid="`catalog-fits-${module.id}`">
                  <component :is="module.fits ? CircleCheck : Gamepad2" class="size-3.5 flex-none" :stroke-width="1.75" />
                  <span class="truncate">{{ fitLabel(module) }}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span class="shrink-0 tabular-nums" :data-testid="`catalog-installs-${module.id}`">{{ installs(module.installs) }}</span>
              </span>
              <!-- A disabled button gets no hover, so the reason sits on a wrapper. -->
              <span class="shrink-0" :title="whereFits(module) ?? undefined">
                <Button v-if="installed.has(module.id)" size="sm" variant="outline" class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary" :disabled="!module.fits"
                  :data-testid="`catalog-add-${module.id}`" :aria-label="t('addModule.addLabel', { name: module.name })" @click="add(module.id)"
                >{{ t("common.add") }}</Button>
                <Button v-else size="sm" :disabled="installing !== null || !module.fits"
                  :data-testid="`catalog-install-${module.id}`" :aria-label="t('catalog.installLabel', { name: module.name })" @click="install(module)"
                >{{ installing === module.id ? t("catalog.installing") : t("catalog.install") }}</Button>
              </span>
          </div>
          </div>
        </li>
      </ul>
      <p v-if="!shown.length" class="text-muted-foreground py-16 text-center" data-testid="catalog-empty">
        {{ query.trim() ? t("addModule.none", { query: query.trim() }) : t("catalog.empty") }}
      </p>
    </template>
    <CatalogModuleDialog v-if="info" :module="info" :at-reviews="infoAtReviews" :installed="installed.has(info.id)" :installing="installing === info.id" :size="size(info.size)"
      :error="errors[info.id]" :reporting="reporting === info.id" :reported="reported.has(info.id)"
      @close="info = null" @install="install(info)" @add="add(info.id)" @report="report(info)"
    />
  </div>
</template>
