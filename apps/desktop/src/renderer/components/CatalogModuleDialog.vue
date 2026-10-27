<script setup lang="ts">
// A catalog module's page, opened from its card in the Catalog view, laid out like a store page: icon,
// name and Install, screenshots, the readme, what's new, details and what it can reach. Every text is
// plain text (C10): the main process asks for the listing again, turns the readme into plain text
// blocks, fetches each screenshot by its hash and checks it is a PNG or WebP before it gets here, and
// opens the homepage like a module link. Ratings and reviews have their own section (CatalogReviews.vue).
// The library also opens it for an installed module (`local`): a catalog one shows its catalog page; any other,
// and a catalog one the catalog can't give right now, shows the same page built from the module's own files
// (module-page.ts): readme, screenshots and what it can reach, without reviews, ratings, installs or Report.
import { computed, nextTick, onMounted, ref } from "vue";
import type { CatalogModuleView, CatalogPageResult } from "../../shared/host-api";
import type { InstalledModule } from "../module-page";
import { formatSize } from "../catalog-size";
import { act, api, dialog, state } from "../host";
import { compareModuleVersions } from "../../shared/module-version";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { formatDate, t } from "../i18n";
import { ExternalLink, X } from "@lucide/vue";
import CatalogIcon from "./CatalogIcon.vue";
import CatalogReviews from "./CatalogReviews.vue";
import ModuleIcon from "./ModuleIcon.vue";
import ModuleDescription from "./ModuleDescription.vue";
import ModuleVersions from "./ModuleVersions.vue";

const props = defineProps<{ module: CatalogModuleView; installed: boolean; installing: boolean; size?: string; error?: string; reporting: boolean; reported: boolean; atReviews?: boolean; local?: InstalledModule }>();
const emit = defineEmits<{ close: []; install: []; add: []; report: [] }>();
/** Report asks once more before anything is sent. */
const reportAsk = ref(false);

const page = ref<CatalogPageResult | null>(null);
const shown = ref(0);
const opening = ref(false);
const homepageError = ref<string | null>(null);

const reviews = ref<HTMLElement | null>(null);
/** The page is built from the module's own files, so what only the catalog knows is left out. */
const fromFiles = ref(false);
/** Whether to show what only the catalog has (reviews, Report): not for a module that isn't from it. */
const catalogParts = computed(() => !fromFiles.value && !(props.local && !props.local.fromCatalog));

/** The page from the module's own folder: its readme and pictures, offline. */
async function showFiles() {
  const own = await api.modulePage(props.module.id);
  const screenshots = own.status === "ok" ? own.screenshots : [];
  fromFiles.value = true;
  page.value = { status: "ok", module: { ...props.module, support: props.local ? props.local.support : props.module.support, screenshots: screenshots.length }, screenshots, readme: own.status === "ok" ? own.readme : [], versions: [] };
}

onMounted(async () => {
  // Opened from the card's rating: start at the reviews.
  if (props.atReviews) void nextTick(() => reviews.value?.scrollIntoView({ block: "start" }));
  if (props.local && !props.local.fromCatalog) return showFiles();
  page.value = await api.catalogPage(props.module.id);
  if (props.local && page.value.status !== "ok") await showFiles();
});

/** The listing as the main process read it for this page, or the card's until then. */
const module = computed(() => (page.value?.status === "ok" ? page.value.module : props.module));
/** The version installed here: the listing may already have a newer one, which waits for the update check. */
const installedVersion = computed(() => (props.installed ? (state.value?.modules.find((item) => item.id === props.module.id)?.version ?? null) : null));
/** The listing's version, when it is newer than the installed one. */
const newest = computed(() => (installedVersion.value && compareModuleVersions(module.value.version, installedVersion.value) > 0 ? module.value.version : null));
const sizeText = computed(() => props.size ?? formatSize(module.value.size));
const loaded = computed(() => (page.value?.status === "ok" ? page.value : null));
const latest = computed(() => loaded.value?.versions.find((version) => version.version === module.value.version) ?? null);
const updated = computed(() => {
  const at = latest.value?.publishedAt || module.value.publishedAt;
  return at && !Number.isNaN(Date.parse(at)) ? formatDate(at) : null;
});
const homepageText = computed(() => module.value.homepage?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null);
const access = computed(() => [
  ...module.value.permissions.network.map((host) => t("catalog.accessHost", { host })),
  ...module.value.permissions.connectors.map((id) => t(`catalog.accessConnector.${id}`)),
]);
/** Why Install and Add are greyed out: the module is for another game, or not for personal workspaces. */
const notHere = computed(() => {
  if (module.value.fits) return null;
  return module.value.forGames.length ? t("catalog.onlyFor", { games: module.value.forGames.join(", ") }) : t("catalog.notInPersonal");
});

