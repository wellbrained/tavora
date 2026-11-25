<script setup lang="ts">
// Another PC of the account asks for the recovery key: it gets it only after this click, once both show the same code.
import { computed, ref } from "vue";
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { useTask } from "@tavora/official-ui/use-task";
import { MonitorSmartphone } from "@lucide/vue";
import { act, pairing, showToast } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const request = computed(() => pairing.value?.approve ?? null);
const title = computed(() => {
  const asked = request.value;
  if (!asked) return "";
  return asked.name ? t("pairing.approve.title", { name: asked.name }) : t("pairing.approve.titleUnknown");
});

/** One answer at a time, and one per question: an Esc after Add, before main takes the question away, refuses nothing. */
const decider = useTask();
const answered = ref<string | null>(null);

async function decide(allow: boolean) {
  const asked = request.value;
  if (!asked || answered.value === asked.id) return;
  const result = await decider.run(() => act({ type: "pairing-decide", id: asked.id, allow }));
  if (!result?.ok) return;
  answered.value = asked.id;
  showToast(t(allow ? "pairing.approve.added" : "pairing.approve.refused"));
}
</script>

<template>
  <ModalDialog v-if="request" :key="request.id" :title="title" :description="t('pairing.approve.text')" :icon="MonitorSmartphone" testid="pairing-approve" :status="decider.state.value.status" :busy="decider.busy.value" @close="decide(false)">
    <p class="text-muted-foreground text-sm">{{ t("pairing.approve.check") }}</p>
    <code class="bg-muted self-start rounded px-3 py-2 font-mono text-2xl tracking-widest" data-testid="pairing-approve-code">{{ request.code }}</code>
    <DialogFooter>
      <DialogButton close variant="ghost" data-testid="pairing-refuse" :disabled="decider.busy.value" @click="decide(false)">{{ t("pairing.approve.refuse") }}</DialogButton>
      <DialogButton data-testid="pairing-add" :loading="decider.busy.value" :disabled="decider.busy.value" @click="decide(true)">{{ t("pairing.approve.add") }}</DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
