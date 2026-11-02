<script setup lang="ts">
import { ChevronDown } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { ref } from "vue";
import { useOff } from "../../dev";

const off = useOff();
const pickedGame = ref("satisfactory");
</script>

<template>
  <div class="flex flex-wrap items-center gap-6" data-testid="dropdown-icons">
    <div class="flex flex-col items-start gap-2">
      <span class="text-muted-foreground text-xs">Value picker</span>
      <Picker v-model="pickedGame" label="Game" :disabled="off" :options="[{ value: 'satisfactory', label: 'Satisfactory' }, { value: 'enshrouded', label: 'Enshrouded' }, { value: 'poe2', label: 'Path of Exile 2' }]" />
    </div>
    <div class="flex flex-col items-start gap-2">
      <span class="text-muted-foreground text-xs">Menu</span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="secondary" :disabled="off" class="min-w-44 justify-between">More <ChevronDown :stroke-width="1.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>
