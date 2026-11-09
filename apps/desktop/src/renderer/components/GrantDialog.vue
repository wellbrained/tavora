<script setup lang="ts">
// The consent dialog (decision log, module grants row of 2026-10-16): what a module asks for that the
// user has not granted, shown when the module is first added or when an update asks for more.
// Tavora draws it, never the module, so a module cannot fake or hide what it asks for. A connector
// shows what the module would read through it: for AI Usage, the accounts set up right now; for
// Discord, what it can see and do in the Discord app, with Tavora's sign-in. For a catalog update that
// asks for more (`request.update`), it shows what the update asks for that the installed version did
// not, and the update's patch notes; allowing installs the update, and until then the installed
// version keeps running (catalog threat model, C4).
// With `inPanel` the same question is the content of the panel that asks (decision of 2026-10-28): the module's first
// panel when it is added or still misses access, or the running panel that asks for a connector on request. Cancel then
// closes the panels that wait for the answer; Allow lets the host start them (main/host.ts questionOf).
import { Check, Cpu, Folder, Gauge, Globe, Headphones, Monitor, Music, Radio, ShieldCheck, Trophy } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { act, aiUsage, closeDialog, dialog, discord, nextUpdateAsk, openPanels, openSettings, state, stopUpdateAsks, type GrantRequest } from "../host";
import { t } from "../i18n";
import { extensionList } from "../../shared/folder-keys";
import { folderLabel, foldersOf } from "../folder-label";
import ModalDialog from "./ModalDialog.vue";
import ModuleIcon from "./ModuleIcon.vue";
import ModuleNotes from "./settings/ModuleNotes.vue";

const props = defineProps<{ request: GrantRequest; inPanel?: boolean }>();
/** Names the question in a panel; two modules can ask at the same time. */
const titleId = computed(() => `grant-question-${props.request.moduleId}`);
/** Why the last answer to the question shown now wasn't saved; another question starts without one. */
const error = ref<string | null>(null);
watch(
  () => props.request,
  () => (error.value = null),
);
const busy = ref(false);

const module = computed(() => state.value?.modules.find((item) => item.id === props.request.moduleId) ?? null);
const update = computed(() => (props.request.update ? (module.value?.update ?? null) : null));
const asks = computed(() =>
  props.request.onRequest ? { network: [], connectors: props.request.onRequest.connectors, folders: [] } : props.request.update ? update.value?.asks : module.value?.permissions.missing,
);
const hosts = computed(() => asks.value?.network ?? []);
/** Websites, and programs on this PC (`localhost:<port>`, read only), shown apart. */
const sites = computed(() => hosts.value.filter((host) => !host.startsWith("localhost:")));
const programs = computed(() => hosts.value.filter((host) => host.startsWith("localhost:")).map((host) => host.slice("localhost:".length)));
const connectors = computed(() => asks.value?.connectors ?? []);
/** Folders on this PC to read (permissions.folders), with what the module may see in each. */
const folders = computed(() => foldersOf(asks.value?.folders ?? []));
const aiAccounts = computed(() => aiUsage.value?.accounts ?? []);
const discordUser = computed(() => discord.value?.user ?? null);

/**
 * Cancel goes back to the module library when the request came from there and it stays open. `request` is the question
 * answered: after an answer was saved, another may be shown, even this module's next one in this same dialog (it is
 * keyed by module). That one stays, unanswered.
 */
function close(request: GrantRequest = props.request) {
  if (!props.inPanel && dialog.value !== request) return;
  if (request.backToUpdates) return stopUpdateAsks();
  if (request.onRequest) void act({ type: "connector-answer", id: request.onRequest.id, allow: false }, { quiet: true });
  if (props.inPanel) {
    // Not allowed: the panels that were waiting for the answer close; nothing of the module is kept.
    if (!request.onRequest) for (const panel of state.value?.panels ?? []) if (panel.moduleId === request.moduleId && panel.question) void act({ type: "close-panel", instanceId: panel.instanceId });
    return;
  }
  dialog.value = request.backToLibrary ? { kind: "add-module" } : null;
}

