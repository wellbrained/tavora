<script setup lang="ts">
import { Copy, Pencil, Pin, Plus, Settings } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button size="icon-xs" variant="ghost" aria-label="Pin" title="Pin" :disabled="disabled"><Pin :stroke-width="1.5" /></Button>
    <Button size="icon-xs" variant="secondary" aria-label="Copy" title="Copy" :disabled="disabled"><Copy :stroke-width="1.5" /></Button>
    <Button size="icon-sm" variant="ghost" aria-label="Edit" title="Edit" :disabled="disabled"><Pencil :stroke-width="1.5" /></Button>
    <Button size="icon" variant="secondary" aria-label="Settings" title="Settings" :disabled="disabled"><Settings :stroke-width="1.5" /></Button>
    <Button size="icon-lg" variant="outline" aria-label="Add" title="Add" :disabled="disabled"><Plus :stroke-width="1.5" /></Button>
  </div>
</template>
