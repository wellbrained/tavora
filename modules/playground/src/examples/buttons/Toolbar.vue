<script setup lang="ts">
import { AlignCenter, AlignLeft, AlignRight, ChevronDown, Copy, FolderInput, Pin, Redo2, Undo2 } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { SearchInput } from "@tavora/official-ui/components/ui/search-input";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { Toggle, ToggleGroup } from "@tavora/official-ui/components/ui/toggle";
import { Toolbar } from "@tavora/official-ui/components/ui/toolbar";
import { ref } from "vue";

const formats = ref<("bold" | "italic")[]>(["bold"]);
const align = ref<"left" | "center" | "right">("left");
const pinned = ref(false);
const search = ref("");
</script>

<template>
  <Toolbar label="Note tools" class="bg-background w-full flex-wrap rounded-lg border p-1">
    <Button size="icon-sm" variant="ghost" aria-label="Undo" title="Undo"><Undo2 /></Button>
    <Button size="icon-sm" variant="ghost" aria-label="Redo" title="Redo" disabled disabled-reason="Nothing to redo"><Redo2 /></Button>
    <Separator />
    <ToggleGroup
      v-model="formats"
      label="Text style"
      :options="[
        { value: 'bold', label: 'Bold', text: 'B' },
        { value: 'italic', label: 'Italic', text: 'I' },
      ]"
    />
    <SegmentedControl
      v-model="align"
      label="Align"
      :options="[
        { value: 'left', label: 'Left', icon: AlignLeft, iconOnly: true },
        { value: 'center', label: 'Centre', icon: AlignCenter, iconOnly: true },
        { value: 'right', label: 'Right', icon: AlignRight, iconOnly: true },
      ]"
    />
    <Separator />
    <Toggle v-model="pinned" label="Pin"><Pin class="size-4" /></Toggle>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button size="sm" variant="ghost">More <ChevronDown data-icon="end" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem><Copy /> Duplicate</DropdownMenuItem>
        <DropdownMenuItem><FolderInput /> Move to folder</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <SearchInput v-model="search" placeholder="Find in note" aria-label="Find in note" clear-label="Clear" class="ml-auto w-40" />
  </Toolbar>
</template>
