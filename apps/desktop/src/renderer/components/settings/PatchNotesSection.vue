<script setup lang="ts">
// The patch notes page: what changed in each version, newest first. Opened from Settings > About
// or the version under the sections list. From 1.0.0 the entry of that version is the release
// catalog (everything Tavora can do) and earlier entries are gone (shared/release-catalog.ts).
import { computed } from "vue";
import { PATCH_NOTES } from "../../../shared/patch-notes";
import { RELEASE_CATALOG, visiblePatchNotes } from "../../../shared/release-catalog";
import { state } from "../../host";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { formatDate, language, t } from "../../i18n";

const version = computed(() => state.value!.appVersion);
const shown = computed(() => visiblePatchNotes(PATCH_NOTES));
</script>

<template>
  <p class="text-muted-foreground mb-6 text-sm">{{ t("settings.patchNotes.intro") }}</p>
  <div class="flex flex-col gap-8" data-testid="patch-notes">
    <article v-for="entry in shown.entries" :key="entry.version" :data-testid="`patch-notes-${entry.version}`">
      <header class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="text-lg font-semibold tabular-nums">{{ entry.version }}</h3>
        <Badge v-if="entry.version === version" variant="secondary" class="font-normal">{{ t("settings.patchNotes.installed") }}</Badge>
        <span class="text-muted-foreground text-sm">{{ formatDate(entry.date) }}</span>
      </header>
      <template v-if="entry === shown.catalog">
        <p class="mb-1 font-medium">{{ t("settings.patchNotes.catalogTitle") }}</p>
        <p class="text-muted-foreground mb-4 text-sm">{{ t("settings.patchNotes.catalogIntro") }}</p>
        <div class="flex flex-col gap-5" data-testid="release-catalog">
          <section v-for="group in RELEASE_CATALOG" :key="group.id" :data-testid="`release-catalog-${group.id}`">
            <h4 class="mb-1.5 font-medium">{{ group.title[language] }}</h4>
            <ul class="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5">
              <li v-for="item in group.items" :key="item.en">{{ item[language] }}</li>
            </ul>
          </section>
        </div>
      </template>
      <template v-else>
        <p class="mb-2 font-medium">{{ entry.title }}</p>
        <ul class="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5">
          <li v-for="note in entry.notes" :key="note">{{ note }}</li>
        </ul>
      </template>
    </article>
  </div>
</template>
