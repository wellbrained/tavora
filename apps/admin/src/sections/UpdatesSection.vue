<script setup lang="ts">
// Show-only: the app version on the update feed, and the patch notes of the versions around it.
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { computed, onMounted, ref, watch } from "vue";
import { resource } from "../api";
import Fact from "../components/Fact.vue";
import Group from "../components/Group.vue";
import PageTitle from "../components/PageTitle.vue";
import { bytes, when } from "../format";
import { refreshTick } from "../nav";
import type { Updates } from "../types";

const updates = resource<Updates>("/api/updates");
const SHOWN = 8;
const all = ref(false);
const versions = computed(() => (all.value ? updates.data.value?.versions : updates.data.value?.versions.slice(0, SHOWN)) ?? []);

const STATES = {
  "on-feed": { label: "On the feed", variant: "success" },
  waiting: { label: "Not on the feed yet", variant: "warning" },
  earlier: { label: "Earlier", variant: "secondary" },
  unknown: { label: "Unknown", variant: "secondary" },
} as const;

onMounted(() => void updates.reload());
watch(refreshTick, () => void updates.reload());
</script>

<template>
  <PageTitle title="Updates" hint="The app versions players can get. Show-only for now." />
  <Notice v-if="updates.error.value" variant="error">{{ updates.error.value }}</Notice>

  <Group title="Update feed" hint="updates.mytavora.app">
    <template v-if="updates.data.value">
      <Fact v-if="updates.data.value.feed" label="Version on the feed" :value="updates.data.value.feed.version" />
      <Fact v-if="updates.data.value.feed" label="Released" :value="when(updates.data.value.feed.releasedAt)" />
      <Fact v-if="updates.data.value.feed?.installerSize" label="Installer size" :value="bytes(updates.data.value.feed.installerSize)" />
      <Notice v-if="!updates.data.value.feed" variant="warning" class="m-3">Can't read the update feed right now.</Notice>
    </template>
    <p v-else class="text-muted-foreground px-3 py-3 text-sm">Loading…</p>
  </Group>

  <Group v-if="updates.data.value" title="Patch notes" hint="As of the last API release.">
    <div v-for="version in versions" :key="version.version" class="flex flex-col gap-1.5 px-3 py-3">
      <div class="flex items-center gap-2">
        <p class="text-sm font-medium">{{ version.version }}</p>
        <Badge :variant="STATES[version.state].variant">{{ STATES[version.state].label }}</Badge>
        <span class="text-muted-foreground ml-auto text-xs">{{ version.date }}</span>
      </div>
      <p class="text-sm">{{ version.title }}</p>
      <ul class="text-muted-foreground list-disc pl-5 text-xs">
        <li v-for="note in version.notes" :key="note">{{ note }}</li>
      </ul>
    </div>
    <div v-if="updates.data.value.versions.length > SHOWN" class="px-3 py-2">
      <Button type="button" variant="ghost" size="sm" @click="all = !all">{{ all ? "Show fewer" : "Show older versions" }}</Button>
    </div>
  </Group>
</template>
