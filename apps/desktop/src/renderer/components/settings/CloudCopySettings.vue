<script setup lang="ts">
// Settings > Account > Cloud copy: turning it on (a new recovery key, or the
// account's key another PC made), its state, and the buttons to upload, restore,
// turn it off or delete it. When it syncs is up to the main process.
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HostAction } from "../../../shared/host-api";
import { act, cloudCopy, confirmAction, copyLater, showToast, submitAction } from "../../host";
import { formatDate, t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import SettingRow from "./SettingRow.vue";

const view = computed(() => cloudCopy.value);
const busy = ref(false);
const keyText = ref("");
watch(
  () => view.value?.askKey,
  () => (keyText.value = ""),
);

const megabytes = (bytes: number) => Math.max(0, Math.ceil(bytes / (1024 * 1024)));

async function run(action: HostAction): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    return (await act(action)).ok;
  } finally {
    busy.value = false;
  }
}

/** What it is doing, or how it stands: shown under "Cloud copy is on". */
const status = computed(() => {
  const copy = view.value;
  if (!copy) return "";
  if (copy.busy === "uploading") {
    const progress = copy.progress;
    return progress && progress.total > 0 ? t("cloudCopy.status.uploadingSize", { done: megabytes(progress.done), total: megabytes(progress.total) }) : t("cloudCopy.status.uploading");
  }
  if (copy.busy === "downloading") return t("cloudCopy.status.downloading");
  if (copy.busy === "checking") return t("cloudCopy.status.checking");
  if (copy.conflict || copy.restartToTake) return t("cloudCopy.status.waiting");
  if (copy.problem) return t(`cloudCopy.error.${copy.problem}`);
  const saved = copy.copy
    ? t("cloudCopy.status.saved", { date: formatDate(copy.copy.savedAt, { dateStyle: "medium", timeStyle: "short" }), size: megabytes(copy.copy.size), limit: megabytes(copy.limit) })
    : t("cloudCopy.status.none");
  return copy.pictures ? saved : `${saved} ${t("cloudCopy.status.noPictures")}`;
});

async function upload() {
  if (await run({ type: "cloud-copy-upload" })) showToast(t("cloudCopy.uploaded"));
}

async function copyKey() {
  if (await run({ type: "cloud-copy-copy-key" })) showToast(t("cloudCopy.key.copied"));
}

/** Brings the put-off question back. */
function decide() {
  copyLater.value = null;
}

function restore() {
  confirmAction({
    title: t("cloudCopy.restore.title"),
    message: t("cloudCopy.restore.message"),
    confirm: t("cloudCopy.restore.confirm"),
    run: () => submitAction({ type: "cloud-copy-restore" }),
  });
}

function turnOff() {
  confirmAction({
    title: t("cloudCopy.turnOff.title"),
    message: t("cloudCopy.turnOff.message"),
    confirm: t("cloudCopy.turnOff.label"),
    run: () => submitAction({ type: "cloud-copy-off" }),
  });
}

function remove() {
  confirmAction({
    title: t("cloudCopy.delete.title"),
    message: t("cloudCopy.delete.message"),
    confirm: t("cloudCopy.delete.confirm"),
    danger: true,
    run: async () => {
      const error = await submitAction({ type: "cloud-copy-delete" });
      if (!error) showToast(t("cloudCopy.deleted"));
      return error;
    },
  });
}
/** A lost recovery key: the copy is deleted and the account gets a new key, shown right away. */
function startOver() {
  confirmAction({
    title: t("cloudCopy.newKey.title"),
    message: t("cloudCopy.newKey.message"),
    confirm: t("cloudCopy.newKey.button"),
    danger: true,
    run: () => submitAction({ type: "cloud-copy-new-key" }),
  });
}
</script>

