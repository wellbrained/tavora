<script setup lang="ts">
// The note after Copy to…: what was copied and what could not be, with Show to switch the page to that game.
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { t } from "../../i18n";
import { send, view } from "./layout-state";

const copied = computed(() => view.value?.copied ?? null);
</script>

<template>
  <Notice v-if="copied" variant="success" data-testid="layout-copied">
    {{ copied.text }}
    <template #action>
      <Button variant="ghost" size="xs" data-testid="layout-copied-show" @click="send({ type: 'game', gameId: copied.gameId })">{{ t("overlays.copy.show") }}</Button>
      <Button variant="ghost" size="xs" data-testid="layout-copied-close" @click="send({ type: 'dismiss-notice' })">{{ t("common.close") }}</Button>
    </template>
  </Notice>
</template>
