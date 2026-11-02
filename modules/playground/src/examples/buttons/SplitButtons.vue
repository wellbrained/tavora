<script setup lang="ts">
import { ChevronDown, Plus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ButtonGroup } from "@tavora/official-ui/components/ui/button-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { useOff } from "../../dev";

const off = useOff();
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <ButtonGroup label="Add a module">
      <Button size="sm" variant="secondary" :disabled="off"><Plus :stroke-width="1.5" /> Add module</Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button size="sm" variant="secondary" class="px-1.5" aria-label="Modules in this workspace" title="Modules in this workspace" :disabled="off"><ChevronDown :stroke-width="1.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem>Notes</DropdownMenuItem>
          <DropdownMenuItem>To-dos</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
    <ButtonGroup label="Add all">
      <Button size="sm" variant="outline" :disabled="off">Add all</Button>
      <Button size="sm" variant="outline" class="px-2" aria-label="Show panels" title="Show panels" :disabled="off"><ChevronDown :stroke-width="1.75" /></Button>
    </ButtonGroup>
  </div>
</template>