<template>
  <SettingGroup v-if="view" :title="t('cloudCopy.title')" :description="t('cloudCopy.hint')" data-testid="cloud-copy">
    <!-- The recovery key, right after turning on or when asked for. -->
    <div v-if="view.recoveryKey" class="flex flex-col gap-3 border-b py-4" data-testid="cloud-copy-key">
      <span class="font-medium">{{ t("cloudCopy.key.title") }}</span>
      <span class="text-muted-foreground text-sm">{{ t("cloudCopy.key.text") }}</span>
      <code class="bg-muted rounded px-3 py-2 font-mono text-sm tracking-wide break-all select-all" data-testid="cloud-copy-key-text">{{ view.recoveryKey }}</code>
      <div class="flex gap-2">
        <Button variant="secondary" :disabled="busy" @click="copyKey">{{ t("cloudCopy.key.copy") }}</Button>
        <Button :disabled="busy" data-testid="cloud-copy-key-saved" @click="run({ type: 'cloud-copy-key-saved' })">{{ t("cloudCopy.key.saved") }}</Button>
      </div>
    </div>

    <!-- Another PC made the account's key: its recovery key is asked for. -->
    <form v-if="view.askKey" class="flex flex-col gap-3 py-4" @submit.prevent="keyText.trim() && run({ type: 'cloud-copy-key', key: keyText })">
      <span class="text-muted-foreground">{{ t("cloudCopy.askKey.text") }}</span>
      <div class="flex gap-2">
        <Input v-model="keyText" class="max-w-120 font-mono" maxlength="200" autocomplete="off" spellcheck="false" :aria-label="t('cloudCopy.askKey.label')" data-testid="cloud-copy-key-input" />
        <Button type="submit" :disabled="busy || !keyText.trim()" data-testid="cloud-copy-key-submit">{{ t("cloudCopy.askKey.continue") }}</Button>
        <Button type="button" variant="ghost" :disabled="busy" @click="run({ type: 'cloud-copy-cancel' })">{{ t("common.cancel") }}</Button>
      </div>
      <p v-if="view.busy" class="text-muted-foreground text-sm" role="status">{{ status }}</p>
      <div class="flex items-center gap-3">
        <span class="text-muted-foreground text-sm">{{ t("cloudCopy.askKey.lost") }}</span>
        <Button type="button" variant="danger" size="sm" :disabled="busy" data-testid="cloud-copy-new-key" @click="startOver">{{ t("cloudCopy.newKey.button") }}</Button>
      </div>
    </form>

    <template v-else-if="!view.on">
      <SettingRow :label="t('cloudCopy.off.label')" :description="view.canKeepKey ? (view.problem ? t(`cloudCopy.error.${view.problem}`) : t('cloudCopy.off.description')) : t('cloudCopy.cantKeep')">
        <Button :disabled="busy || !view.canKeepKey || view.busy !== null" data-testid="cloud-copy-on" @click="run({ type: 'cloud-copy-on' })">{{ t("cloudCopy.turnOn") }}</Button>
      </SettingRow>
    </template>

    <template v-else>
      <SettingRow :label="t('cloudCopy.on.label')" :description="status" data-testid="cloud-copy-status">
        <Button v-if="view.conflict" :disabled="busy" @click="decide">{{ t("cloudCopy.conflict.title") }}</Button>
        <Button v-else-if="view.restartToTake" :disabled="busy" @click="run({ type: 'cloud-copy-restart' })">{{ t("cloudCopy.newer.restart") }}</Button>
        <Button v-else variant="secondary" :disabled="busy || view.busy !== null" data-testid="cloud-copy-upload" @click="upload">{{ t("cloudCopy.upload") }}</Button>
      </SettingRow>
      <SettingRow :label="t('cloudCopy.restore.label')" :description="t('cloudCopy.restore.description')">
        <Button variant="secondary" :disabled="busy || view.busy !== null" data-testid="cloud-copy-restore" @click="restore">{{ t("cloudCopy.restore.button") }}</Button>
      </SettingRow>
      <SettingRow v-if="!view.recoveryKey" :label="t('cloudCopy.showKey.label')" :description="t('cloudCopy.showKey.description')">
        <Button variant="ghost" :disabled="busy" data-testid="cloud-copy-show-key" @click="run({ type: 'cloud-copy-show-key' })">{{ t("cloudCopy.showKey.button") }}</Button>
      </SettingRow>
      <SettingRow :label="t('cloudCopy.turnOff.label')" :description="t('cloudCopy.turnOff.description')">
        <Button variant="secondary" :disabled="busy" data-testid="cloud-copy-off" @click="turnOff">{{ t("cloudCopy.turnOff.label") }}</Button>
      </SettingRow>
      <SettingRow :label="t('cloudCopy.delete.label')" :description="t('cloudCopy.delete.description')">
        <Button variant="destructive" :disabled="busy" data-testid="cloud-copy-delete" @click="remove">{{ t("cloudCopy.delete.label") }}</Button>
      </SettingRow>
    </template>
  </SettingGroup>
</template>
