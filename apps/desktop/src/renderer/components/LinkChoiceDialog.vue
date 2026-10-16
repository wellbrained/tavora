<script setup lang="ts">
// A module asked to open a link and the game has no Browser panel: ask where it should open.
import { Button } from "@/components/ui/button";
import { act, dialog } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

defineProps<{ url: string }>();

async function choose(choice: "panel" | "system" | "cancel") {
  dialog.value = null;
  await act({ type: "link-choice", choice }, { quiet: true });
}
</script>

<template>
  <ModalDialog :title="t('linkChoice.title')" :description="t('linkChoice.message')" testid="link-choice" @close="choose('cancel')">
    <p class="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm break-all" data-testid="link-choice-url">{{ url }}</p>
    <div class="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" data-testid="link-choice-cancel" @click="choose('cancel')">{{ t("common.cancel") }}</Button>
      <Button type="button" variant="secondary" data-testid="link-choice-system" @click="choose('system')">{{ t("linkChoice.system") }}</Button>
      <Button type="button" autofocus data-testid="link-choice-panel" @click="choose('panel')">{{ t("linkChoice.panel") }}</Button>
    </div>
  </ModalDialog>
</template>
