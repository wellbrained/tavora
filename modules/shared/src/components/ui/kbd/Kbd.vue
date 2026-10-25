<script setup lang="ts">
// One key of a keyboard shortcut, drawn as a key cap. Put several side by side for a combination.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<{ class?: HTMLAttributes["class"] }>()
</script>

<template>
  <kbd
    data-slot="kbd"
    :class="cn('bg-secondary text-foreground inline-block min-w-7 rounded-sm border border-b-2 px-1.5 py-0.5 text-center font-mono text-xs', props.class)"
  >
    <slot />
  </kbd>
</template>
