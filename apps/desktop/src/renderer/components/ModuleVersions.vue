<script setup lang="ts">
// A catalog module's patch notes: What's new (the newest version) stays open, and every version with its
// date follows under All versions. When the module is installed and two or more versions behind, the
// versions newer than the installed one are marked New for you. Every text is plain text (C10).
import { computed } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Expandable } from "@tavora/official-ui/components/ui/expandable";
import type { CatalogPage } from "../../shared/host-api";
import { compareModuleVersions } from "../../shared/module-version";
import { state } from "../host";
import { formatDate, t } from "../i18n";

const props = defineProps<{ moduleId: string; versions: CatalogPage["versions"]; version: string }>();

const latest = computed(() => props.versions.find((item) => item.version === props.version) ?? null);
const installed = computed(() => state.value?.modules.find((module) => module.id === props.moduleId)?.version ?? null);
/** The versions newer than the installed one, marked when it is more than one behind. */
const fresh = computed(() => {
  const have = installed.value;
  if (!have) return new Set<string>();
  const newer = props.versions.filter((item) => compareModuleVersions(item.version, have) > 0);
  return newer.length > 1 ? new Set(newer.map((item) => item.version)) : new Set<string>();
});
const date = (at: string) => (at && !Number.isNaN(Date.parse(at)) ? formatDate(at) : null);
</script>

<template>
  <div class="space-y-6">
    <section v-if="latest?.notes.length" data-testid="catalog-info-notes">
      <h3 class="mb-2 font-medium">{{ t("catalog.whatsNew") }}</h3>
      <Expandable :max-height="96">
        <ul class="list-disc space-y-1 pl-5 text-sm">
          <li v-for="(note, index) in latest.notes" :key="index">{{ note }}</li>
        </ul>
      </Expandable>
    </section>

    <section v-if="versions.length > 1" data-testid="catalog-info-versions">
      <h3 class="mb-2 font-medium">{{ t("catalog.allVersions") }}</h3>
      <Expandable :max-height="120">
        <ol class="space-y-4 text-sm">
          <li v-for="item in versions" :key="item.version" :data-testid="`catalog-info-version-${item.version}`">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-medium tabular-nums">{{ item.version }}</span>
              <span v-if="date(item.publishedAt)" class="text-muted-foreground">{{ date(item.publishedAt) }}</span>
              <Badge v-if="fresh.has(item.version)" data-testid="catalog-info-version-new">{{ t("catalog.newForYou") }}</Badge>
            </p>
            <ul v-if="item.notes.length" class="mt-1 list-disc space-y-1 pl-5">
              <li v-for="(note, index) in item.notes" :key="index">{{ note }}</li>
            </ul>
          </li>
        </ol>
      </Expandable>
    </section>
  </div>
</template>
