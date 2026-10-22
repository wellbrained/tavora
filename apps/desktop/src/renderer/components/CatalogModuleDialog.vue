<script setup lang="ts">
// A catalog module's page, opened from its card in the Catalog view, laid out like a store page: icon,
// name and Install, screenshots, the readme, what's new, details and what it can reach. Every text is
// plain text (C10): the main process asks for the listing again, turns the readme into plain text
// blocks, fetches each screenshot by its hash and checks it is a PNG or WebP before it gets here, and
// opens the homepage like a module link. Ratings and reviews have their own section (CatalogReviews.vue).
import { computed, nextTick, onMounted, ref } from "vue";
import type { CatalogModuleView, CatalogPageResult } from "../../shared/host-api";
import { act, api, dialog } from "../host";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { Expandable } from "@tavora/official-ui/components/ui/expandable";
import { formatDate, t } from "../i18n";
import { ExternalLink, X } from "@lucide/vue";
import CatalogIcon from "./CatalogIcon.vue";
import CatalogReviews from "./CatalogReviews.vue";

const props = defineProps<{ module: CatalogModuleView; installed: boolean; installing: boolean; size: string; error?: string; reporting: boolean; reported: boolean; atReviews?: boolean }>();
const emit = defineEmits<{ close: []; install: []; add: []; report: [] }>();
/** Report asks once more before anything is sent. */
const reportAsk = ref(false);

const page = ref<CatalogPageResult | null>(null);
const shown = ref(0);
const opening = ref(false);
const homepageError = ref<string | null>(null);

const reviews = ref<HTMLElement | null>(null);

onMounted(async () => {
  // Opened from the card's rating: start at the reviews.
  if (props.atReviews) void nextTick(() => reviews.value?.scrollIntoView({ block: "start" }));
  page.value = await api.catalogPage(props.module.id);
});

/** The listing as the main process read it for this page, or the card's until then. */
const module = computed(() => (page.value?.status === "ok" ? page.value.module : props.module));
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
/** Why Install and Add are greyed out: the module is for another game, or not for workspaces. */
const notHere = computed(() => {
  if (module.value.fits) return null;
  return module.value.forGames.length ? t("catalog.onlyFor", { games: module.value.forGames.join(", ") }) : t("catalog.notInWorkspaces");
});

async function openHomepage() {
  opening.value = true;
  homepageError.value = null;
  const library = dialog.value;
  const outcome = await act({ type: "open-catalog-homepage", moduleId: module.value.id }, { quiet: true });
  opening.value = false;
  if (!outcome.ok) homepageError.value = outcome.error;
  // Opened in a Browser panel: close the library so the player sees it. Asking where to open replaces it already.
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
        <CatalogIcon :module-id="module.id" :has="module.icon" size="size-16" />
        <div class="min-w-0 flex-1">
          <DialogTitle class="truncate text-xl font-semibold">{{ module.name }}</DialogTitle>
          <p class="text-muted-foreground truncate text-sm" :title="module.owner">{{ module.publisher ? t("catalog.by", { name: module.publisher }) : t("catalog.byKey", { key: module.owner.slice(0, 8) }) }}</p>
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
            <section data-testid="catalog-info-about">
              <h3 class="mb-2 font-medium">{{ t("catalog.about") }}</h3>
              <Expandable v-if="loaded?.readme.length" :max-height="240">
                <div class="space-y-3 text-sm leading-relaxed" data-testid="catalog-info-readme">
                  <template v-for="(block, index) in loaded.readme" :key="index">
                    <h4 v-if="block.kind === 'heading'" :class="block.level === 2 ? 'pt-2 text-base font-semibold' : 'pt-1 font-medium'">{{ block.text }}</h4>
                    <p v-else-if="block.kind === 'paragraph'">{{ block.text }}</p>
                    <component :is="block.ordered ? 'ol' : 'ul'" v-else-if="block.kind === 'list'" :class="block.ordered ? 'list-decimal' : 'list-disc'" class="space-y-1 pl-5">
                      <li v-for="(item, at) in block.items" :key="at">{{ item }}</li>
                    </component>
                    <pre v-else class="bg-muted/50 overflow-x-auto rounded-md p-3 text-xs">{{ block.text }}</pre>
                  </template>
                </div>
              </Expandable>
              <p v-else-if="module.description" class="text-sm">{{ module.description }}</p>
              <p v-if="page && page.status !== 'ok'" class="text-muted-foreground mt-2 text-sm" role="status" data-testid="catalog-info-missing">
                {{ page.status === "gone" ? t("catalog.pageGone") : t("catalog.pageMissing") }}
              </p>
            </section>

            <section v-if="latest?.notes.length" data-testid="catalog-info-notes">
              <h3 class="mb-2 font-medium">{{ t("catalog.whatsNew") }}</h3>
              <Expandable :max-height="96">
                <ul class="list-disc space-y-1 pl-5 text-sm">
                  <li v-for="(note, index) in latest.notes" :key="index">{{ note }}</li>
                </ul>
              </Expandable>
            </section>

            <div ref="reviews" class="scroll-mt-6">
              <CatalogReviews :module-id="module.id" :module-name="module.name" :publisher="module.publisher" />
            </div>
          </div>

          <aside class="space-y-6 text-sm">
            <section>
              <h3 class="mb-2 font-medium">{{ t("catalog.details") }}</h3>
              <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5" data-testid="catalog-info-details">
                <dt class="text-muted-foreground">{{ t("catalog.version") }}</dt>
                <dd class="tabular-nums">{{ module.version }}</dd>
                <template v-if="updated">
                  <dt class="text-muted-foreground">{{ t("catalog.updated") }}</dt>
                  <dd data-testid="catalog-info-updated">{{ updated }}</dd>
                </template>
                <dt class="text-muted-foreground">{{ t("catalog.size") }}</dt>
                <dd>{{ size }}</dd>
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

            <section data-testid="catalog-info-report">
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
            </section>
          </aside>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