// The module went away, or has nothing left to ask: nothing to answer.
watch(
  [module, hosts, connectors, folders],
  () => {
    if (!props.inPanel && !busy.value && (!module.value || hosts.value.length + connectors.value.length + folders.value.length === 0)) closeDialog(props.request);
  },
  { immediate: true },
);

const from = computed(() => {
  const current = module.value;
  if (!current) return "";
  if (current.publisher && current.publisherName) return t("grant.from.publisherName", { name: current.publisherName, key: current.publisher.slice(0, 8) });
  if (current.publisher) return t("grant.from.publisher", { key: current.publisher.slice(0, 8) });
  return current.provenance === "official" ? t("grant.from.official") : t("grant.from.local");
});

/** Each connector's question, so a prompt that asks for one thing leads with what it is for. */
const ASK = {
  "system-info": "grant.ask.systemInfo",
  media: "grant.ask.media",
  leaderboards: "grant.ask.leaderboards",
  "ai-usage": "grant.ask.aiUsage",
  discord: "grant.ask.discord",
  "stream-overlay": "grant.ask.overlay",
} as const;

const title = computed(() => {
  const current = module.value;
  if (!current) return "";
  if (update.value) return t("grant.updateTitle", { name: current.name, version: update.value.version });
  if (props.request.review) return t("grant.reviewTitle", { name: current.name });
  if (!connectors.value.length && !hosts.value.length && folders.value.length) return t("grant.ask.folder", { name: current.name });
  const only = connectors.value.length === 1 && !hosts.value.length && !folders.value.length ? (ASK as Record<string, (typeof ASK)[keyof typeof ASK]>)[connectors.value[0]!] : undefined;
  if (only) return t(only, { name: current.name });
  if (folders.value.length) return t("grant.title", { name: current.name });
  if (!connectors.value.length && programs.value.length === 1 && !sites.value.length) return t("grant.ask.program", { name: current.name, port: programs.value[0]! });
  if (!connectors.value.length && !programs.value.length && hosts.value.length === 1) return t("grant.ask.site", { name: current.name, host: hosts.value[0]! });
  if (!connectors.value.length && !programs.value.length && hosts.value.length > 1) return t("grant.ask.sites", { name: current.name, count: hosts.value.length });
  return t("grant.title", { name: current.name });
});

/** The accounts are chosen in Settings; the dialog closes so the page is not behind it. */
function editAccounts() {
  dialog.value = null;
  openSettings({ section: "connections", setting: "ai-usage-accounts" });
}

async function allow() {
  const current = module.value;
  if (!current) return;
  // The question this answer is for: once it is saved, the dialog may show another one (see close).
  const request = props.request;
  busy.value = true;
  if (request.onRequest) {
    // Only this connector; the module's panels go on running and get it at once.
    await act({ type: "connector-answer", id: request.onRequest.id, allow: true }, { quiet: true });
    busy.value = false;
    if (!props.inPanel) closeDialog(request);
    return;
  }
  if (request.update) {
    // Exactly the version this dialog shows; the main process checks the zip again before it installs.
    const result = await act({ type: "apply-module-update", moduleId: current.id, version: update.value?.version ?? "" }, { quiet: true });
    busy.value = false;
    if (!result.ok) {
      if (props.request === request) error.value = result.error;
      return;
    }
    if (dialog.value !== request) return;
    if (request.backToUpdates) nextUpdateAsk();
    else closeDialog(request);
    return;
  }
  // Exactly what this dialog shows: the main process grants only what the module still asks for.
  const result = await act({ type: "grant-module", moduleId: current.id, network: [...hosts.value], connectors: [...connectors.value], folders: folders.value.map((folder) => folder.key) }, { quiet: true });
  busy.value = false;
  if (!result.ok) {
    if (props.request === request) error.value = result.error;
    return;
  }
  // In a panel, the host starts the panels that waited for this answer.
  if (props.inPanel) return;
  close(request);
  if (request.review) return;
  void openPanels(current.id, request.slot, request.panelTypes ?? []);
}
</script>

