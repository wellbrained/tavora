<script setup lang="ts">
// A to-do row's menu entries (rowMenu in row.ts) as kit menu items, inside the caller's DropdownMenuContent: the
// panel's rows and the list over the game show the same menu.
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "@tavora/official-ui/components/ui/dropdown-menu";
import type { RowAction, RowMenuEntry } from "./row";

defineProps<{ entries: RowMenuEntry[] }>();
const emit = defineEmits<{ choose: [action: RowAction] }>();
</script>

<template>
  <template v-for="(entry, at) in entries" :key="entry.type === 'item' ? entry.id : `${entry.type}-${at}`">
    <DropdownMenuSeparator v-if="entry.type === 'separator'" />
    <DropdownMenuSub v-else-if="entry.type === 'submenu'">
      <DropdownMenuSubTrigger><component :is="entry.icon" /> {{ entry.label }}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem v-for="item in entry.items" :key="item.id" @select="emit('choose', item.id)">
          {{ item.label }}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
    <DropdownMenuItem
      v-else
      :variant="entry.danger ? 'destructive' : 'default'"
      :disabled="entry.disabled"
      :disabled-reason="entry.disabledReason"
      :data-testid="entry.testid"
      @select="emit('choose', entry.id)"
    >
      <component :is="entry.icon" v-if="entry.icon" /> {{ entry.label }}
    </DropdownMenuItem>
  </template>
</template>
