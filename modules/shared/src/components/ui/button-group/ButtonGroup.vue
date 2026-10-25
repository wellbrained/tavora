<script setup lang="ts">
// Buttons joined into one control, such as an action with its ▾ menu (a split
// button). The inner corners close up, and one thin line divides the parts:
// outline buttons share their border, filled ones get a line in the border colour.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"

const props = defineProps<{ class?: HTMLAttributes["class"]; label?: string }>()
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    data-slot="button-group"
    :class="cn(
      'flex w-fit items-stretch [&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l [&>*:not(:last-child)]:rounded-r-none [&>*:not(:last-child)]:border-r-0 [&>*:focus-visible]:z-10',
      props.class,
    )"
  >
    <slot />
  </div>
</template>
