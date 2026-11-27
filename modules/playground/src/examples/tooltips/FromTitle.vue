<script setup lang="ts">
// A title is enough: connectModule turns every title into the kit's tooltip. `data-tooltip-description` adds a softer
// line under it, which screen readers hear as the element's description.
import { Copy, Pin } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Button title="Readable help from the shared kit.">Hover or focus me</Button>
    <Button size="icon" variant="secondary" aria-label="Duplicate" title="Duplicate" aria-keyshortcuts="Control+D"><Copy /></Button>
    <Button size="icon" variant="secondary" aria-label="Pin" title="Pin" data-tooltip-description="Keeps this panel on top of the game."><Pin /></Button>
    <span class="text-muted-foreground max-w-40 truncate rounded-md border px-2 py-1.5 text-sm" title="D:\Games\Steam\steamapps\common\Enshrouded\Saves">D:\Games\Steam\steamapps\common\Enshrouded\Saves</span>
  </div>
</template>
