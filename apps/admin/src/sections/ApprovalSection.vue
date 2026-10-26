<script setup lang="ts">
// The review before listing: versions that wait (why, who sent them, what they ask for, what is inside), Approve,
// Decline and Ban; the banned developers; and the one-time check of what is already live. Everything a developer
// sent is shown as text, never as markup; files open as plain text.
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { EmptyState } from "@tavora/official-ui/components/ui/empty-state";
import { Expandable } from "@tavora/official-ui/components/ui/expandable";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Tabs, TabsList, TabsTrigger } from "@tavora/official-ui/components/ui/tabs";
import { computed, onMounted, ref, watch } from "vue";
import { act, call, keepPictures, message, resource } from "../api";
import ActionButton from "../components/ActionButton.vue";
import Fact from "../components/Fact.vue";
import Group from "../components/Group.vue";
import Line from "../components/Line.vue";
import PageTitle from "../components/PageTitle.vue";
import Picture from "../components/Picture.vue";
import ReasonDialog from "../components/ReasonDialog.vue";
import { bytes, reasonLabel, when } from "../format";
import { refreshTick, summary } from "../nav";
import { problem } from "../problem";
import type { Ban, DeclineReason, LiveCheck, WaitingVersion } from "../types";

const tab = ref("waiting");
const waiting = resource<{ waiting: WaitingVersion[] }>("/api/moderation/waiting");
const bans = resource<{ bans: Ban[] }>("/api/moderation/bans");
const live = resource<{ result: LiveCheck | null; running: boolean }>("/api/moderation/live-check");
const versions = computed(() => waiting.data.value?.waiting ?? []);
const error = computed(() => waiting.error.value || bans.error.value || live.error.value);

const picturePath = (picture: { sha256: string; type: string }) => `/api/moderation/pictures/${picture.sha256}.${picture.type}`;

async function load(): Promise<void> {
  await Promise.all([waiting.reload(), bans.reload(), live.reload(), summary.reload()]);
  keepPictures(new Set(versions.value.flatMap((version) => version.module.pictures.map(picturePath))));
}

const then =
  (change: () => Promise<void>) =>
  async (): Promise<void> => {
    await change();
    await load();
  };

