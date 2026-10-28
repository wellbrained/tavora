<script setup lang="ts">
// In the workspace header, only while module updates wait: an icon with how many, and a way to the module library's
// Updates view. The app's own update has its marker on the rail instead.
import { CloudDownload } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { dialog, state } from "../../host";
import { t } from "../../i18n";

const count = computed(() => state.value!.modules.filter((module) => module.update).length);
</script>

<template>
  <Button v-if="count" size="icon" variant="ghost" class="relative size-9 [&_svg]:size-6" :title="t('workspace.updates', { count })" :aria-label="t('workspace.updates', { count })" data-testid="module-updates-button" @click="dialog = { kind: 'add-module', view: 'updates' }">
    <CloudDownload :stroke-width="2" />
    <span class="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4 font-semibold">{{ count }}</span>
  </Button>
</template>
