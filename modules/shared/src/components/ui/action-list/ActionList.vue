<script setup lang="ts">
// A short list of things to do, each with an icon, a name and one line: for the empty-state `action` slot
// or a panel's start page. The rows look like the ones in a menu (`DropdownMenuItem` with a description).
// Give each entry an `icon` component, or fill the `icon` slot for anything else, such as a picture.
import type { Component } from "vue"
import { Button } from "../button"
import { ActionRow } from "../action-row"

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
    <Button
      v-for="entry in entries"
      :key="entry.id"
      type="button"
      variant="ghost"
      class="h-auto w-full justify-start gap-3 p-2.5 font-normal"
      :disabled="entry.disabled"
      :data-testid="entry.testid"
      @click="emit('select', entry.id)"
    >
      <ActionRow :description="entry.description">
        <template v-if="entry.icon || $slots.icon" #icon>
          <slot name="icon" :entry="entry"><component :is="entry.icon" v-if="entry.icon" :stroke-width="1.6" /></slot>
        </template>
        {{ entry.label }}
      </ActionRow>
    </Button>
  </div>
</template>
