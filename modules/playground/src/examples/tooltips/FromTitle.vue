<script setup lang="ts">
// A title is enough: connectModule turns every title into the kit's tooltip.
import { Copy } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button title="Readable help from the shared kit.">Hover or focus me</Button>
    <Button size="icon" variant="secondary" aria-label="Duplicate" title="Duplicate" aria-keyshortcuts="Control+D"><Copy :stroke-width="1.5" /></Button>
    <span class="text-muted-foreground max-w-40 truncate rounded-md border px-2 py-1.5 text-sm" title="D:\Games\Steam\steamapps\common\Enshrouded\Saves">D:\Games\Steam\steamapps\common\Enshrouded\Saves</span>
  </div>
</template>