<template>
  <component
    :is="inPanel ? 'section' : ModalDialog"
    v-if="module"
    v-bind="inPanel ? { class: 'flex w-full max-w-[460px] flex-col gap-4', 'aria-labelledby': titleId, 'data-testid': 'grant-question' } : { title, icon: ShieldCheck, class: 'sm:max-w-[480px]', testid: 'grant-dialog' }"
    @close="close()"
  >
    <h2 v-if="inPanel" :id="titleId" class="text-lg font-semibold">{{ title }}</h2>
    <div class="flex items-center gap-3">
      <span class="module-tile size-10" aria-hidden="true">
        <ModuleIcon :module-id="module.id" size="size-[34px]" />
      </span>
      <span class="text-muted-foreground text-sm" data-testid="grant-from">{{ from }}</span>
    </div>
    <p v-if="update" class="text-sm" data-testid="grant-update-intro">{{ t("grant.updateIntro", { name: module.name, installed: module.version, version: update.version }) }}</p>
    <section v-if="connectors.includes('ai-usage')" class="flex flex-col gap-2" :aria-label="t('grant.aiUsage')" data-testid="grant-ai-usage">
      <h3 class="flex items-center gap-2 font-medium"><Gauge :stroke-width="1.5" class="size-4" /> {{ t("grant.aiUsage") }}</h3>
      <ul v-if="aiAccounts.length" class="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-sm" data-testid="grant-ai-accounts">
        <li v-for="account in aiAccounts" :key="account.id" class="truncate">
          {{ account.label }} <span class="text-muted-foreground">· {{ t(`aiUsage.provider.${account.provider}`) }}</span>
        </li>
      </ul>
      <p v-else class="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">{{ t("grant.aiUsageNone") }}</p>
      <p class="text-muted-foreground text-sm">
        {{ t("grant.aiUsageNote") }}
        <Button type="button" variant="link" class="text-foreground inline h-auto p-0 align-baseline font-[inherit] text-[inherit] whitespace-normal underline underline-offset-2" @click="editAccounts">{{ t("grant.aiUsageAccounts") }}</Button>
      </p>
    </section>
    <section v-if="connectors.includes('system-info')" class="flex flex-col gap-2" :aria-label="t('grant.systemInfo')" data-testid="grant-system-info">
      <h3 class="flex items-center gap-2 font-medium"><Cpu :stroke-width="1.5" class="size-4" /> {{ t("grant.systemInfo") }}</h3>
      <p class="text-muted-foreground text-sm">{{ t("grant.systemInfoNote") }}</p>
    </section>
    <section v-if="connectors.includes('media')" class="flex flex-col gap-2" :aria-label="t('grant.media')" data-testid="grant-media">
      <h3 class="flex items-center gap-2 font-medium"><Music :stroke-width="1.5" class="size-4" /> {{ t("grant.media") }}</h3>
      <p class="text-muted-foreground text-sm">{{ t("grant.mediaNote") }}</p>
    </section>
    <section v-if="connectors.includes('leaderboards')" class="flex flex-col gap-2" :aria-label="t('grant.leaderboards')" data-testid="grant-leaderboards">
      <h3 class="flex items-center gap-2 font-medium"><Trophy :stroke-width="1.5" class="size-4" /> {{ t("grant.leaderboards") }}</h3>
      <p class="text-muted-foreground text-sm">{{ t("grant.leaderboardsNote") }}</p>
    </section>
    <section v-if="connectors.includes('discord')" class="flex flex-col gap-2" :aria-label="t('grant.discord')" data-testid="grant-discord">
      <h3 class="flex items-center gap-2 font-medium"><Headphones :stroke-width="1.5" class="size-4" /> {{ t("grant.discord") }}</h3>
      <ul class="bg-muted flex list-disc flex-col gap-1 rounded-md py-2 pr-3 pl-7 text-sm" data-testid="grant-discord-can">
        <li>{{ t("grant.discordRead") }}</li>
        <li>{{ t("grant.discordJoin") }}</li>
        <li>{{ t("grant.discordVoice") }}</li>
      </ul>
      <p class="text-muted-foreground text-sm">
        {{ discordUser ? t("grant.discordAs", { name: discordUser.name }) : t("grant.discordSignIn") }}
        {{ t("grant.discordNote") }}
      </p>
    </section>
    <section v-if="connectors.includes('stream-overlay')" class="flex flex-col gap-2" :aria-label="t('grant.overlay')" data-testid="grant-overlay">
      <h3 class="flex items-center gap-2 font-medium"><Radio :stroke-width="1.5" class="size-4" /> {{ t("grant.overlay") }}</h3>
      <p class="text-muted-foreground text-sm">{{ t("grant.overlayNote") }}</p>
    </section>
    <section v-if="sites.length" class="flex flex-col gap-2" :aria-label="t('grant.network')">
      <h3 class="flex items-center gap-2 font-medium"><Globe :stroke-width="1.5" class="size-4" /> {{ t("grant.network") }}</h3>
      <ul class="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-sm" data-testid="grant-hosts">
        <li v-for="host in sites" :key="host" class="font-mono break-all">{{ host }}</li>
      </ul>
      <p class="text-muted-foreground text-sm">{{ t("grant.networkNote") }}</p>
    </section>
    <section v-if="programs.length" class="flex flex-col gap-2" :aria-label="t('grant.programs')">
      <h3 class="flex items-center gap-2 font-medium"><Monitor :stroke-width="1.5" class="size-4" /> {{ t("grant.programs") }}</h3>
      <ul class="bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-sm" data-testid="grant-programs">
        <li v-for="port in programs" :key="port">{{ t("grant.programPort", { port }) }}</li>
      </ul>
      <p class="text-muted-foreground text-sm">{{ t("grant.programsNote") }}</p>
    </section>
    <section v-if="folders.length" class="flex flex-col gap-2" :aria-label="t('grant.folders')">
      <h3 class="flex items-center gap-2 font-medium"><Folder :stroke-width="1.5" class="size-4" /> {{ t("grant.folders") }}</h3>
      <ul class="bg-muted flex flex-col gap-2 rounded-md px-3 py-2 text-sm" data-testid="grant-folders">
        <li v-for="folder in folders" :key="folder.key" class="flex flex-col gap-0.5">
          <span class="font-mono break-all">{{ folderLabel(folder) }}</span>
          <span v-if="folder.read.length" class="text-muted-foreground">{{ t("grant.folderRead", { types: extensionList(folder.read) }) }}</span>
          <span v-if="folder.nameOnly.length" class="text-muted-foreground">{{ t("grant.folderNames", { types: extensionList(folder.nameOnly) }) }}</span>
        </li>
      </ul>
      <p class="text-muted-foreground text-sm">{{ t("grant.foldersNote") }}</p>
    </section>
    <ModuleNotes v-if="update && update.notes.length" :module-id="module.id" :version="update.version" :unseen="false" :entries="update.notes" />
    <p class="text-muted-foreground text-sm">{{ t("grant.later") }}</p>
    <p v-if="error" class="text-destructive text-sm" role="alert">{{ error }}</p>
    <DialogFooter>
      <DialogButton type="button" close autofocus data-testid="grant-cancel" @click="close()">
        {{ request.review ? t("grant.notNow") : t("common.cancel") }}
      </DialogButton>
      <DialogButton type="button" :icon="Check" :loading="busy" data-testid="grant-allow" :disabled="busy" @click="allow">{{ update ? t("grant.updateAllow") : t("grant.allow") }}</DialogButton>
    </DialogFooter>
  </component>
</template>

<style>
/* A light theme gets a lighter scrim, so the cream dialog doesn't sit on near-black. The kit's overlay comes right before its content. */
html:not(.dark) [data-slot="dialog-overlay"]:has(+ [data-testid="grant-dialog"]) {
  background-color: rgb(0 0 0 / 0.35);
}
</style>
