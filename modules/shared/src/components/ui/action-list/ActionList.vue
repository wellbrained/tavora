<script setup lang="ts">
// A short list of things to do, each with an icon, a name and one line: for the empty-state `action` slot
// or a panel's start page. The rows look like the ones in a menu (`DropdownMenuItem` with a description); each is a `ListRow`.
// Give each entry an `icon` component, or fill the `icon` slot for anything else, such as a picture.
import type { Component } from "vue"
import { ACTION_ICON_TILE } from "../action-row"
import { ListRow } from "../list-row"

export interface ActionEntry {
  id: string
  label: string
  description?: string
  icon?: Component
  disabled?: boolean
  testid?: string
}

defineProps<{ entries: ActionEntry[] }>()
const emit = defineEmits<{ select: [id: string] }>()
</script>

<template>
  <div data-slot="action-list" class="flex max-w-[350px] flex-col gap-1">
    <ListRow
      v-for="entry in entries"
      :key="entry.id"
      wrap
      class="gap-3 p-2.5"
      :disabled="entry.disabled"
      :data-testid="entry.testid"
      @click="emit('select', entry.id)"
    >
      <template v-if="entry.icon || $slots.icon" #leading>
        <span data-slot="action-row-icon" :class="ACTION_ICON_TILE" aria-hidden="true">
          <slot name="icon" :entry="entry"><component :is="entry.icon" v-if="entry.icon" /></slot>
        </span>
      </template>
      <span class="font-semibold">{{ entry.label }}</span>
      <template v-if="entry.description" #description>{{ entry.description }}</template>
    </ListRow>
  </div>
</template>
