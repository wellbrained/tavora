<script setup lang="ts">
import { Copy, Folder, FolderInput, FolderPlus, Pencil, Trash2 } from "@lucide/vue";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuShortcut,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@tavora/official-ui/components/ui/context-menu";
import { ref } from "vue";

const pinned = ref(true);
const sort = ref("name");
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger class="text-muted-foreground flex h-16 w-56 items-center justify-center rounded-md border border-dashed text-sm">
      Right-click here
    </ContextMenuTrigger>
    <ContextMenuContent class="w-48">
      <ContextMenuItem><Pencil /> Rename<ContextMenuShortcut>F2</ContextMenuShortcut></ContextMenuItem>
      <ContextMenuItem><Copy /> Duplicate</ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger><FolderInput /> Move to folder</ContextMenuSubTrigger>
        <ContextMenuSubContent class="w-44">
          <ContextMenuItem><Folder /> Act 1</ContextMenuItem>
          <ContextMenuItem><Folder /> Endgame</ContextMenuItem>
          <ContextMenuItem><FolderPlus /> New folder</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem v-model="pinned">Pinned</ContextMenuCheckboxItem>
      <ContextMenuSeparator />
      <ContextMenuRadioGroup v-model="sort">
        <ContextMenuRadioItem value="name">By name</ContextMenuRadioItem>
        <ContextMenuRadioItem value="date">By date</ContextMenuRadioItem>
      </ContextMenuRadioGroup>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive"><Trash2 /> Delete</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
