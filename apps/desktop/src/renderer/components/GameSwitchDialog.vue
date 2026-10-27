<script setup lang="ts">
// A game of the library just started and the user chose to be asked (Settings > General): switch to it?
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, dialog, state } from "../host";
import { t } from "../i18n";
import ModalDialog from "./ModalDialog.vue";

const props = defineProps<{ gameId: string }>();
const name = computed(() => state.value?.library.workspaces[props.gameId]?.name ?? "");

async function choose(choice: "switch" | "cancel") {
  dialog.value = null;
  await act({ type: "game-switch", choice }, { quiet: true });
}
</script>

<template>
  <ModalDialog :title="t('gameSwitch.title', { name })" :description="t('gameSwitch.message')" testid="game-switch" @close="choose('cancel')">
    <div class="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="ghost" data-testid="game-switch-cancel" @click="choose('cancel')">{{ t("gameSwitch.notNow") }}</Button>
      <Button type="button" autofocus data-testid="game-switch-confirm" @click="choose('switch')">{{ t("gameSwitch.switch") }}</Button>
    </div>
  </ModalDialog>
</template>
