<script setup lang="ts">
// A module asked to open a link and the workspace has no Browser panel: ask where it should open.
import { DialogButton, DialogFooter } from "@tavora/official-ui/components/ui/dialog";
import { AppWindow, ExternalLink, Link } from "@lucide/vue";
import { act, closeDialog, dialog } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

defineProps<{ url: string }>();

function choose(choice: "panel" | "system" | "cancel") {
  // Cancel is both a button and the dialog closing: only the first choice answers. The question may be updated in
  // place while it shows (new details), so it is found by its kind.
  const request = dialog.value;
  if (request?.kind !== "link-choice") return;
  closeDialog(request);
  // Returned, so a failure is reported as a click's is.
  return act({ type: "link-choice", choice }, { quiet: true });
}
</script>

<template>
  <ModalDialog :title="t('linkChoice.title')" :description="t('linkChoice.message')" :icon="Link" testid="link-choice" @close="choose('cancel')">
    <p class="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm break-all" data-testid="link-choice-url">{{ url }}</p>
    <DialogFooter>
      <DialogButton type="button" close variant="ghost" data-testid="link-choice-cancel" @click="choose('cancel')">{{ t("common.cancel") }}</DialogButton>
      <DialogButton type="button" variant="secondary" :icon="ExternalLink" data-testid="link-choice-system" @click="choose('system')">{{ t("linkChoice.system") }}</DialogButton>
      <DialogButton type="button" :icon="AppWindow" autofocus data-testid="link-choice-panel" @click="choose('panel')">{{ t("linkChoice.panel") }}</DialogButton>
    </DialogFooter>
  </ModalDialog>
</template>
