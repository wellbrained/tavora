<script setup lang="ts">
// Settings > Your modules: the modules the developer makes, each once (dev-modules.ts), with where it stands in the
// catalog, Publish when something waits, and, opened, its folders and how users can reach the developer about it.
// A filter shows only what waits for Publish. The other developer pages are Project folders, Publishing and
// Examples and help. Players never see the developer tools until they ask for them: this page is Make modules
// then, and Let's go shows them, kept in the library (so in backups and the cloud copy). Once we know publishing
// isn't set up, a card offers the developer onboarding; on a new PC of a developer, a line points to the recovery key
// on Publishing instead.
import { CircleAlert, KeyRound, Loader, RefreshCw, Rocket, Upload } from "@lucide/vue";
import { computed, onMounted, reactive, ref, watch } from "vue";
import { Badge } from "@tavora/official-ui/components/ui/badge";
import { Button } from "@tavora/official-ui/components/ui/button";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import type { SettingsSection } from "./settings-index";
import { account, act, developerKeys, developerState, dialog, inbox, makesModules, releaseStatus, showToast, state } from "../../host";
import { t } from "../../i18n";
import DevModuleRow from "../developer/DevModuleRow.vue";
import { devModules, waitsForPublish } from "../developer/dev-modules";
import ModuleIcon from "../ModuleIcon.vue";
import SettingGroup from "./SettingGroup.vue";

const props = defineProps<{ highlight: string | null }>();
const emit = defineEmits<{ show: [section: SettingsSection] }>();

function startMaking() {
  void act({ type: "set-makes-modules", on: true });
}

// Before it was a library setting, Let's go was kept in this window's local storage: carried over once.
const OLD_MAKES_MODULES = "tavora.makesModules";
const carriedOver = ref(false);
try {
  if (localStorage.getItem(OLD_MAKES_MODULES) === "1") {
    carriedOver.value = true;
    void act({ type: "set-makes-modules", on: true }, { quiet: true }).then((result) => {
      if (result.ok) localStorage.removeItem(OLD_MAKES_MODULES);
    });
  }
} catch {
  // No local storage: nothing to carry over.
}

/** Publishing needs the account; in builds without accounts there is none of it. */
const accounts = computed(() => account.value?.enabled === true);
const signedIn = computed(() => accounts.value && Boolean(account.value?.account));
/** The account's recovery key is on screen (made with a key here) or needed on this PC. */
const recoveryKey = computed(() => Boolean(developerKeys.value?.recoveryKey) || developerKeys.value?.status === "ask");
/** A developer on a new PC needs only the recovery key here, so the card asking "Want to make modules?" stays away. */
const startCard = computed(() => accounts.value && developerState.value === "missing" && !(account.value?.developer && recoveryKey.value));
const showTools = computed(() => makesModules.value || carriedOver.value || props.highlight === "module-contact");

const folders = computed(() => state.value!.developmentFolders);
const entries = computed(() => devModules(folders.value, state.value!.modules, releaseStatus.value));
const pending = computed(() => entries.value.filter(waitsForPublish));
/** Projects that loaded nothing; they are explained on Project folders. */
const problems = computed(() => folders.value.some((folder) => folder.problem || folder.projects.some((project) => !project.moduleId)));

// All, or only what waits for Publish; back to All once nothing waits.
const filter = ref<"all" | "pending">("all");
watch(pending, (list) => {
  if (!list.length) filter.value = "all";
});
const shown = computed(() => (filter.value === "pending" ? pending.value : entries.value));
const filterOptions = computed(() => [
  { value: "all" as const, label: t("devModules.all", { count: entries.value.length }), testid: "dev-modules-all" },
  { value: "pending" as const, label: t("devModules.pending", { count: pending.value.length }), testid: "dev-modules-pending" },
]);

