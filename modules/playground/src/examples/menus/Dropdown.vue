<script setup lang="ts">
import { Copy, FolderInput, MoreHorizontal, Pencil, Pin, Trash2 } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@tavora/official-ui/components/ui/dropdown-menu";
import { ref } from "vue";

defineProps<{ disabled?: boolean }>();

const showRead = ref(true);
const sort = ref("recent");
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="secondary" :disabled="disabled"><MoreHorizontal :stroke-width="1.5" /> Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-56">
        <DropdownMenuLabel>Note</DropdownMenuLabel>
        <DropdownMenuItem><Pencil /> Rename <DropdownMenuShortcut>F2</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem><Copy /> Duplicate <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem disabled><Pin /> Pin (already pinned)</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger><FolderInput /> Move to group</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Act 1</DropdownMenuItem>
            <DropdownMenuItem>Act 2</DropdownMenuItem>
            <DropdownMenuItem>Endgame</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem v-model="showRead">Show read notes</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup v-model="sort">
          <DropdownMenuRadioItem value="recent">Recently changed</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 /> Delete note</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button size="icon-sm" variant="ghost" aria-label="More" title="More" :disabled="disabled"><MoreHorizontal :stroke-width="1.5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem>Open</DropdownMenuItem>
        <DropdownMenuItem>Copy link</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
