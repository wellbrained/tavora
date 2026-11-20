<script setup lang="ts">
// Profile dialog > Account > Recovery key (and Settings > Developer > Publishing): the one key the user keeps. It opens the cloud copy and the
// publisher keys Tavora keeps. A new PC gets it from another PC, or asks for it once. The key stays in the main process,
// except while the user looks at it here. When the keys kept with the account on Tavora's service don't open with this
// PC's key, or are gone, it says so: the new key is typed in, or (gone) the user may start them again empty.
import { computed, ref } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Input } from "@tavora/official-ui/components/ui/input";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import type { HostAction } from "../../../shared/host-api";
import { act, confirmAction, developerKeys, showToast, submitAction } from "../../host";
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
/** Typing the key in: asked for (another PC made it), or because the keys on Tavora's service don't open with this PC's. */
const asking = computed(() => view.value?.status === "ask" || view.value?.vault === "unopened");
/** The keys are gone from Tavora's service: starting them again empty loses the ones not saved to a file, so it asks. */
function rebuild() {
  confirmAction({
    title: t("recoveryKey.gone.confirmTitle"),
    message: t("recoveryKey.gone.confirmText"),
    confirm: t("recoveryKey.gone.button"),
    danger: true,
    run: () => submitAction({ type: "developer-vault-rebuild" }),
  });
}
</script>

<template>
  <SettingGroup v-if="view" :title="t('recoveryKey.title')" :description="t('recoveryKey.hint')" data-testid="recovery-key">
    <Notice v-if="!view.recoveryKey && view.vault === 'unopened'" variant="warning" class="my-4" :title="t('recoveryKey.unopened.title')" data-testid="recovery-key-unopened">{{ t("recoveryKey.unopened.text") }}</Notice>
    <Notice v-else-if="!view.recoveryKey && view.vault === 'gone'" variant="warning" class="my-4" :title="t('recoveryKey.gone.title')" data-testid="recovery-key-gone">
      {{ t("recoveryKey.gone.text") }}
      <template #action>
        <Button size="sm" variant="secondary" :disabled="busy" data-testid="recovery-key-rebuild" @click="rebuild">{{ t("recoveryKey.gone.button") }}</Button>
      </template>
    </Notice>

    <div v-if="view.recoveryKey" class="flex flex-col gap-3 py-4" data-testid="recovery-key-shown">
      <span class="text-muted-foreground text-sm">{{ t("recoveryKey.keepSafe") }}</span>
      <code class="bg-muted rounded px-3 py-2 font-mono text-sm tracking-wide break-all select-all" data-testid="recovery-key-text">{{ view.recoveryKey }}</code>
      <div class="flex gap-2">
        <Button variant="secondary" :disabled="busy" @click="copyKey">{{ t("cloudCopy.key.copy") }}</Button>
        <Button :disabled="busy" data-testid="recovery-key-saved" @click="run({ type: 'developer-recovery-key-saved' })">{{ t("cloudCopy.key.saved") }}</Button>
      </div>
    </div>

    <form v-else-if="asking" class="flex flex-col gap-3 py-4" @submit.prevent="keyText.trim() && enter()">
      <!-- With a key here (its vault doesn't open), another PC can't send one: it is typed in. -->
      <template v-if="view.status === 'ask'">
        <span class="text-muted-foreground">{{ t("recoveryKey.ask") }}</span>
        <PairingAsk />
      </template>
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
