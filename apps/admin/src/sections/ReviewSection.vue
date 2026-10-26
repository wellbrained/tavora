<script setup lang="ts">
// The old review page, tab for tab, with the same actions: pending icons, hosted icons, reported modules,
// reported reviews and publisher key requests. Everything a player sent is shown as text, never as markup.
import { Star } from "@lucide/vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Tabs, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { computed, onMounted, ref, watch } from "vue";
import { act, call, download, keepPictures, message, resource } from "../api";
import ActionButton from "../components/ActionButton.vue";
import Group from "../components/Group.vue";
import Line from "../components/Line.vue";
import PageTitle from "../components/PageTitle.vue";
import Picture from "../components/Picture.vue";
import { when } from "../format";
import { refreshTick, reviewTab, summary } from "../nav";
import { problem } from "../problem";
import type { HostedIcon, KeyRequest, Overview, PendingIcon, Reports, ReviewReport } from "../types";

const overview = resource<Overview>("/api/overview");
const reports = resource<Reports>("/api/reports");
const reviews = resource<{ reports: ReviewReport[] }>("/api/reviews");
const keys = resource<{ requests: KeyRequest[] }>("/api/keys");
const search = ref("");
const busyAll = ref(false);

const pending = computed(() => overview.data.value?.pending ?? []);
const hosted = computed(() => {
  const query = search.value.trim().toLowerCase();
  return (overview.data.value?.hosted ?? []).filter((icon) => !query || icon.id.includes(query) || icon.names.some((name) => name.toLowerCase().includes(query)));
});
const waitingKeys = computed(() => keys.data.value?.requests.filter((request) => request.status === "waiting").length ?? 0);
const error = computed(() => overview.error.value || reports.error.value || reviews.error.value || keys.error.value);

const pendingPath = (row: PendingIcon) => `/api/pending/${row.sha256}.png`;
const hostedPath = (icon: HostedIcon) => `/api/hosted/${icon.id}.png?v=${icon.sha256}`;

async function load(): Promise<void> {
  await Promise.all([overview.reload(), reports.reload(), reviews.reload(), keys.reload(), summary.reload()]);
  // Only the pictures the open lists show are kept.
  keepPictures(new Set([...pending.value.map(pendingPath), ...(overview.data.value?.hosted ?? []).map(hostedPath)]));
}

/** Runs a change, then reloads everything it can touch. */
const then =
  (change: () => Promise<void>) =>
  async (): Promise<void> => {
    await change();
    await load();
  };

const approve = (row: PendingIcon) => then(() => act("/api/approve", { sha256: row.sha256 }));
const deny = (row: PendingIcon, block: boolean) => then(() => act("/api/deny", { sha256: row.sha256, block }));
const takedown = (icon: HostedIcon, block: boolean) => then(() => act("/api/takedown", { id: icon.id, block }));

// One call per offer, one after another; an offer that fails (say, its game got an icon a moment ago) is skipped.
async function bulk(past: string, rows: PendingIcon[], path: string, extra: Record<string, unknown>): Promise<void> {
  busyAll.value = true;
  let done = 0;
  try {
    for (const row of rows) {
      const response = await call(path, { sha256: row.sha256, ...extra });
      if (response.ok) done++;
    }
  } catch (failure) {
    problem.value = message(failure);
  } finally {
    busyAll.value = false;
  }
  await load();
  if (done < rows.length) problem.value = `${past} ${done} of ${rows.length}, skipped the rest.`;
}


const short = (fingerprint: string) => `${fingerprint.slice(0, 12)}…`;
const DAY = 86_400_000;

onMounted(() => void load());
watch(refreshTick, () => void load());
</script>

