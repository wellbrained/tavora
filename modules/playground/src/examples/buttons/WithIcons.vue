<script setup lang="ts">
import { ChevronRight, Copy, Loader2, Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button><Plus /> Add to-do</Button>
    <Button variant="secondary"><Copy /> Copy link</Button>
    <Button variant="ghost" size="sm">More <ChevronRight data-icon="end" /></Button>
    <Button variant="secondary" disabled><Loader2 class="animate-spin" /> Saving…</Button>
  </div>
</template>
