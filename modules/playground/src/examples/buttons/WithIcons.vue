<script setup lang="ts">
import { ChevronRight, Copy, Loader2, Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button><Plus :stroke-width="1.5" /> Add to-do</Button>
    <Button variant="secondary"><Copy :stroke-width="1.5" /> Copy link</Button>
    <Button variant="ghost" size="sm">More <ChevronRight :stroke-width="1.5" /></Button>
    <Button variant="secondary" disabled><Loader2 class="animate-spin" :stroke-width="1.5" /> Saving…</Button>
  </div>
</template>