<template>
  <PageTitle title="Review" hint="Icons, reports and key requests that need a person." />
  <Notice v-if="error" variant="error">{{ error }}</Notice>
  <Notice v-if="reports.data.value?.catalogFullSince" variant="warning">The module catalog has been full since {{ when(reports.data.value.catalogFullSince) }}. Uploads are refused until there's room.</Notice>

  <Tabs v-model="reviewTab" class="border-b">
    <TabsList class="h-9 w-full overflow-x-auto border-b-0" aria-label="Review lists">
      <TabsTrigger value="pending">Needs review ({{ pending.length }})</TabsTrigger>
      <TabsTrigger value="hosted">Hosted ({{ overview.data.value?.hosted.length ?? 0 }})</TabsTrigger>
      <TabsTrigger value="reports">Reports ({{ reports.data.value?.reports.length ?? 0 }})</TabsTrigger>
      <TabsTrigger value="reviews">Reviews ({{ reviews.data.value?.reports.length ?? 0 }})</TabsTrigger>
      <TabsTrigger value="keys">Keys ({{ waitingKeys }})</TabsTrigger>
    </TabsList>
  </Tabs>

  <!-- Needs review: icons players offered -->
  <template v-if="reviewTab === 'pending'">
    <Group title="Icons players offered">
      <template #actions>
        <ActionButton
          v-if="pending.length"
          variant="default"
          :disabled="busyAll"
          :run="() => bulk('Approved', pending.filter((row) => !row.hasIcon), '/api/approve', {})"
          :ask="{ title: 'Approve all?', description: `Approve every offer that has no icon yet (${pending.filter((row) => !row.hasIcon).length}).`, confirm: 'Approve all' }"
          >Approve all</ActionButton
        >
        <ActionButton
          v-if="pending.length"
          variant="danger"
          :disabled="busyAll"
          :run="() => bulk('Denied', pending, '/api/deny', { block: false })"
          :ask="{ title: 'Deny all?', description: `Deny all ${pending.length} offers. They can be offered again.`, confirm: 'Deny all' }"
          >Deny all</ActionButton
        >
      </template>
      <Line v-for="row in pending" :key="row.sha256" :title="row.gameName || row.name || '(unknown game)'">
        <template #lead><Picture :path="pendingPath(row)" /></template>
        <template #badges>
          <Badge :variant="row.hasIcon ? 'destructive' : 'warning'">{{ row.hasIcon ? "has an icon" : "new" }}</Badge>
          <Badge v-if="row.custom" variant="outline">custom game</Badge>
        </template>
        <template #actions>
          <ActionButton variant="default" :disabled="row.hasIcon" :run="approve(row)">Approve</ActionButton>
          <ActionButton variant="secondary" :run="deny(row, false)">Deny</ActionButton>
          <ActionButton
            variant="danger"
            :run="deny(row, true)"
            :ask="{ title: 'Block this icon?', description: 'Deny it, never take this file again, and stop its sender from sharing.', confirm: 'Block' }"
            >Block</ActionButton
          >
        </template>
      </Line>
      <EmptyState v-if="overview.data.value && !pending.length" class="m-3" title="All clear" description="No icons are waiting." />
    </Group>
  </template>

  <!-- Hosted: the icons Tavora serves -->
  <template v-else-if="reviewTab === 'hosted'">
    <Input v-model="search" type="search" placeholder="Search games" aria-label="Search games" autocomplete="off" class="max-w-xs" />
    <Group>
      <Line v-for="icon in hosted" :key="icon.id" :title="icon.names[0] ?? icon.id">
        <template #lead><Picture :path="hostedPath(icon)" /></template>
        <template #badges><Badge :variant="icon.origin === 'release' ? 'secondary' : 'success'">{{ icon.origin }}</Badge></template>
        <template #actions>
          <ActionButton variant="danger" :run="takedown(icon, false)" :ask="{ title: `Take down ${icon.names[0] ?? icon.id}?`, description: 'The icon stops being served at once.', confirm: 'Take down' }">Take down</ActionButton>
          <ActionButton variant="danger" :run="takedown(icon, true)" :ask="{ title: `Block ${icon.names[0] ?? icon.id}?`, description: 'Take it down and never take this file again.', confirm: 'Block' }">Block</ActionButton>
        </template>
      </Line>
      <EmptyState v-if="overview.data.value && !hosted.length" class="m-3" :title="overview.data.value.hosted.length ? 'No matches' : 'No icons yet'" />
    </Group>
  </template>

  <!-- Reports: modules players reported -->
  <template v-else-if="reviewTab === 'reports'">
    <Group title="Reported modules" hint="Reports hide nothing. Unlist a module here to hide it from Browse.">
      <Line v-for="report in reports.data.value?.reports ?? []" :key="report.sha256" :title="`${report.name} ${report.version}`">
        <template #badges>
          <Badge :variant="report.listed ? 'success' : 'destructive'">{{ report.listed ? "in catalog" : "unlisted" }}</Badge>
          <Badge variant="warning">{{ report.count }} {{ report.count === 1 ? "report" : "reports" }}</Badge>
        </template>
        <template #actions>
          <ActionButton
            v-if="report.listed"
            variant="danger"
            :run="then(() => act('/api/catalog/listed', { id: report.id, listed: false }))"
            :ask="{ title: `Unlist ${report.name}?`, description: 'It leaves Browse. Installed copies keep working.', confirm: 'Unlist' }"
            >Unlist</ActionButton
          >
          <ActionButton v-else variant="secondary" :run="then(() => act('/api/catalog/listed', { id: report.id, listed: true }))">List</ActionButton>
          <ActionButton variant="secondary" :run="then(() => act('/api/reports/dismiss', { sha256: report.sha256 }))">Dismiss</ActionButton>
        </template>
      </Line>
      <EmptyState v-if="reports.data.value && !reports.data.value.reports.length" class="m-3" title="No reports" description="Nice!" />
    </Group>
  </template>

  <!-- Reviews: reviews players reported -->
  <template v-else-if="reviewTab === 'reviews'">
    <Group title="Reported reviews" hint="Hide takes the text and the publisher's reply off the module page. The stars still count.">
      <Line v-for="{ review, count } in reviews.data.value?.reports ?? []" :key="review.id" :title="review.moduleName">
        <p class="flex items-center gap-0.5" :aria-label="`${review.stars} stars`">
          <Star v-for="n in review.stars" :key="n" class="text-primary size-3.5 fill-current" aria-hidden="true" />
        </p>
        <p class="mt-1 text-sm break-words whitespace-pre-wrap">{{ review.text }}</p>
        <p v-if="review.reply" class="text-muted-foreground mt-1 text-sm break-words whitespace-pre-wrap">Reply: {{ review.reply }}</p>
        <template #badges>
          <Badge variant="warning">{{ count }} {{ count === 1 ? "report" : "reports" }}</Badge>
          <Badge variant="outline">{{ review.author || "(no name)" }}</Badge>
          <Badge variant="outline">{{ review.version }}</Badge>
          <Badge v-if="review.hidden" variant="destructive">hidden</Badge>
        </template>
        <template #actions>
          <ActionButton v-if="review.hidden" variant="secondary" :run="then(() => act('/api/reviews/hidden', { id: review.id, hidden: false }))">Show</ActionButton>
          <ActionButton v-else variant="danger" :run="then(() => act('/api/reviews/hidden', { id: review.id, hidden: true }))">Hide</ActionButton>
          <ActionButton variant="secondary" :run="then(() => act('/api/reviews/dismiss', { id: review.id }))">Dismiss</ActionButton>
        </template>
      </Line>
      <EmptyState v-if="reviews.data.value && !reviews.data.value.reports.length" class="m-3" title="No reported reviews" />
    </Group>
  </template>

  <!-- Keys: developers asking to replace a lost or leaked publisher key -->
  <template v-else>
    <Group title="Key requests">
      <template #actions>
        <ActionButton variant="secondary" :run="() => download('/api/keys/successions.json', 'successions.json')">successions.json</ActionButton>
        <ActionButton variant="secondary" :run="() => download('/api/keys/revocations.json', 'revocations.json')">revocations.json</ActionButton>
      </template>
      <p class="text-muted-foreground px-3 py-2 text-xs">
        Each file holds every entry in force plus the waiting ones. Check it, sign it offline with
        <code>pnpm tavora-catalog-sign &lt;kind&gt; &lt;file&gt; --key &lt;catalogue key&gt; --out &lt;signed file&gt;</code>, then upload with <code>tavora-api-catalog set-list</code>. A request shows as done once the served list holds it.
      </p>
      <Line
        v-for="request in keys.data.value?.requests ?? []"
        :key="request.old"
        :title="`${short(request.old)} → ${short(request.new)}`"
        :sub="`${request.developer || '(no developer name)'} · ${request.email || '(no email)'} · asked ${when(request.requestedAt)}${request.newLinkedAt ? ` · new key linked ${when(request.newLinkedAt)}` : ''}`"
      >
        <template #badges>
          <Badge :variant="request.leaked ? 'destructive' : 'warning'">{{ request.leaked ? "leaked" : "lost" }}</Badge>
          <Badge :variant="request.status === 'done' ? 'success' : request.status === 'declined' ? 'destructive' : 'secondary'">{{ request.status }}</Badge>
          <Badge v-if="request.newLinkedAt && Date.parse(request.requestedAt) - Date.parse(request.newLinkedAt) < DAY" variant="destructive">new key is fresh</Badge>
        </template>
        <template #actions>
          <ActionButton
            v-if="request.status === 'waiting'"
            variant="danger"
            :run="then(() => act('/api/keys/decline', { old: request.old }))"
            :ask="{ title: 'Turn this request down?', description: `The developer keeps ${short(request.old)}.`, confirm: 'Decline' }"
            >Decline</ActionButton
          >
        </template>
      </Line>
      <EmptyState v-if="keys.data.value && !keys.data.value.requests.length" class="m-3" title="No key requests" />
    </Group>
  </template>
</template>
