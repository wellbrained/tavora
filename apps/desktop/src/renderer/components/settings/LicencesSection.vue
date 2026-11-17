<script setup lang="ts">
// Settings > Updates & About > Licences: everything Tavora is built from, with its licence and the full text. The list
// is written at build time (scripts/licences.mjs); a package opens to its licence text, which is only drawn while open.
import { onMounted, ref, computed } from "vue";
import type { LicenceList } from "../../../shared/host-api";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@tavora/official-ui/components/ui/collapsible";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { api } from "../../host";
import { t } from "../../i18n";
import { filterLicences } from "./licences-filter";

/** One value for the page: loading, ready with the list, or failed (the file couldn't be read). */
const loaded = ref<{ status: "loading" } | { status: "failed" } | { status: "ready"; list: LicenceList }>({ status: "loading" });
const query = ref("");

onMounted(async () => {
  const list = await api.licences().catch(() => null);
  loaded.value = list ? { status: "ready", list } : { status: "failed" };
});

const groups = computed(() => (loaded.value.status === "ready" ? filterLicences(loaded.value.list, query.value) : []));
const open = ref(new Set<string>());
const key = (entry: { name: string; version: string }) => `${entry.name}@${entry.version}`;
function toggle(id: string, value: boolean) {
  const next = new Set(open.value);
  if (value) next.add(id);
  else next.delete(id);
  open.value = next;
}
</script>

<template>
  <div :data-status="loaded.status" data-testid="licences-page">
    <p class="text-muted-foreground mb-4 text-sm">{{ t("settings.licences.intro") }}</p>
    <!-- It reads a local file, so "loading" shows nothing for the moment it takes. -->
    <EmptyState v-if="loaded.status === 'failed'" :title="t('settings.licences.failed')" :description="t('settings.licences.failedHint')" data-testid="licences-failed" />
    <template v-else-if="loaded.status === 'ready'">
      <SearchInput v-model="query" class="mb-6 max-w-80" :placeholder="t('settings.licences.find')" :aria-label="t('settings.licences.find')" data-testid="licences-search" />
      <EmptyState v-if="!groups.length" :title="t('settings.licences.none')" data-testid="licences-none" />
      <div class="flex flex-col gap-8" data-testid="licences">
        <section v-for="part in groups" :key="part.group" :data-testid="`licences-${part.group}`">
          <h3 class="mb-2 font-medium">{{ t(`settings.licences.group.${part.group}`) }} <span class="text-muted-foreground text-sm font-normal tabular-nums">{{ part.entries.length }}</span></h3>
          <div class="flex flex-col">
            <Collapsible v-for="entry in part.entries" :key="key(entry)" class="border-b last:border-b-0" :open="open.has(key(entry))" @update:open="(value: boolean) => toggle(key(entry), value)">
              <CollapsibleTrigger class="py-2" data-testid="licence-package">
                <span class="min-w-0 flex-1 truncate">{{ entry.name }} <span class="text-muted-foreground font-normal tabular-nums">{{ entry.version }}</span></span>
                <Badge variant="secondary" class="flex-none font-normal">{{ entry.license }}</Badge>
              </CollapsibleTrigger>
              <CollapsibleContent class="pb-3 pl-6">
                <template v-if="open.has(key(entry))">
                  <p v-if="entry.inferred" class="text-muted-foreground mb-2 text-sm">{{ t("settings.licences.inferred") }}</p>
                  <pre v-for="index in entry.texts" :key="index" class="bg-muted text-muted-foreground mb-2 max-h-80 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap" data-testid="licence-text">{{ loaded.list.texts[index] }}</pre>
                </template>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>
