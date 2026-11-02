<script setup lang="ts">
// Asked right after signing in on a PC without the account's recovery key, when the account has one:
// confirm on a PC that has it (PairingAsk), or type it in. Later leaves it for Settings > Account, where
// the cloud copy and publishing ask again when they need it. Closes once this PC has the key.
import { KeyRound } from "@lucide/vue";
import { ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { Input } from "@tavora/official-ui/components/ui/input";
import { act, developerKeys, dialog, showToast } from "../../host";
import { t } from "../../i18n";
import ModalDialog from "../ModalDialog.vue";
import PairingAsk from "./PairingAsk.vue";

const busy = ref(false);
const keyText = ref("");

async function enter() {
  if (busy.value) return;
  busy.value = true;
  try {
    if ((await act({ type: "developer-recovery-key", key: keyText.value })).ok) keyText.value = "";
  } finally {
    busy.value = false;
  }
}

function close() {
  dialog.value = null;
}

watch(
  () => developerKeys.value?.status,
  (status) => {
    if (status === "ask" || status === "loading") return;
    close();
    if (status === "ready" || status === "none") showToast(t("recoveryAsk.done"));
  },
);
</script>

<template>
  <ModalDialog :title="t('recoveryAsk.title')" :description="t('recoveryAsk.text')" class="sm:max-w-[480px]" :icon="KeyRound" testid="recovery-ask" @close="close">
    <div class="flex flex-col gap-4">
    <PairingAsk />
    <form class="flex flex-col gap-2" @submit.prevent="keyText.trim() && enter()">
      <span class="text-muted-foreground text-sm">{{ t("pairing.typeKey") }}</span>
      <div class="flex gap-2">
        <Input v-model="keyText" class="font-mono" maxlength="200" autocomplete="off" spellcheck="false" :aria-label="t('cloudCopy.askKey.label')" data-testid="recovery-ask-input" />
        <Button type="submit" :disabled="busy || !keyText.trim()" data-testid="recovery-ask-submit">{{ t("cloudCopy.askKey.continue") }}</Button>
      </div>
    </form>
    </div>
    <DialogFooter>
      <DialogButton close variant="ghost" data-testid="recovery-ask-later" @click="close">{{ t("devStart.later") }}</DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