/** Opens the support link after a click: the main process reads it again from the module's manifest or the listing. */
async function openSupport() {
  opening.value = true;
  homepageError.value = null;
  const library = dialog.value;
  const outcome = await act({ type: "open-module-support", moduleId: module.value.id, source: fromFiles.value ? "installed" : "catalog" }, { quiet: true });
  opening.value = false;
  if (!outcome.ok) homepageError.value = outcome.error;
  // A web address opens in a Browser panel, so close the library; an email address opens the mail app and the page stays.
  else if (module.value.support?.startsWith("https://") && dialog.value === library) dialog.value = null;
}

async function openHomepage() {
  opening.value = true;
  homepageError.value = null;
  const library = dialog.value;
  const outcome = await act({ type: "open-catalog-homepage", moduleId: module.value.id }, { quiet: true });
  opening.value = false;
  if (!outcome.ok) homepageError.value = outcome.error;
  // Opened in a Browser panel: close the library so the user sees it. Asking where to open replaces it already.
  else if (dialog.value === library) dialog.value = null;
}
</script>

<template>
  <Dialog :open="true" @update:open="(open: boolean) => !open && emit('close')">
    <DialogContent
      class="bg-card flex h-[min(640px,calc(100vh-96px))] w-[min(960px,calc(100vw-48px))] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      :data-testid="`catalog-info-${module.id}`"
      :show-close-button="false"
    >
      <header class="flex items-start gap-4 border-b p-6">
        <span v-if="local" class="bg-muted/60 grid size-16 flex-none place-items-center overflow-hidden rounded-xl" aria-hidden="true"><ModuleIcon :module-id="module.id" size="size-10" /></span>
        <CatalogIcon v-else :module-id="module.id" :has="module.icon" size="size-16" />
        <div class="min-w-0 flex-1">
          <DialogTitle class="truncate text-xl font-semibold">{{ module.name }}</DialogTitle>
          <p v-if="module.publisher || module.owner" class="text-muted-foreground truncate text-sm" :title="module.owner">{{ module.publisher ? t("catalog.by", { name: module.publisher }) : t("catalog.byKey", { key: module.owner.slice(0, 8) }) }}</p>
          <DialogDescription v-if="module.description" class="text-muted-foreground mt-1 line-clamp-2 text-sm">{{ module.description }}</DialogDescription>
        </div>
        <div class="flex flex-none items-center gap-2">
          <!-- A disabled button gets no hover, so the reason sits on a wrapper. -->
          <span :title="notHere ?? undefined">
            <Button v-if="installed" variant="outline" class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary" :disabled="!!notHere" data-testid="catalog-info-add" @click="emit('add')">{{ t("common.add") }}</Button>
            <Button v-else :disabled="installing || !!notHere" data-testid="catalog-info-install" @click="emit('install')">{{ installing ? t("catalog.installing") : t("catalog.install") }}</Button>
          </span>
          <Button variant="ghost" size="icon" :aria-label="t('common.close')" @click="emit('close')"><X class="size-4" /></Button>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        <p v-if="error || homepageError" class="text-destructive mb-4 text-sm" role="alert">{{ error || homepageError }}</p>

        <section v-if="module.screenshots > 0" class="mb-6" :aria-label="t('catalog.screenshots', { name: module.name })" data-testid="catalog-info-screenshots">
          <p v-if="!page" class="text-muted-foreground bg-muted/40 grid aspect-video max-w-[560px] place-items-center rounded-lg text-sm" role="status">{{ t("catalog.screenshotsLoading") }}</p>
          <p v-else-if="!loaded?.screenshots.length" class="text-muted-foreground bg-muted/40 grid aspect-video max-w-[560px] place-items-center rounded-lg text-sm" role="status" data-testid="catalog-info-screenshots-missing">
            {{ t("catalog.screenshotsMissing") }}
          </p>
          <div v-else class="flex items-start gap-3">
            <img :src="loaded.screenshots[shown]" :alt="t('catalog.screenshot', { number: shown + 1, count: loaded.screenshots.length })"
              class="bg-muted/40 aspect-video min-w-0 max-w-[560px] flex-1 rounded-lg border object-contain" draggable="false" data-testid="catalog-info-screenshot"
            />
            <div v-if="loaded.screenshots.length > 1" class="flex flex-none flex-col gap-2">
              <button v-for="(shot, index) in loaded.screenshots" :key="index" type="button"
                class="focus-visible:ring-ring h-14 w-24 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2"
                :class="index === shown ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100'"
                :aria-label="t('catalog.screenshot', { number: index + 1, count: loaded.screenshots.length })" :aria-pressed="index === shown"
                @click="shown = index"
              ><img :src="shot" alt="" class="size-full object-cover" draggable="false" /></button>
            </div>
          </div>
        </section>

        <div class="grid gap-8 md:grid-cols-[minmax(0,1fr)_240px]">
          <div class="min-w-0 space-y-6">
            <ModuleDescription :blocks="loaded?.readme ?? []" :fallback="module.description" :module-id="catalogParts ? module.id : undefined">
              <p v-if="page && page.status !== 'ok'" class="text-muted-foreground mt-2 text-sm" role="status" data-testid="catalog-info-missing">
                {{ page.status === "gone" ? t("catalog.pageGone") : t("catalog.pageMissing") }}
              </p>
            </ModuleDescription>

            <ModuleVersions :module-id="module.id" :versions="loaded?.versions ?? []" :version="module.version" />

            <div v-if="catalogParts" ref="reviews" class="scroll-mt-6">
              <CatalogReviews :module-id="module.id" :module-name="module.name" :publisher="module.publisher" />
            </div>
          </div>

          <aside class="space-y-6 text-sm">
            <section>
              <h3 class="mb-2 font-medium">{{ t("catalog.details") }}</h3>
              <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5" data-testid="catalog-info-details">
                <dt class="text-muted-foreground">{{ t("catalog.version") }}</dt>
                <dd class="tabular-nums" data-testid="catalog-info-version">{{ installedVersion ?? module.version }}</dd>
                <template v-if="newest">
                  <dt class="text-muted-foreground">{{ t("catalog.newest") }}</dt>
                  <dd class="tabular-nums" data-testid="catalog-info-newest">{{ newest }}</dd>
                </template>
                <template v-if="updated">
                  <dt class="text-muted-foreground">{{ t("catalog.updated") }}</dt>
                  <dd data-testid="catalog-info-updated">{{ updated }}</dd>
                </template>
                <template v-if="module.size > 0">
                  <dt class="text-muted-foreground">{{ t("catalog.size") }}</dt>
                  <dd>{{ sizeText }}</dd>
                </template>
                <template v-if="module.publisher">
                  <dt class="text-muted-foreground">{{ t("catalog.developer") }}</dt>
                  <dd class="truncate" :title="module.owner">{{ module.publisher }}</dd>
                </template>
              </dl>
              <Button v-if="module.homepage" variant="link" class="mt-2 h-auto max-w-full justify-start gap-1.5 p-0" :disabled="opening" :title="module.homepage"
                :aria-label="t('catalog.homepageLabel', { name: module.name })" data-testid="catalog-info-homepage" @click="openHomepage"
              ><ExternalLink class="size-4 flex-none" :stroke-width="1.5" /><span class="truncate">{{ homepageText }}</span></Button>
            </section>

            <section data-testid="catalog-info-access">
              <h3 class="mb-2 font-medium">{{ t("catalog.access") }}</h3>
              <ul v-if="access.length" class="space-y-1">
                <li v-for="(line, index) in access" :key="index" class="break-words">{{ line }}</li>
              </ul>
              <p v-else>{{ t("catalog.accessNone") }}</p>
            </section>

            <section v-if="module.support" data-testid="catalog-info-support">
              <Button size="sm" variant="outline" :disabled="opening" :aria-label="t('catalog.supportLabel', { name: module.name })" data-testid="catalog-info-support-button" @click="openSupport">{{ t("catalog.support") }}</Button>
              <p class="text-muted-foreground mt-1.5">{{ t("catalog.supportHint") }}</p>
            </section>

            <section v-if="catalogParts" data-testid="catalog-info-report">
              <p v-if="reported" class="text-muted-foreground" role="status" :data-testid="`catalog-reported-${module.id}`">{{ t("catalog.reported") }}</p>
              <div v-else-if="reportAsk" class="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md p-3" :data-testid="`catalog-report-ask-${module.id}`">
                <p class="w-full">{{ t("catalog.reportAsk", { name: module.name }) }}</p>
                <Button size="sm" variant="secondary" :disabled="reporting" :data-testid="`catalog-report-send-${module.id}`" @click="emit('report')">
                  {{ reporting ? t("catalog.reporting") : t("catalog.reportSend") }}
                </Button>
                <Button size="sm" variant="ghost" :disabled="reporting" @click="reportAsk = false">{{ t("common.cancel") }}</Button>
              </div>
              <Button v-else size="sm" variant="ghost" class="text-muted-foreground -ml-2" :data-testid="`catalog-report-${module.id}`"
                :aria-label="t('catalog.reportLabel', { name: module.name })" @click="reportAsk = true"
              >{{ t("catalog.report") }}</Button>
              <p v-if="!reported && !reportAsk" class="text-muted-foreground mt-0.5">{{ t("catalog.reportHint") }}</p>
            </section>
          </aside>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
