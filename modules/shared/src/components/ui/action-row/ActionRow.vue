<script setup lang="ts">
// The inside of a menu item or list button that has an icon, a name and one line under it.
// It has no frame of its own: DropdownMenuItem puts it in its own. ActionList builds the same row on ListRow.
import { ACTION_ICON_TILE } from "./icon-tile"

defineProps<{ description?: string }>()
</script>

<template>
  <span v-if="$slots.icon" data-slot="action-row-icon" :class="ACTION_ICON_TILE" aria-hidden="true"><slot name="icon" /></span>
  <span class="flex min-w-0 flex-1 flex-col gap-0.5 text-left whitespace-normal">
    <span class="text-sm font-semibold"><slot /></span>
    <span v-if="description" class="text-muted-foreground text-xs font-normal [overflow-wrap:anywhere]">{{ description }}</span>
  </span>
</template>