// One file of a waiting zip, opened as text under its list. Pressing it again closes it.
const open = ref<{ sha256: string; name: string; text: string } | null>(null);
async function show(version: WaitingVersion, name: string): Promise<void> {
  if (open.value?.sha256 === version.sha256 && open.value.name === name) {
    open.value = null;
    return;
  }
  const response = await call(`/api/moderation/waiting/${version.sha256}/file?name=${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`Can't open ${name}.`);
  open.value = { sha256: version.sha256, name, text: await response.text() };
}

// Decline and Ban ask for a reason first.
const asking = ref<{ kind: "decline" | "ban"; version: WaitingVersion } | null>(null);
async function decide(reason: DeclineReason, note: string): Promise<void> {
  const ask = asking.value;
  asking.value = null;
  if (!ask) return;
  try {
    await act(ask.kind === "decline" ? "/api/moderation/decline" : "/api/moderation/ban", { sha256: ask.version.sha256, reason, ...(note ? { note } : {}) });
    problem.value = "";
  } catch (failure) {
    problem.value = message(failure);
  }
  await load();
}

const runLive = (again: boolean) => then(() => act("/api/moderation/live-check", { again }));
const flagged = computed(() => (live.data.value?.result?.results ?? []).filter((item) => item.reasons.length > 0 || item.error));
const permissions = (version: WaitingVersion) => [...version.module.permissions.network, ...version.module.permissions.connectors.map((id) => `connector: ${id}`)];

const DECLINE_TEXT = "Its zip is deleted and the developer gets an email with your reason.";
const BAN_TEXT = "They can't publish anymore, their modules leave the catalog and what still waits is declined.";

onMounted(() => void load());
watch(refreshTick, () => void load());
</script>

<template>
  <PageTitle title="Approval" hint="Module versions that wait for you before they're listed." />
  <Notice v-if="error" variant="error">{{ error }}</Notice>

  <Tabs v-model="tab" class="border-b">
    <TabsList class="h-9 w-full overflow-x-auto border-b-0" aria-label="Approval lists">
      <TabsTrigger value="waiting">Waiting ({{ versions.length }})</TabsTrigger>
      <TabsTrigger value="bans">Banned ({{ bans.data.value?.bans.length ?? 0 }})</TabsTrigger>
      <TabsTrigger value="live">Live check</TabsTrigger>
    </TabsList>
  </Tabs>

  <!-- Waiting: one block per version -->
  <template v-if="tab === 'waiting'">
    <Group
      v-for="version in versions"
      :key="version.sha256"
      :title="`${version.name} ${version.version}`"
      :hint="`${version.id} · ${bytes(version.size)} · waiting since ${when(version.queuedAt)} · ${version.previousVersion ? `live now: ${version.previousVersion}` : 'first version'}`"
    >
      <template #actions>
        <ActionButton
          variant="default"
          :disabled="version.developer.banned"
          :run="then(() => act('/api/moderation/approve', { sha256: version.sha256 }))"
          :ask="{ title: `List ${version.name} ${version.version}?`, description: 'It goes into the catalog at once and the developer gets an email.', confirm: 'Approve' }"
          >Approve</ActionButton
        >
        <Button type="button" variant="secondary" size="sm" @click="asking = { kind: 'decline', version }">Decline</Button>
        <Button v-if="version.developer.accountId && !version.developer.banned" type="button" variant="danger" size="sm" @click="asking = { kind: 'ban', version }">Ban developer</Button>
      </template>

      <div class="flex flex-col gap-1.5 px-3 py-3">
        <p class="text-sm font-medium">Why it waits</p>
        <ul class="flex flex-col gap-1.5">
          <li v-for="(reason, index) in version.reasons" :key="index" class="text-sm">
            <Badge variant="warning" class="mr-1.5">{{ reason.check }}</Badge>{{ reason.text }}
            <span v-if="reason.detail" class="text-muted-foreground block text-xs break-words">{{ reason.detail }}</span>
          </li>
        </ul>
      </div>

      <Fact label="Developer" :hint="`${version.developer.name ?? '(no name)'} · ${version.developer.email ?? '(no email)'}`">
        <Badge v-if="version.developer.banned" variant="destructive">banned</Badge>
        <Badge v-else :variant="version.developer.approvedBefore ? 'success' : 'warning'">{{ version.developer.approvedBefore ? "approved before" : "new" }}</Badge>
      </Fact>
      <Fact v-if="version.developer.modules.length" label="Their modules" :hint="version.developer.modules.join(', ')" />
      <Fact label="Asks for" :hint="permissions(version).join(', ') || 'Nothing outside its panel'" />
      <Fact v-if="version.module.description" label="Description" :hint="version.module.description" />
      <Fact v-if="version.module.homepage || version.module.support" label="Links" :hint="[version.module.homepage, version.module.support].filter(Boolean).join(' · ')" />

      <div v-if="version.module.pictures.length" class="flex flex-wrap gap-3 px-3 py-3">
        <div v-for="picture in version.module.pictures" :key="picture.sha256" class="flex flex-col items-center gap-1">
          <Picture :path="picturePath(picture)" />
          <span class="text-muted-foreground text-xs">{{ picture.kind }}</span>
        </div>
      </div>

      <div v-if="version.module.notes.length" class="flex flex-col gap-1 px-3 py-3">
        <p class="text-sm font-medium">What's new</p>
        <ul class="list-disc pl-5 text-sm break-words"><li v-for="(note, index) in version.module.notes" :key="index">{{ note }}</li></ul>
      </div>
      <div v-if="version.module.readme" class="flex flex-col gap-1 px-3 py-3">
        <p class="text-sm font-medium">README</p>
        <Expandable :max-height="120"><p class="text-sm break-words whitespace-pre-wrap">{{ version.module.readme }}</p></Expandable>
      </div>

      <div class="flex flex-col gap-1 px-3 py-3">
        <p class="text-sm font-medium">Files ({{ version.module.files.length }})</p>
        <ul class="flex flex-col">
          <li v-for="file in version.module.files" :key="file.name" class="flex items-center gap-2">
            <ActionButton variant="ghost" size="xs" :run="() => show(version, file.name)">{{ file.name }}</ActionButton>
            <span class="text-muted-foreground ml-auto text-xs tabular-nums">{{ bytes(file.size) }}</span>
          </li>
        </ul>
        <pre v-if="open && open.sha256 === version.sha256" class="bg-secondary mt-2 max-h-96 overflow-auto rounded-md p-3 text-xs" :aria-label="open.name">{{ open.text }}</pre>
      </div>
    </Group>
    <EmptyState v-if="waiting.data.value && !versions.length" title="All clear" description="No module versions are waiting." />
  </template>

  <!-- Banned developers -->
  <template v-else-if="tab === 'bans'">
    <Group title="Banned developers" hint="They can't publish. Unban puts the modules the ban took out back in the catalog.">
      <Line
        v-for="ban in bans.data.value?.bans ?? []"
        :key="ban.accountId"
        :title="ban.name ?? ban.email ?? ban.accountId"
        :sub="`${reasonLabel(ban.reason)}${ban.note ? `: ${ban.note}` : ''} · ${when(ban.bannedAt)} · ${ban.modules.length} unlisted`"
      >
        <template #actions>
          <ActionButton
            variant="secondary"
            :run="then(() => act('/api/moderation/unban', { accountId: ban.accountId }))"
            :ask="{ title: 'Unban this developer?', description: 'They can publish again, and their modules go back into the catalog.', confirm: 'Unban' }"
            >Unban</ActionButton
          >
        </template>
      </Line>
      <EmptyState v-if="bans.data.value && !bans.data.value.bans.length" class="m-3" title="Nobody is banned" />
    </Group>
  </template>

  <!-- The one-time check of what is live -->
  <template v-else>
    <Group title="Check what's live" hint="Runs the checks over every listed version. Shows results only; nothing is unlisted.">
      <template #actions>
        <ActionButton v-if="!live.data.value?.result" variant="default" :disabled="live.data.value?.running" :run="runLive(false)">Run the check</ActionButton>
        <ActionButton
          v-else
          variant="secondary"
          :disabled="live.data.value?.running"
          :run="runLive(true)"
          :ask="{ title: 'Run it again?', description: 'The new results replace the old ones.', confirm: 'Run again' }"
          >Run again</ActionButton
        >
      </template>
      <template v-if="live.data.value?.result">
        <Fact label="Ran" :value="when(live.data.value.result.ranAt)" />
        <Fact label="Checked" :value="live.data.value.result.checked" />
        <Fact label="Flagged" :value="live.data.value.result.flagged" />
        <Fact v-if="live.data.value.result.skipped" label="Skipped (zip gone)" :value="live.data.value.result.skipped" />
      </template>
      <p v-else-if="live.data.value" class="text-muted-foreground px-3 py-3 text-sm">{{ live.data.value.running ? "Running…" : "Not run yet." }}</p>
    </Group>
    <Group v-if="flagged.length" title="Flagged">
      <Line v-for="item in flagged" :key="`${item.id}@${item.version}`" :title="`${item.name} ${item.version}`" :sub="`${item.id} · ${item.developer ?? '(no developer name)'}`">
        <ul class="mt-1 flex flex-col gap-0.5">
          <li v-if="item.error" class="text-sm">{{ item.error }}</li>
          <li v-for="(reason, index) in item.reasons" :key="index" class="text-sm"><Badge variant="warning" class="mr-1.5">{{ reason.check }}</Badge>{{ reason.text }}</li>
        </ul>
      </Line>
    </Group>
  </template>

  <ReasonDialog
    v-if="asking"
    :title="asking.kind === 'decline' ? `Decline ${asking.version.name} ${asking.version.version}?` : `Ban ${asking.version.developer.name ?? 'this developer'}?`"
    :description="asking.kind === 'decline' ? DECLINE_TEXT : BAN_TEXT"
    :confirm="asking.kind === 'decline' ? 'Decline' : 'Ban'"
    @confirm="decide"
    @cancel="asking = null"
  />
</template>
