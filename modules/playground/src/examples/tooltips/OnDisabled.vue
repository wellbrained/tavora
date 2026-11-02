<script setup lang="ts">
import { Undo2 } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button disabled title="Add a name and an icon first.">Publish</Button>
    <Button size="icon" variant="secondary" disabled aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 :stroke-width="1.5" /></Button>
  </div>
</template>
