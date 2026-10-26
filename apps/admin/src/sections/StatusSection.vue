<script setup lang="ts">
// Show-only: is everything up, and is anything waiting to be released.
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { onMounted, watch } from "vue";
import { resource } from "../api";
import Fact from "../components/Fact.vue";
import Group from "../components/Group.vue";
import PageTitle from "../components/PageTitle.vue";
import { ago, bytes, when } from "../format";
import { refreshTick } from "../nav";
import type { Status } from "../types";

const status = resource<Status>("/api/status");

// A backup is daily; older than 36 hours means one was missed.
const stale = (iso: string | null) => !iso || Date.now() - Date.parse(iso) > 36 * 3_600_000;

onMounted(() => void status.reload());
watch(refreshTick, () => void status.reload());
</script>

<template>
  <PageTitle title="Status" hint="Is everything running? Show-only." />
  <Notice v-if="status.error.value" variant="error">{{ status.error.value }}</Notice>

  <template v-if="status.data.value">
    <Group title="Service">
      <Fact label="API" :hint="`${status.data.value.api.games.toLocaleString()} games`"><Badge variant="success">Running</Badge></Fact>
      <Fact label="Game dataset built" :value="when(status.data.value.api.builtAt)" />
      <Fact v-if="status.data.value.mail" label="Emails sent today" :hint="status.data.value.mail.limit ? 'Daily limit' : undefined" :value="status.data.value.mail.limit ? `${status.data.value.mail.sent} of ${status.data.value.mail.limit}` : status.data.value.mail.sent" />
      <Fact v-else label="Emails" value="Off" />
      <Fact label="Last backup" :value="status.data.value.backup.at ? ago(status.data.value.backup.at) : 'Not reported'" :hint="status.data.value.backup.at ? when(status.data.value.backup.at) : undefined">
        <Badge v-if="status.data.value.backup.at && stale(status.data.value.backup.at)" variant="warning">Late</Badge>
      </Fact>
      <Fact label="Catalog storage" :value="`${bytes(status.data.value.catalog.storedBytes)} of ${bytes(status.data.value.catalog.limitBytes)}`">
        <Badge v-if="status.data.value.catalog.fullSince" variant="destructive">Full</Badge>
      </Fact>
    </Group>

    <Group title="Websites">
      <Fact v-for="site in status.data.value.sites" :key="site.name" :label="site.name">
        <Badge :variant="site.ok ? 'success' : 'destructive'">{{ site.ok ? "Up" : site.status ? `Error ${site.status}` : "Down" }}</Badge>
      </Fact>
    </Group>

    <Group title="Packages" hint="npm against the repository's main branch.">
      <Fact v-for="entry in status.data.value.packages" :key="entry.name" :label="entry.name" :hint="`npm ${entry.npm ?? 'unknown'} · main ${entry.main ?? 'unknown'}`">
        <Badge v-if="entry.mainAhead" variant="warning">Main is ahead</Badge>
        <Badge v-else-if="entry.npm && entry.main" variant="success">Up to date</Badge>
        <Badge v-else variant="secondary">Unknown</Badge>
      </Fact>
    </Group>
  </template>
  <p v-else-if="!status.error.value" class="text-muted-foreground text-sm">Checking…</p>
</template>
