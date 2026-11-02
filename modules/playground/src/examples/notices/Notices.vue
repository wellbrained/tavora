<script setup lang="ts">
import { Button } from "@tavora/official-ui/components/ui/button";
import { Notice } from "@tavora/official-ui/components/ui/notice";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="flex flex-col gap-2">
    <Notice>Notes are shared by every panel of this module in the current workspace.</Notice>
    <Notice variant="success">Imported 24 to-dos.</Notice>
    <Notice variant="warning" title="Almost full">This note is almost at its size limit.</Notice>
    <Notice variant="error">
      Could not save. Your change is kept and will be tried again.
      <template #action><Button size="xs" variant="secondary" :disabled="disabled">Retry</Button></template>
    </Notice>
  </div>
</template>
