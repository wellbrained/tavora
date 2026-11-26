<script setup lang="ts">
import { Copy, ExternalLink, Group, Lock, Pencil, Trash2, Unlink } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Toolbar } from "@tavora/official-ui/components/ui/toolbar";
</script>

<template>
  <div class="bg-muted/40 relative h-40 w-full overflow-hidden rounded-md border p-4 text-sm">
    <p class="text-muted-foreground">The keep is north of the <u class="text-primary">old bridge</u>, past the shroud.</p>
    <Toolbar label="Link" variant="floating" class="absolute top-12 left-24 max-w-[272px] pl-2.5 text-xs">
      <span class="text-muted-foreground min-w-0 flex-1 truncate">https://example.com/bridge</span>
      <Button variant="ghost" size="icon-sm" aria-label="Open" title="Open"><ExternalLink /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Edit" title="Edit"><Pencil /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Remove link" title="Remove link"><Unlink /></Button>
    </Toolbar>
    <Toolbar label="Frame" variant="floating" class="absolute right-4 bottom-4">
      <Button variant="ghost" size="icon-sm" aria-label="Group" title="Group"><Group /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Lock" title="Lock"><Lock /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Copy" title="Copy"><Copy /></Button>
      <Separator />
      <Button variant="danger" size="icon-sm" aria-label="Remove" title="Remove"><Trash2 /></Button>
    </Toolbar>
  </div>
</template>
