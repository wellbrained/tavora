<script setup lang="ts">
// A new PC gets the account's key from another PC instead of the recovery key being typed in. Shown
// where the recovery key is asked for; the key itself stays in the main process.
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import type { HostAction } from "../../../shared/host-api";
import { act, pairing } from "../../host";
import { t } from "../../i18n";

const asking = computed(() => pairing.value?.asking ?? null);
const busy = ref(false);

async function run(action: HostAction) {
  if (busy.value) return;
  busy.value = true;
  try {
    await act(action);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-start gap-2" data-testid="pairing">
    <Button v-if="!asking" type="button" :disabled="busy" data-testid="pairing-start" @click="run({ type: 'pairing-start' })">{{ t("pairing.start") }}</Button>
    <template v-else-if="asking.step === 'waiting'">
      <p class="text-sm" role="status" data-testid="pairing-waiting">{{ t(asking.via === "folder" ? "pairing.waitingFolder" : "pairing.waiting") }}</p>
      <Button type="button" variant="ghost" size="sm" :disabled="busy" @click="run({ type: 'pairing-cancel' })">{{ t("common.cancel") }}</Button>
    </template>
    <template v-else-if="asking.step === 'code'">
      <p class="text-sm" role="status">{{ t("pairing.code", { name: asking.from ?? t("pairing.otherPc") }) }}</p>
      <code class="bg-muted rounded px-3 py-2 font-mono text-2xl tracking-widest" data-testid="pairing-code">{{ asking.code }}</code>
      <Button type="button" variant="ghost" size="sm" :disabled="busy" @click="run({ type: 'pairing-cancel' })">{{ t("common.cancel") }}</Button>
    </template>
    <template v-else>
      <p class="text-sm" role="status" data-testid="pairing-ended">{{ t(`pairing.${asking.step}`) }}</p>
      <Button type="button" variant="secondary" size="sm" :disabled="busy" data-testid="pairing-again" @click="run({ type: 'pairing-start' })">{{ t("pairing.tryAgain") }}</Button>
    </template>
  </div>
</template>
