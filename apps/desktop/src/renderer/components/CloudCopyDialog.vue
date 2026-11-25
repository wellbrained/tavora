<script setup lang="ts">
// The questions the cloud copy asks over the app: which side to keep when both
// changed, a restart for newer data from another PC, and the wait at close.
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { account, act, cloudCopy, copyLater, copyQuestion } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const busy = ref(false);
const megabytes = (bytes: number) => Math.max(0, Math.ceil(bytes / (1024 * 1024)));

const kind = computed(() => (copyQuestion.value === "conflict" ? (cloudCopy.value?.conflictKind ?? null) : null));
const unfinished = computed(() => kind.value === "unfinished");
const lost = computed(() => kind.value === "lost");
// A chosen copy waiting for its account, or a newest copy the key doesn't open: only this PC's side can be the answer here.
const waiting = computed(() => kind.value === "waiting");
const unreadable = computed(() => kind.value === "unreadable");
const onlyPc = computed(() => waiting.value || unreadable.value);
// Over a copy the key doesn't open, keeping this PC's replaces it: the question asks once more first ("replace").
type Step = "choose" | "replace";
const step = ref<Step>("choose");
const replacing = computed(() => step.value === "replace");
// It may be another PC's that started over with a key of its own (one signed out has one). Signed out with the copy in a
// folder, that key can be typed in here; signed in, this PC keeps the account's key, so it isn't asked for.
const canTypeKey = computed(() => unreadable.value && cloudCopy.value?.folder != null && !account.value?.account);
const keyText = ref("");
watch(kind, () => {
  step.value = "choose";
  keyText.value = "";
});
const title = computed(() => t(replacing.value ? "cloudCopy.replace.title" : unfinished.value ? "cloudCopy.unfinished.title" : lost.value ? "cloudCopy.lost.title" : waiting.value ? "cloudCopy.waiting.title" : unreadable.value ? "cloudCopy.unreadable.title" : copyQuestion.value === "closing" ? "cloudCopy.closing.title" : copyQuestion.value === "conflict" ? "cloudCopy.conflict.title" : "cloudCopy.newer.title"));
const text = computed(() => {
  if (unfinished.value) return t("cloudCopy.unfinished.text");
  if (lost.value) return t("cloudCopy.lost.text");
  if (waiting.value) return t("cloudCopy.waiting.text");
  if (replacing.value) return t("cloudCopy.replace.text");
  if (unreadable.value) return t(canTypeKey.value ? "cloudCopy.unreadable.text" : "cloudCopy.unreadable.textOwnKey");
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

function keepPc() {
  if (unreadable.value && step.value === "choose") step.value = "replace";
  else void run({ type: "cloud-copy-keep", side: "pc", ...(step.value === "replace" ? { replace: true } : {}) });
}

/** Put off for now: the question comes back at the next start, and Settings still offers it. */
function later() {
  if (copyQuestion.value === "conflict") copyLater.value = "conflict";
  else if (copyQuestion.value === "newer") copyLater.value = "newer";
}
</script>

<template>
  <ModalDialog v-if="copyQuestion" :title="title" :description="text" testid="cloud-copy-question" :busy="copyQuestion === 'closing'" @close="later">
    <template v-if="copyQuestion === 'conflict'">
      <p v-if="!onlyPc" class="text-muted-foreground text-sm">{{ t(unfinished ? "cloudCopy.unfinished.hint" : "cloudCopy.conflict.cloudHint") }}</p>
      <form v-if="canTypeKey && !replacing" class="flex flex-col gap-2" @submit.prevent="keyText.trim() && run({ type: 'cloud-copy-other-key', key: keyText })">
        <span class="text-muted-foreground text-sm">{{ t("cloudCopy.unreadable.typeKey") }}</span>
        <div class="flex gap-2">
          <Input v-model="keyText" class="font-mono" maxlength="200" autocomplete="off" spellcheck="false" :aria-label="t('cloudCopy.askKey.label')" data-testid="cloud-copy-other-key-input" />
          <Button type="submit" :disabled="busy || !keyText.trim()" data-testid="cloud-copy-other-key-submit">{{ t("cloudCopy.askKey.continue") }}</Button>
        </div>
      </form>
      <DialogFooter v-if="replacing">
        <DialogButton variant="ghost" :disabled="busy" data-testid="cloud-copy-replace-back" @click="step = 'choose'">{{ t("common.back") }}</DialogButton>
        <DialogButton variant="destructive" :disabled="busy" data-testid="cloud-copy-replace" @click="keepPc">{{ t("cloudCopy.replace.confirm") }}</DialogButton>
      </DialogFooter>
      <DialogFooter v-else>
        <DialogButton close variant="ghost" :disabled="busy" @click="later">{{ t("cloudCopy.later") }}</DialogButton>
        <DialogButton variant="secondary" :disabled="busy" data-testid="cloud-copy-keep-pc" @click="keepPc">{{ t("cloudCopy.conflict.keepPc") }}</DialogButton>
        <DialogButton v-if="!onlyPc" :disabled="busy" data-testid="cloud-copy-keep-cloud" @click="run({ type: 'cloud-copy-keep', side: 'cloud' })">{{ t("cloudCopy.conflict.useCloud") }}</DialogButton>
      </DialogFooter>
    </template>
    <DialogFooter v-else-if="copyQuestion === 'newer'">
      <DialogButton close variant="ghost" @click="later">{{ t("cloudCopy.later") }}</DialogButton>
      <DialogButton data-testid="cloud-copy-restart" @click="run({ type: 'cloud-copy-restart' })">{{ t("cloudCopy.newer.restart") }}</DialogButton>
    </DialogFooter>
    <DialogFooter v-else>
      <DialogButton variant="secondary" data-testid="cloud-copy-close-anyway" @click="run({ type: 'cloud-copy-close-anyway' })">{{ t("cloudCopy.closing.anyway") }}</DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
