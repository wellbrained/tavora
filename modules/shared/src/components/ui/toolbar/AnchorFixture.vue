<script setup lang="ts">
// Test fixture: a toolbar button that opens something, written as a module writes it (a component of its own, compiled).
import { Button } from "../button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../popover";

defineProps<{ kind: "popover" | "menu" }>();
</script>

<template>
  <Popover v-if="kind === 'popover'">
    <PopoverTrigger as-child>
      <Button data-testid="open">open</Button>
    </PopoverTrigger>
    <PopoverContent align="end">Filters</PopoverContent>
  </Popover>
  <DropdownMenu v-else>
    <DropdownMenuTrigger as-child>
      <Button data-testid="open">open</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end"><DropdownMenuItem>Rename</DropdownMenuItem></DropdownMenuContent>
  </DropdownMenu>
</template>
