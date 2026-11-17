<script setup lang="ts">
import { FolderInput, Pencil, Pin, Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="secondary"><Plus /> Add</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-72">
      <DropdownMenuItem description="Start from a file on your PC.">
        <template #icon><FolderInput /></template>
        Import a build
      </DropdownMenuItem>
      <DropdownMenuItem description="Write your own notes.">
        <template #icon><Pencil /></template>
        New note
      </DropdownMenuItem>
      <DropdownMenuItem disabled disabled-reason="Sign in first." description="Send others a link.">
        <template #icon><Pin /></template>
        Share
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
