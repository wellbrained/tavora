<script setup lang="ts">
// A module's patch notes under its row in Settings > Modules, newest first, as plain text from its changelog file.
// Opening them tells the host they were seen, so the New mark goes away. Given `entries` (the notes
// of a catalog update that waits for the player), it shows those instead and marks nothing seen.
import { onMounted, ref } from "vue";
import type { ModuleNote } from "../../../shared/host-api";
import { act, api } from "../../host";
import { formatDate, t } from "../../i18n";

const props = defineProps<{ moduleId: string; version: string; unseen: boolean; entries?: ModuleNote[] }>();
const entries = ref<ModuleNote[] | null>(props.entries ?? null);

onMounted(async () => {
  if (props.entries) return;
  entries.value = await api.moduleNotes(props.moduleId);
  if (props.unseen) await act({ type: "seen-module-notes", moduleId: props.moduleId }, { quiet: true });
});
</script>

<template>
  <div class="bg-muted/40 flex flex-col gap-4 rounded-md px-4 py-3" :data-testid="`module-notes-${moduleId}`">
    <article v-for="entry in entries ?? []" :key="entry.version" :data-testid="`module-notes-${moduleId}-${entry.version}`">
      <header class="mb-1 flex flex-wrap items-baseline gap-x-3">
        <h4 class="font-semibold tabular-nums">{{ entry.version }}</h4>
        <span v-if="entry.version === version" class="bg-secondary text-foreground rounded-sm px-1.5 py-0.5 text-xs">{{ t("settings.patchNotes.installed") }}</span>
        <span v-if="entry.date" class="text-muted-foreground text-sm">{{ formatDate(entry.date) }}</span>
      </header>
      <ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
        <li v-for="(note, index) in entry.notes" :key="index">{{ note }}</li>
      </ul>
    </article>
  </div>
</template>
