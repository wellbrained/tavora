<script setup lang="ts">
import { Copy, Folder, FolderInput, FolderPlus, Pencil, Trash2 } from "@lucide/vue";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@tavora/official-ui/components/ui/context-menu";
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger class="text-muted-foreground flex h-16 w-56 items-center justify-center rounded-md border border-dashed text-sm">
      Right-click here
    </ContextMenuTrigger>
    <ContextMenuContent class="w-48">
      <ContextMenuItem><Pencil /> Rename</ContextMenuItem>
      <ContextMenuItem><Copy /> Duplicate</ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger><FolderInput /> Move to folder</ContextMenuSubTrigger>
        <ContextMenuSubContent class="w-44">
          <ContextMenuItem><Folder /> Act 1</ContextMenuItem>
          <ContextMenuItem><Folder /> Endgame</ContextMenuItem>
          <ContextMenuItem><FolderPlus /> New folder…</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive"><Trash2 /> Delete</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
