<script setup lang="ts">
// System Monitor's settings, shown while the panel is open as a dialog (panel.openDialog) in three pages: what it
// shows, which drives, and the connection. Every change applies at once. What changes the whole PC (watching the
// connection, its address) is saved straight from the click or key press that asked for it, as Tavora wants.
import { Eye, HardDrive, Wifi } from "@lucide/vue";
import { errorMessage } from "@tavora/official-ui";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Checkbox } from "@tavora/official-ui/components/ui/checkbox";
import { Input } from "@tavora/official-ui/components/ui/input";
import { ModuleSettings, SettingsPage, SettingsRow, SettingsSection } from "@tavora/official-ui/components/ui/module-settings";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tavora/official-ui/components/ui/select";
import { Switch } from "@tavora/official-ui/components/ui/switch";
import { SYSTEM_MAX_DRIVES, SYSTEM_PING_TARGET, type SystemConnectionSettings } from "@tavora/sdk";
import { computed, ref, watch } from "vue";
import { size } from "./format";
import { language, t } from "./i18n";
import type { Monitor } from "./monitor";
import { BLOCKS, INTERVALS, SECTIONS, cleanTarget, isLastOn, pickGpu, watchedDrives } from "./settings";

const props = defineProps<{ monitor: Monitor }>();

type Page = "show" | "drives" | "connection";
const page = ref<Page>("show");
const groups = computed(() => [
  {
    items: [
      { id: "show", label: t("settings.show"), icon: Eye, testid: "settings-page-show" },
      { id: "drives", label: t("drives.title"), icon: HardDrive, testid: "settings-page-drives" },
      { id: "connection", label: t("section.connection"), icon: Wifi, testid: "settings-page-connection" },
    ],
  },
]);

/** When something was last saved, for the footer's "Saved". */
const savedAt = ref<number>();
const saved = () => (savedAt.value = Date.now());
function act(change: () => void): void {
  change();
  saved();
}

const panel = computed(() => props.monitor.panel.value);
const app = computed(() => props.monitor.app.value);
const info = computed(() => props.monitor.info.value);

// ── Show ─────────────────────────────────────────────────────────────

const INTERVAL_OPTIONS = INTERVALS.map((ms) => ({ value: String(ms), label: String(ms / 1000), testid: `interval-${ms / 1000}` }));
const gpus = computed(() => info.value?.gpus ?? []);
const gpu = computed(() => (info.value ? pickGpu(info.value, panel.value.gpu) : null));

// ── Drives ───────────────────────────────────────────────────────────

/** Drives picked before that are unplugged now stay in the list, also after they are unticked, until the settings close. */
const unplugged = props.monitor.info.value ? watchedDrives(props.monitor.info.value, props.monitor.app.value).filter((id) => !props.monitor.info.value!.drives.some((drive) => drive.id === id)) : [];
const drives = computed(() => [
  ...(info.value?.drives ?? []).map((drive) => ({ id: drive.id, label: drive.label, kind: drive.kind, total: drive.totalBytes, present: true })),
  ...unplugged.filter((id) => !info.value?.drives.some((drive) => drive.id === id)).map((id) => ({ id, label: "", kind: "other" as const, total: null, present: false })),
]);
const chosen = computed(() => new Set(info.value ? watchedDrives(info.value, app.value) : []));

function pickDrive(id: string, on: boolean): void {
  const next = new Set(chosen.value);
  if (on) next.add(id);
  else next.delete(id);
  // In the order the drives are listed, so the panel shows them the same way.
  act(() => props.monitor.setDrives(drives.value.map((drive) => drive.id).filter((drive) => next.has(drive))));
}

const driveName = (drive: (typeof drives.value)[number]) => (drive.label ? `${drive.id} ${drive.label}` : drive.id);
const driveDetail = (drive: (typeof drives.value)[number]) =>
  [t(drive.kind === "other" ? "drives.unknown" : `drives.${drive.kind}`), drive.total ? size(drive.total, language.value) : "", drive.present ? "" : t("drives.notConnected")].filter(Boolean).join(" · ");

// ── Connection ───────────────────────────────────────────────────────

const connection = computed(() => props.monitor.connectionSettings.value);
const address = ref(connection.value?.target ?? "");
const error = ref("");
watch(
  () => connection.value?.target,
  (target) => {
    if (target !== undefined) address.value = target;
  },
);

// Each save runs straight from the click or key press, with nothing awaited before it: Tavora counts that as the user's.
async function saveConnection(change: Partial<SystemConnectionSettings>): Promise<void> {
  error.value = "";
  try {
    await props.monitor.setConnection(change);
    saved();
  } catch (reason) {
    error.value = t("target.error", { error: errorMessage(reason) });
  }
}

/** Saves the address when it is valid and new (on Enter or when the field is left). */
function commitAddress(): void {
  const current = connection.value;
  if (!current) return;
  const target = cleanTarget(address.value);
  if (!target) {
    error.value = t("target.invalid");
    return;
  }
  address.value = target;
  if (target === current.target) error.value = "";
  else void saveConnection({ target });
}

