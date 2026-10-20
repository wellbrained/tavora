<script setup lang="ts">
// Right-click (or the keyboard menu key) on the wrapped element opens its menu.
import { ContextMenu, ContextMenuContent, ContextMenuLabel, ContextMenuTrigger } from "@tavora/official-ui/components/ui/context-menu";
import { useFloating, type MenuItem } from "@/host";
import MenuEntries from "./MenuEntries.vue";

defineProps<{ items: () => MenuItem[]; title: string }>();
const track = useFloating();
</script>

<template>
  <ContextMenu @update:open="track">
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent data-testid="menu" class="max-w-72 min-w-52">
      <ContextMenuLabel class="text-muted-foreground truncate text-xs font-normal">{{ title }}</ContextMenuLabel>
      <MenuEntries :items="items()" kind="context" />
    </ContextMenuContent>
  </ContextMenu>
</template>
