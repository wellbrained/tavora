<script setup lang="ts">
// Settings > Account > Recovery key: the one key the player keeps. It opens the cloud copy and the
// publisher keys Tavora keeps. A new PC gets it from another PC, or asks for it once. The key stays in the main process,
// except while the player looks at it here.
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HostAction } from "../../../shared/host-api";
import { act, developerKeys, showToast } from "../../host";
import { t } from "../../i18n";
import SettingGroup from "./SettingGroup.vue";
import PairingAsk from "./PairingAsk.vue";
import SettingRow from "./SettingRow.vue";

const view = computed(() => developerKeys.value);
const busy = ref(false);
const keyText = ref("");

async function run(action: HostAction): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  try {
    return (await act(action)).ok;
  } finally {
    busy.value = false;
  }
}
async function copyKey() {
  if (await run({ type: "developer-copy-recovery-key" })) showToast(t("cloudCopy.key.copied"));
}
async function enter() {
  if (await run({ type: "developer-recovery-key", key: keyText.value })) keyText.value = "";
}
</script>

<template>
  <SettingGroup v-if="view" :title="t('recoveryKey.title')" :description="t('recoveryKey.hint')" data-testid="recovery-key">
    <div v-if="view.recoveryKey" class="flex flex-col gap-3 py-4" data-testid="recovery-key-shown">
      <span class="text-muted-foreground text-sm">{{ t("recoveryKey.keepSafe") }}</span>
      <code class="bg-muted rounded px-3 py-2 font-mono text-sm tracking-wide break-all select-all" data-testid="recovery-key-text">{{ view.recoveryKey }}</code>
      <div class="flex gap-2">
        <Button variant="secondary" :disabled="busy" @click="copyKey">{{ t("cloudCopy.key.copy") }}</Button>
        <Button :disabled="busy" data-testid="recovery-key-saved" @click="run({ type: 'developer-recovery-key-saved' })">{{ t("cloudCopy.key.saved") }}</Button>
      </div>
    </div>

    <form v-else-if="view.status === 'ask'" class="flex flex-col gap-3 py-4" @submit.prevent="keyText.trim() && enter()">
      <span class="text-muted-foreground">{{ t("recoveryKey.ask") }}</span>
      <PairingAsk />
      <span class="text-muted-foreground text-sm">{{ t("pairing.typeKey") }}</span>
      <div class="flex gap-2">
        <Input v-model="keyText" class="max-w-120 font-mono" maxlength="200" autocomplete="off" spellcheck="false" :aria-label="t('cloudCopy.askKey.label')" data-testid="recovery-key-input" />
        <Button type="submit" :disabled="busy || !keyText.trim()" data-testid="recovery-key-submit">{{ t("cloudCopy.askKey.continue") }}</Button>
      </div>
    </form>

    <SettingRow v-else-if="view.hasKey" :label="t('recoveryKey.label')" :description="t('recoveryKey.description')">
      <Button variant="ghost" :disabled="busy" data-testid="recovery-key-show" @click="run({ type: 'developer-show-recovery-key' })">{{ t("cloudCopy.showKey.button") }}</Button>
    </SettingRow>
    <p v-else-if="view.status === 'none'" class="text-muted-foreground py-4 text-sm" data-testid="recovery-key-none">{{ t("recoveryKey.none") }}</p>
  </SettingGroup>
</template>