function resetAddress(): void {
  address.value = SYSTEM_PING_TARGET;
  commitAddress();
}
</script>

<template>
  <ModuleSettings v-model:page="page" :groups="groups" :label="t('settings.title')" :saved-at="savedAt" data-testid="system-monitor-settings">
    <SettingsPage v-if="page === 'show'" :title="t('settings.show')" :description="t('settings.showText')">
      <SettingsSection :title="t('settings.sections')">
        <SettingsRow v-for="id in SECTIONS" :key="id" :label="t(`section.${id}`)">
          <Switch
            :model-value="panel.sections[id]"
            :disabled="isLastOn(panel.sections, id)"
            :disabled-reason="t('settings.lastOne')"
            :aria-label="t(`section.${id}`)"
            :data-testid="`settings-section-${id}`"
            @update:model-value="act(() => monitor.toggleSection(id))"
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection v-if="panel.sections.system" :title="t('settings.values')">
        <SettingsRow v-for="id in BLOCKS" :key="id" :label="t(`${id}.title`)">
          <Switch
            :model-value="panel.blocks[id]"
            :disabled="isLastOn(panel.blocks, id)"
            :disabled-reason="t('settings.lastOne')"
            :aria-label="t(`${id}.title`)"
            :data-testid="`settings-block-${id}`"
            @update:model-value="act(() => monitor.toggleBlock(id))"
          />
        </SettingsRow>
        <SettingsRow v-if="gpus.length > 1" :label="t('settings.gpu')">
          <Select :model-value="gpu ?? undefined" @update:model-value="(id) => act(() => monitor.setGpu(String(id)))">
            <SelectTrigger class="w-full" :aria-label="t('settings.gpu')" data-testid="settings-gpu"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="card in gpus" :key="card.id" :value="card.id">{{ card.name }}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection>
        <SettingsRow :label="t('settings.interval')" :hint="t('settings.intervalHint')">
          <SegmentedControl
            :model-value="String(app.intervalMs)"
            :label="t('settings.interval')"
            :options="INTERVAL_OPTIONS"
            @update:model-value="(value) => act(() => monitor.setInterval(Number(value) as (typeof INTERVALS)[number]))"
          />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>

    <SettingsPage v-else-if="page === 'drives'" :title="t('drives.title')" :description="t('drives.dialogText')">
      <SettingsSection>
        <SettingsRow v-for="drive in drives" :key="drive.id" :label="driveName(drive)" :hint="driveDetail(drive)">
          <Checkbox
            :model-value="chosen.has(drive.id)"
            :disabled="!chosen.has(drive.id) && chosen.size >= SYSTEM_MAX_DRIVES"
            :disabled-reason="t('settings.driveLimit', { count: SYSTEM_MAX_DRIVES })"
            :aria-label="driveName(drive)"
            :data-testid="`pick-${drive.id}`"
            @update:model-value="(value: boolean | 'indeterminate') => pickDrive(drive.id, value === true)"
          />
        </SettingsRow>
        <p v-if="chosen.size >= SYSTEM_MAX_DRIVES" class="text-muted-foreground pt-3 text-xs" role="status" data-testid="settings-drive-limit">{{ t("settings.driveLimit", { count: SYSTEM_MAX_DRIVES }) }}</p>
        <p v-if="!drives.length" class="text-muted-foreground py-3 text-sm" data-testid="settings-no-drives">{{ t("settings.noDrives") }}</p>
      </SettingsSection>
    </SettingsPage>

    <SettingsPage v-else :title="t('section.connection')" :description="t('target.text')">
      <SettingsSection v-if="connection">
        <SettingsRow :label="t('target.watch')">
          <Switch :model-value="connection.enabled" :aria-label="t('target.watch')" data-testid="settings-watch" @update:model-value="(on) => void saveConnection({ enabled: on })" />
        </SettingsRow>
        <SettingsRow :label="t('target.label')" stacked>
          <Input
            v-model="address"
            :placeholder="SYSTEM_PING_TARGET"
            :aria-label="t('target.label')"
            :aria-invalid="error ? true : undefined"
            data-testid="settings-address"
            @update:model-value="error = ''"
            @change="commitAddress"
          />
          <Button v-if="address !== SYSTEM_PING_TARGET" variant="secondary" size="sm" class="flex-none" data-testid="settings-address-reset" @click="resetAddress">{{ t("target.reset") }}</Button>
        </SettingsRow>
        <Notice v-if="error" variant="error" class="mt-3" data-testid="settings-error">{{ error }}</Notice>
      </SettingsSection>
      <Notice v-else variant="info" class="mt-6" data-testid="settings-connection-old">{{ t("target.old") }}</Notice>

      <SettingsSection>
        <SettingsRow :label="t('traffic.title')" :hint="t('traffic.hint')">
          <Switch :model-value="panel.traffic" :aria-label="t('traffic.title')" data-testid="settings-traffic" @update:model-value="act(() => monitor.toggleTraffic())" />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  </ModuleSettings>
</template>