/** The opened rows; a search for the contact setting opens the first published module. */
const opened = reactive(new Set<string>());
const contacts = computed(() => new Map((inbox.value.contacts ?? []).map((contact) => [contact.id, contact])));
watch(
  [() => props.highlight, contacts],
  ([highlight]) => {
    const first = highlight === "module-contact" ? entries.value.find((entry) => contacts.value.has(entry.publishes.module.id)) : undefined;
    if (first) opened.add(first.key);
  },
  { immediate: true },
);
// Built-in modules with a newer version on main than in the last release (main/official-publish.ts), checked when
// the page opens; Publish opens OfficialPublishDialog, which shows the steps and the preview.
const official = computed(() => state.value!.officialPublish);
const officialRows = computed(() => official.value.overview?.rows ?? []);
const STATUS_BADGE = { ready: "success", published: "outline", catalogueNewer: "outline", waitForRelease: "warning", ciPending: "info", ciFailed: "destructive" } as const;
const hostChanges = computed(() => {
  const overview = official.value.overview;
  if (!overview?.hostChanges.length) return "";
  const shown = overview.hostChanges.slice(0, 3).map((file) => file.replace(/^apps\/desktop\/src\//, ""));
  const more = overview.hostChanges.length - shown.length;
  const files = more > 0 ? t("officialPublish.hostChangesMore", { files: shown.join(", "), count: more }) : shown.join(", ");
  return t("officialPublish.hostChanges", { release: overview.release, files });
});

function checkOfficial() {
  void act({ type: "official-publish-check" }, { quiet: true });
}

function publishOfficial(moduleId: string) {
  void act({ type: "publish-official-module", moduleId });
}

async function forgetKey() {
  const result = await act({ type: "official-publish-forget-key" });
  if (result.ok) showToast(t("officialPublish.forgotten"));
}

onMounted(() => {
  if (official.value.available && showTools.value) checkOfficial();
  // The developer side and the contact settings as the service has them now; quietly, offline is fine.
  if (signedIn.value) {
    void act({ type: "account-refresh" }, { quiet: true });
    void act({ type: "inbox-refresh" }, { quiet: true });
  }
});
</script>

<template>
  <SettingGroup v-if="!showTools">
    <div class="flex flex-wrap items-center gap-x-6 gap-y-3 py-4" data-testid="development-intro">
      <Rocket class="text-primary size-6 flex-none" :stroke-width="1.5" aria-hidden="true" />
      <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span class="font-medium">{{ t("devStart.card.title") }}</span>
        <span class="text-muted-foreground text-sm">{{ t("settings.development-intro") }}</span>
      </div>
      <Button class="flex-none" data-testid="development-start" @click="startMaking">{{ t("devStart.card.start") }}</Button>
    </div>
  </SettingGroup>

  <template v-else>
    <p v-if="signedIn && recoveryKey" class="mb-6 flex flex-wrap items-center gap-x-2 text-sm" data-testid="dev-modules-recovery">
      <KeyRound class="text-warning size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
      {{ t("devModules.recovery") }}
      <Button variant="link" class="h-auto p-0" @click="emit('show', 'dev-publishing')">{{ t("settings.section.dev-publishing") }}</Button>
    </p>

    <SettingGroup v-if="startCard">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-3 py-4" data-testid="developer-start-card">
        <Rocket class="text-primary size-6 flex-none" :stroke-width="1.5" aria-hidden="true" />
        <div class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <span class="font-medium">{{ t("devStart.card.title") }}</span>
          <span class="text-muted-foreground text-sm">{{ t("devStart.card.text") }}</span>
        </div>
        <Button class="flex-none" data-testid="developer-start-open" @click="dialog = { kind: 'developer-start' }">{{ t("devStart.card.start") }}</Button>
      </div>
    </SettingGroup>

    <SettingGroup :description="entries.length ? t('devModules.description') : undefined">
      <template v-if="pending.length && entries.length > 1" #actions>
        <SegmentedControl v-model="filter" :options="filterOptions" :label="t('devModules.filter')" />
      </template>
      <div v-if="!entries.length" class="flex flex-wrap items-center gap-x-6 gap-y-3 py-4" data-testid="dev-modules-none">
        <span class="text-muted-foreground min-w-0 flex-1 basis-56 text-sm">{{ t("devModules.none") }}</span>
        <span class="flex flex-none flex-wrap gap-2">
          <Button variant="secondary" data-testid="dev-modules-to-folders" @click="emit('show', 'dev-folders')">{{ t("settings.section.dev-folders") }}</Button>
          <Button variant="ghost" data-testid="dev-modules-to-examples" @click="emit('show', 'dev-help')">{{ t("settings.development-examples.label") }}</Button>
        </span>
      </div>
      <ul v-else class="flex flex-col" :aria-label="t('settings.section.development')" data-testid="dev-modules" data-setting="module-contact">
        <DevModuleRow
          v-for="entry in shown"
          :key="entry.key"
          :entry="entry"
          :contact="contacts.get(entry.publishes.module.id) ?? null"
          :accounts="accounts"
          :signed-in="signedIn"
          :open="opened.has(entry.key)"
          @update:open="(open: boolean) => (open ? opened.add(entry.key) : opened.delete(entry.key))"
        />
      </ul>
    </SettingGroup>

    <p v-if="problems" class="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-2 text-sm" data-testid="dev-modules-problems">
      <CircleAlert class="text-warning size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
      {{ t("devModules.problems") }}
      <Button variant="link" class="h-auto p-0" @click="emit('show', 'dev-folders')">{{ t("settings.section.dev-folders") }}</Button>
    </p>

    <SettingGroup v-if="official.available" :title="t('officialPublish.title')" :description="t('officialPublish.description')">
      <template #actions>
        <Button variant="ghost" size="sm" :disabled="official.checking" data-testid="official-publish-refresh" @click="checkOfficial">
          <Loader v-if="official.checking" class="animate-spin motion-reduce:animate-none" :stroke-width="1.5" aria-hidden="true" />
          <RefreshCw v-else :stroke-width="1.5" aria-hidden="true" />
          {{ official.checking ? t("officialPublish.checking") : t("officialPublish.refresh") }}
        </Button>
      </template>
      <p v-if="official.checkError" class="text-destructive py-4 text-sm" role="alert" data-testid="official-publish-error">{{ official.checkError }}</p>
      <p v-else-if="official.overview && !officialRows.length" class="text-muted-foreground py-4 text-sm" data-testid="official-publish-none">{{ t("officialPublish.none") }}</p>
      <ul v-if="officialRows.length" class="flex flex-col" :aria-label="t('officialPublish.title')" data-testid="official-publish">
        <li v-for="row in officialRows" :key="row.id" class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b py-4 last:border-b-0" :data-testid="`official-row-${row.id}`" :data-status="row.status">
          <span class="module-tile size-10" aria-hidden="true"><ModuleIcon :module-id="row.id" size="size-[34px]" /></span>
          <div class="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
            <span class="flex min-w-0 items-center gap-2">
              <span class="truncate font-medium">{{ row.name }}</span>
              <span class="text-muted-foreground flex-none text-xs tabular-nums">{{ t("officialPublish.versions", { shipped: row.shipped, version: row.version }) }}</span>
            </span>
            <span><Badge :variant="STATUS_BADGE[row.status]" class="py-0">{{ t(`officialPublish.status.${row.status}`, { listed: row.listed ?? "" }) }}</Badge></span>
          </div>
          <Button
            v-if="row.status === 'ready'"
            variant="secondary"
            :disabled="official.run !== null || official.checking"
            :data-testid="`publish-official-${row.id}`"
            @click="publishOfficial(row.id)"
          >
            <Upload :stroke-width="1.5" /> {{ t("officialPublish.button") }}
          </Button>
        </li>
      </ul>
      <p v-if="hostChanges" class="text-muted-foreground pb-4 text-xs break-words" data-testid="official-publish-host-changes">{{ hostChanges }}</p>
      <div v-if="official.key.saved" class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t py-4" data-testid="official-publish-key">
        <KeyRound class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
        <span class="min-w-0 flex-1 text-sm">{{ t("officialPublish.keySaved") }}</span>
        <Button variant="ghost" size="sm" :disabled="official.run !== null" data-testid="official-publish-forget-key" @click="forgetKey">{{ t("officialPublish.forgetKey") }}</Button>
      </div>
    </SettingGroup>
  </template>
</template>
