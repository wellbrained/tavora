<script setup lang="ts">
import { Ellipsis } from "@lucide/vue";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useFloating, type MenuItem } from "@/host";
import MenuEntries from "./MenuEntries.vue";

// The ⋯ button by default; the slot replaces its icon, e.g. with a label.
withDefaults(
  defineProps<{
    items: () => MenuItem[];
    title: string;
    testid: string;
    label: string;
    side?: "right" | "bottom";
    align?: "start" | "end";
    class?: string;
  }>(),
  { side: "right", align: "start", class: undefined },
);
const track = useFloating();
</script>

<template>
  <DropdownMenu @update:open="track">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'text-muted-foreground hover:bg-card hover:text-foreground data-[state=open]:bg-card grid size-7 place-items-center rounded-sm',
            $props.class,
          )
        "
        :data-testid="testid"
        :aria-label="label"
      >
        <slot><Ellipsis class="size-4" :stroke-width="1.5" /></slot>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-testid="menu" :side="side" :align="align" class="max-w-72 min-w-52">
      <DropdownMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ title }}</DropdownMenuLabel>
      <MenuEntries :items="items()" kind="dropdown" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
