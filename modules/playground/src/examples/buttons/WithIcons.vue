<script setup lang="ts">
import { ChevronRight, Copy, Loader2, Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";

defineProps<{ disabled?: boolean }>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button :disabled="disabled"><Plus :stroke-width="1.5" /> Add to-do</Button>
    <Button variant="secondary" :disabled="disabled"><Copy :stroke-width="1.5" /> Copy link</Button>
    <Button variant="ghost" size="sm" :disabled="disabled">More <ChevronRight :stroke-width="1.5" /></Button>
    <Button variant="secondary" disabled><Loader2 class="animate-spin" :stroke-width="1.5" /> Saving…</Button>
  </div>
</template>
