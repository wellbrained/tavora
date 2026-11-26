<script setup lang="ts">
// The foot of a palette: the keys it takes, as key caps with a few words ("↑ ↓ to move", "Enter to open", "Esc to
// close"). Screen readers skip it: the list says the same with its roles. The default slot sits at the right end, for a
// way out such as a link.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { Kbd } from "../kbd"
import type { PaletteHint } from "./types"

const props = defineProps<{
  hints: PaletteHint[]
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div data-slot="palette-footer" :class="cn('text-muted-foreground flex flex-none flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-xs', props.class)">
    <span class="flex flex-wrap items-center gap-x-4 gap-y-1" aria-hidden="true">
      <span v-for="hint in hints" :key="hint.label" data-slot="palette-hint" class="inline-flex items-center gap-1">
        <Kbd v-for="key in hint.keys" :key="key" class="font-sans">{{ key }}</Kbd>
        <span class="ml-0.5">{{ hint.label }}</span>
      </span>
    </span>
    <span v-if="$slots.default" class="ml-auto flex items-center gap-4"><slot /></span>
  </div>
</template>
