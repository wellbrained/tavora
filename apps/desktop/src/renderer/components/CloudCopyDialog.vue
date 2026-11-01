<script setup lang="ts">
// The questions the cloud copy asks over the app: which side to keep when both
// changed, a restart for newer data from another PC, and the wait at close.
import { computed, ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Cloud, HardDrive, RotateCw } from "@lucide/vue";
import { act, cloudCopy, copyLater, copyQuestion } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const busy = ref(false);
const megabytes = (bytes: number) => Math.max(0, Math.ceil(bytes / (1024 * 1024)));

const title = computed(() => t(copyQuestion.value === "closing" ? "cloudCopy.closing.title" : copyQuestion.value === "conflict" ? "cloudCopy.conflict.title" : "cloudCopy.newer.title"));
const text = computed(() => {
  if (copyQuestion.value === "conflict") return t("cloudCopy.conflict.text");
  if (copyQuestion.value === "newer") return t("cloudCopy.newer.text");
  const progress = cloudCopy.value?.progress;
  return progress && progress.total > 0 ? t("cloudCopy.status.uploadingSize", { done: megabytes(progress.done), total: megabytes(progress.total) }) : t("cloudCopy.closing.text");
});

async function run(action: Parameters<typeof act>[0]) {
  if (busy.value) return;
  busy.value = true;
  try {
    await act(action);
  } finally {
    busy.value = false;
  }
}

/** Put off for now: the question comes back at the next start, and Settings still offers it. */
function later() {
  if (copyQuestion.value === "conflict") copyLater.value = "conflict";
  else if (copyQuestion.value === "newer") copyLater.value = "newer";
}
</script>

<template>
  <ModalDialog v-if="copyQuestion" :title="title" :description="text" :icon="Cloud" testid="cloud-copy-question" @close="copyQuestion !== 'closing' && later()">
    <template v-if="copyQuestion === 'conflict'">
      <p class="text-muted-foreground text-sm">{{ t("cloudCopy.conflict.cloudHint") }}</p>
      <DialogFooter>
        <DialogButton close variant="ghost" :disabled="busy" @click="later">{{ t("cloudCopy.later") }}</DialogButton>
        <DialogButton variant="secondary" :icon="HardDrive" :disabled="busy" data-testid="cloud-copy-keep-pc" @click="run({ type: 'cloud-copy-keep', side: 'pc' })">{{ t("cloudCopy.conflict.keepPc") }}</DialogButton>
        <DialogButton :icon="Cloud" :disabled="busy" data-testid="cloud-copy-keep-cloud" @click="run({ type: 'cloud-copy-keep', side: 'cloud' })">{{ t("cloudCopy.conflict.useCloud") }}</DialogButton>
      </DialogFooter>
    </template>
    <DialogFooter v-else-if="copyQuestion === 'newer'">
      <DialogButton close variant="ghost" @click="later">{{ t("cloudCopy.later") }}</DialogButton>
      <DialogButton :icon="RotateCw" data-testid="cloud-copy-restart" @click="run({ type: 'cloud-copy-restart' })">{{ t("cloudCopy.newer.restart") }}</DialogButton>
    </DialogFooter>
    <DialogFooter v-else>
      <DialogButton variant="secondary" data-testid="cloud-copy-close-anyway" @click="run({ type: 'cloud-copy-close-anyway' })">{{ t("cloudCopy.closing.anyway") }}</DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
