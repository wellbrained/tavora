<script setup lang="ts">
// A panel could not switch to what another panel of its module asked for (it could not save, or did not answer in
// time) and kept what it showed. Offer the explicit way out: the content in a new panel (named panels round 6).
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { PanelsTopLeft, Plus } from "@lucide/vue";
import { act, dialog } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

defineProps<{ panel: string; content: string }>();

async function choose(choice: "new-panel" | "cancel") {
  dialog.value = null;
  await act({ type: "navigation-choice", choice }, { quiet: true });
}
</script>

<template>
  <ModalDialog :title="t('navigationChoice.title', { panel })" :description="t('navigationChoice.message', { panel })" :icon="PanelsTopLeft" testid="navigation-choice" @close="choose('cancel')">
    <p class="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm break-words" data-testid="navigation-choice-content">{{ content }}</p>
    <DialogFooter>
      <DialogButton type="button" close variant="ghost" data-testid="navigation-choice-cancel" @click="choose('cancel')">{{ t("common.cancel") }}</DialogButton>
      <DialogButton type="button" :icon="Plus" autofocus data-testid="navigation-choice-new-panel" @click="choose('new-panel')">{{ t("navigationChoice.newPanel") }}</DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
