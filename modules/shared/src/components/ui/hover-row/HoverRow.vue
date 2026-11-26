<script setup lang="ts">
// A row (or any block) that shows a card on hover or keyboard focus but isn't a button: a skill with its numbers, a
// power-up, a line in a list of stats. It lights up like a ghost Button when you point at it, takes the kit's focus
// ring from the keyboard, and doesn't dip or do anything on a click. Bind the card on it:
//
//   <HoverRow v-bind="tip.on(card)">…anything…</HoverRow>
//
// It is in the Tab order by itself, so its card shows from the keyboard too. The fill reaches a little past the content
// (`inset`, 4 px above and below, 6 px at the sides), so the row neither moves nor grows; `inset="0"` keeps it inside.
// Something you can click is a ListRow or a Button instead.
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import "./hover-row.css"

const props = withDefaults(defineProps<{
  /** The element: a `div` (the default), an `li` in your own list, or a `span` inside a line. */
  as?: "div" | "li" | "span"
  /** How far the fill reaches past the content, as CSS `inset` (default "-4px -6px"). */
  inset?: string
  class?: HTMLAttributes["class"]
}>(), { as: "div" })
</script>

<template>
  <component
    :is="as"
    data-slot="hover-row"
    tabindex="0"
    :class="cn('tavora-hover-row', props.class)"
    :style="inset ? { '--hover-row-inset': inset } : undefined"
  >
    <slot />
  </component>
</template>
