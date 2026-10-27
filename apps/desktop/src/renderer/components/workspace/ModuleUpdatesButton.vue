<script setup lang="ts">
// In the workspace header, only while module updates wait: how many, and a way to the module library's
// Updates view. The app's own update has its marker on the rail instead.
import { CloudDownload } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { dialog, state } from "../../host";
import { t } from "../../i18n";

const count = computed(() => state.value!.modules.filter((module) => module.update).length);
</script>

<template>
  <Button v-if="count" size="sm" :title="t('workspace.updates.title')" data-testid="module-updates-button" @click="dialog = { kind: 'add-module', view: 'updates' }">
    <CloudDownload :stroke-width="1.5" /> {{ t("workspace.updates", { count }) }}
  </Button>
</template>
