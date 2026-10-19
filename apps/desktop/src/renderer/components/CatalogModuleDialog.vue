<script setup lang="ts">
// A catalog module's info, opened from its card in the Catalog view: the listing's text, its screenshots
// and its homepage, before installing. Every text is plain text (C10). The main process fetches each
// screenshot by its listed hash and checks it is a PNG or WebP before it gets here as a data address,
// and it opens the homepage like a module link, from the listing it asks for again.
import { computed, onMounted, ref } from "vue";
import type { CatalogModuleView } from "../../shared/host-api";
import { act, api, dialog } from "../host";
import { Button } from "@/components/ui/button";
import { t } from "../i18n";
import { ExternalLink } from "@lucide/vue";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ module: CatalogModuleView; installed: boolean; installing: boolean; asks: string | null; size: string; error?: string }>();
const emit = defineEmits<{ close: []; install: []; add: [] }>();

const shots = ref<string[] | null>(null);
const shown = ref(0);
const opening = ref(false);
const homepageError = ref<string | null>(null);

onMounted(async () => {
  if (props.module.screenshots > 0) shots.value = await api.catalogScreenshots(props.module.id);
});

/** The homepage as the player reads it: the host and path, without the scheme. */
const homepageText = computed(() => props.module.homepage?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null);

async function openHomepage() {
  opening.value = true;
  homepageError.value = null;
  const library = dialog.value;
  const outcome = await act({ type: "open-catalog-homepage", moduleId: props.module.id }, { quiet: true });
  opening.value = false;
  if (!outcome.ok) homepageError.value = outcome.error;
  // Opened in a Browser panel: close the library so the player sees it. Asking where to open replaces it already.
  else if (dialog.value === library) dialog.value = null;
}
</script>

<template>
  <ModalDialog :title="module.name" class="sm:max-w-[720px]" :testid="`catalog-info-${module.id}`" @close="emit('close')">
    <div class="-mt-2 flex min-w-0 items-baseline gap-2 text-xs">
      <span class="text-muted-foreground truncate" :title="module.owner">{{ module.publisher ? t("catalog.by", { name: module.publisher }) : t("catalog.byKey", { key: module.owner.slice(0, 8) }) }}</span>
      <span class="text-muted-foreground shrink-0 tabular-nums">{{ module.version }}</span>
    </div>
    <p v-if="module.description" class="text-sm whitespace-pre-line" data-testid="catalog-info-description">{{ module.description }}</p>

    <section v-if="module.screenshots > 0" :aria-label="t('catalog.screenshots', { name: module.name })" data-testid="catalog-info-screenshots">
      <p v-if="shots === null" class="text-muted-foreground bg-muted/40 grid aspect-video place-items-center rounded-lg text-sm" role="status">{{ t("catalog.screenshotsLoading") }}</p>
      <p v-else-if="!shots.length" class="text-muted-foreground bg-muted/40 grid aspect-video place-items-center rounded-lg text-sm" role="status" data-testid="catalog-info-screenshots-missing">
        {{ t("catalog.screenshotsMissing") }}
      </p>
      <template v-else>
        <img :src="shots[shown]" :alt="t('catalog.screenshot', { number: shown + 1, count: shots.length })" class="bg-muted/40 aspect-video w-full rounded-lg border object-contain" draggable="false" data-testid="catalog-info-screenshot" />
        <div v-if="shots.length > 1" class="mt-2 flex gap-2">
          <button v-for="(shot, index) in shots" :key="index" type="button"
            class="focus-visible:ring-ring h-12 w-20 overflow-hidden rounded-md border-2 outline-none focus-visible:ring-2"
            :class="index === shown ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100'"
            :aria-label="t('catalog.screenshot', { number: index + 1, count: shots.length })" :aria-pressed="index === shown"
            @click="shown = index"
          ><img :src="shot" alt="" class="size-full object-cover" draggable="false" /></button>
        </div>
      </template>
    </section>

    <p v-if="error || homepageError" class="text-destructive text-sm" role="alert">{{ error || homepageError }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-muted-foreground min-w-0 flex-1 truncate text-xs" :title="asks ?? undefined">{{ size }}<template v-if="asks"> · {{ asks }}</template></span>
      <Button v-if="module.homepage" variant="ghost" size="sm" class="max-w-64 min-w-0 shrink" :disabled="opening" :title="module.homepage"
        :aria-label="t('catalog.homepageLabel', { name: module.name })" data-testid="catalog-info-homepage" @click="openHomepage"
      ><ExternalLink class="size-4 flex-none" :stroke-width="1.5" /><span class="truncate">{{ homepageText }}</span></Button>
      <Button v-if="installed" size="sm" variant="outline" class="border-primary/50 text-primary hover:bg-primary/10 hover:text-primary" data-testid="catalog-info-add" @click="emit('add')">{{ t("common.add") }}</Button>
      <Button v-else size="sm" :disabled="installing" data-testid="catalog-info-install" @click="emit('install')">{{ installing ? t("catalog.installing") : t("catalog.install") }}</Button>
    </div>
  </ModalDialog>
</template>
