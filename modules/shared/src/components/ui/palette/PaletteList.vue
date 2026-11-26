<script setup lang="ts">
// The rows of a palette: a listbox the search field above it drives (PaletteSearch `list` = this `id`). It holds
// PaletteGroups or PaletteItems. A press on it doesn't take the focus, so the field keeps it and the arrow keys and Enter
// go on working after a click. `busy` while a picked row is being done (adding a game). Scrolling is the caller's
// (a `max-h-*` and `overflow-y-auto` on it, or on a box around it that holds more).
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<{
  id: string
  /** What the list is, read out with it. */
  label: string
  busy?: boolean
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    :id="id"
    role="listbox"
    data-slot="palette-list"
    :aria-label="label"
    :aria-busy="busy || undefined"
    :class="cn('flex flex-col p-2', props.class)"
    @mousedown.prevent
  >
    <slot />
  </div>
</template>
