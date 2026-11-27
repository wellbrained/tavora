<script setup lang="ts">
import { ChevronDown, Copy, FolderInput, MoreHorizontal, Pencil, Pin, Trash2 } from "@lucide/vue";
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

const showRead = ref(true);
const sort = ref("recent");
// A choice inside a submenu: the submenu's entry shows that it holds the chosen one (`chosen`).
const format = ref("number");
const decimals = ref("2");
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="secondary"><MoreHorizontal /> Actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-56">
        <DropdownMenuLabel>Note</DropdownMenuLabel>
        <DropdownMenuItem><Pencil /> Rename <DropdownMenuShortcut>F2</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem><Copy /> Duplicate <DropdownMenuShortcut>Ctrl+D</DropdownMenuShortcut></DropdownMenuItem>
        <DropdownMenuItem disabled disabled-reason="Already pinned."><Pin /> Pin</DropdownMenuItem>
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
          <DropdownMenuRadioItem value="size" disabled disabled-reason="Only for notes with files.">Size</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive"><Trash2 /> Delete note</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="secondary">Format <ChevronDown /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-48">
        <DropdownMenuRadioGroup v-model="format">
          <DropdownMenuRadioItem value="auto">Automatic</DropdownMenuRadioItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset :chosen="format === 'number'">Number</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup :model-value="format === 'number' ? decimals : ''" @update:model-value="(value) => { format = 'number'; decimals = String(value) }">
                <DropdownMenuRadioItem value="0">0 decimals</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="2">2 decimals</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuRadioItem value="text">Text</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button size="icon-sm" variant="ghost" aria-label="More" title="More"><MoreHorizontal /></Button>
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
