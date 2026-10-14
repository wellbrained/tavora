<script setup lang="ts">
import { Ellipsis } from "@lucide/vue";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFloating, type MenuItem } from "@/host";
import MenuEntries from "./MenuEntries.vue";

defineProps<{ items: () => MenuItem[]; title: string; testid: string; label: string }>();
const track = useFloating();
</script>

<template>
  <DropdownMenu @update:open="track">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="text-muted-foreground hover:bg-card hover:text-foreground data-[state=open]:bg-card grid size-7 place-items-center rounded-sm"
        :data-testid="testid"
        :aria-label="label"
      >
        <Ellipsis class="size-4" :stroke-width="1.5" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-testid="menu" side="right" align="start" class="max-w-72 min-w-52">
      <DropdownMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ title }}</DropdownMenuLabel>
      <MenuEntries :items="items()" kind="dropdown" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
