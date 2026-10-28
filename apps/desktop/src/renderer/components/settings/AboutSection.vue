<script setup lang="ts">
// Settings > About: this version and its patch notes, updates, backups and the diagnostic info.
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { act, state, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

defineProps<{ highlight: string | null }>();
const emit = defineEmits<{ patchNotes: [] }>();

const library = computed(() => state.value!.library);
const version = computed(() => state.value!.appVersion);
const formatDateTime = (iso: string) => formatDate(iso, { dateStyle: "medium", timeStyle: "short" });

const autoUpdate = computed({
  get: () => library.value.autoUpdate,
  set: (enabled: boolean) => void act({ type: "set-auto-update", enabled }),
});

/** What the Updates row says, and what its button does. */
const updateRow = computed(() => {
  const u = state.value!.update;
  if (u.status === "checking") return { text: t("settings.updates.checking"), button: t("settings.updates.checkingButton"), busy: true, run: null };
  if (u.status === "downloading") return { text: t("settings.updates.downloading", { version: u.version }), button: t("settings.updates.downloadingButton"), busy: true, run: null };
  if (u.status === "ready") return { text: t("settings.updates.ready", { version: u.version }), button: t("common.restartNow"), busy: false, run: "restart-to-update" as const };
  if (u.status === "available") return { text: t("settings.updates.available", { version: u.version }), button: t("settings.updates.download"), busy: false, run: "download-update" as const };
  const text = u.failed ? t("settings.updates.failed") : u.checkedAt ? t("settings.updates.upToDate", { date: formatDateTime(u.checkedAt) }) : t("settings.updates.idle");
  return { text, button: t("settings.updates.checkNow"), busy: false, run: "check-for-updates" as const };
});

function pressUpdateButton() {
  const run = updateRow.value.run;
  if (run) void act({ type: run });
}

const copied = ref(false);
async function copyDiagnostics() {
  const result = await act({ type: "copy-diagnostics" });
  if (!result.ok) return;
  copied.value = true;
  setTimeout(() => (copied.value = false), 2500);
}
</script>

<template>
  <SettingGroup>
    <SettingRow
      :label="t('settings.about.version', { version })"
      :description="t('settings.about.versionHint')"
      setting="app-version"
      :highlighted="highlight === 'app-version'"
    >
      <Button variant="secondary" data-testid="open-patch-notes" @click="emit('patchNotes')">{{ t("settings.section.patch-notes") }}</Button>
    </SettingRow>
    <SettingRow :label="t('settings.check-updates.label')" :description="updateRow.text" setting="check-updates" :highlighted="highlight === 'check-updates'">
      <Button variant="secondary" :disabled="updateRow.busy" data-testid="check-updates" @click="pressUpdateButton">{{ updateRow.button }}</Button>
    </SettingRow>
    <SettingRow :label="t('settings.auto-update.label')" :description="t('settings.auto-update.description')" setting="auto-update" :highlighted="highlight === 'auto-update'">
      <Switch v-model="autoUpdate" :aria-label="t('settings.auto-update.label')" data-testid="auto-update" />
    </SettingRow>
  </SettingGroup>
  <SettingGroup :title="t('settings.heading.yourData')">
    <SettingRow :label="t('settings.backups.label')" :description="t('settings.backups.description')" setting="backups" :highlighted="highlight === 'backups'">
      <Button variant="secondary" data-testid="open-backups" @click="submitAction({ type: 'open-backups' })">{{ t("common.openFolder") }}</Button>
    </SettingRow>
  </SettingGroup>
  <SettingGroup :title="t('settings.heading.help')">
    <SettingRow :label="t('settings.diagnostics.label')" :description="t('settings.diagnostics.description')" setting="diagnostics" :highlighted="highlight === 'diagnostics'">
      <Button variant="secondary" data-testid="copy-diagnostics" @click="copyDiagnostics">{{ copied ? t("settings.diagnostics.copied") : t("settings.diagnostics.copy") }}</Button>
    </SettingRow>
  </SettingGroup>
</template>
