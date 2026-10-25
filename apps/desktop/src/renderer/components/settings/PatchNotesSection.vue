<script setup lang="ts">
// The patch notes page: what changed in each version, newest first. Opened from Settings > About
// or the version under the sections list.
import { computed } from "vue";
import { PATCH_NOTES } from "../../../shared/patch-notes";
import { state } from "../../host";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { formatDate, t } from "../../i18n";

const version = computed(() => state.value!.appVersion);
</script>

<template>
  <p class="text-muted-foreground mb-6 text-sm">{{ t("settings.patchNotes.intro") }}</p>
  <div class="flex flex-col gap-8" data-testid="patch-notes">
    <article v-for="entry in PATCH_NOTES" :key="entry.version" :data-testid="`patch-notes-${entry.version}`">
      <header class="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 class="text-lg font-semibold tabular-nums">{{ entry.version }}</h3>
        <Badge v-if="entry.version === version" variant="secondary" class="font-normal">{{ t("settings.patchNotes.installed") }}</Badge>
        <span class="text-muted-foreground text-sm">{{ formatDate(entry.date) }}</span>
      </header>
      <p class="mb-2 font-medium">{{ entry.title }}</p>
      <ul class="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5">
        <li v-for="note in entry.notes" :key="note">{{ note }}</li>
      </ul>
    </article>
  </div>
</template>
