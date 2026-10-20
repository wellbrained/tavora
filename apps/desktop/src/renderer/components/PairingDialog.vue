<script setup lang="ts">
// Another PC of the account asks for the recovery key: it gets it only after this click, once both show the same code.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, pairing, showToast } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const request = computed(() => pairing.value?.approve ?? null);
const title = computed(() => {
  const asked = request.value;
  if (!asked) return "";
  return asked.name ? t("pairing.approve.title", { name: asked.name }) : t("pairing.approve.titleUnknown");
});

async function decide(allow: boolean) {
  const asked = request.value;
  if (!asked) return;
  const result = await act({ type: "pairing-decide", id: asked.id, allow });
  if (result.ok) showToast(t(allow ? "pairing.approve.added" : "pairing.approve.refused"));
}
</script>

<template>
  <ModalDialog v-if="request" :key="request.id" :title="title" :description="t('pairing.approve.text')" testid="pairing-approve" @close="decide(false)">
    <p class="text-muted-foreground text-sm">{{ t("pairing.approve.check") }}</p>
    <code class="bg-muted self-start rounded px-3 py-2 font-mono text-2xl tracking-widest" data-testid="pairing-approve-code">{{ request.code }}</code>
    <div class="flex justify-end gap-2">
      <Button variant="ghost" data-testid="pairing-refuse" @click="decide(false)">{{ t("pairing.approve.refuse") }}</Button>
      <Button data-testid="pairing-add" @click="decide(true)">{{ t("pairing.approve.add") }}</Button>
    </div>
  </ModalDialog>
</template>
