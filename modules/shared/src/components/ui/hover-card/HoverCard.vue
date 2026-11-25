<script setup lang="ts">
// A card that opens beside something on hover or keyboard focus and that you can move into: it holds links and
// buttons, and a pinnable one stays open with a close button. For one target:
//
//   <HoverCard pinnable>
//     <HoverCardTrigger as-child><span>Frost Ward</span></HoverCardTrigger>
//     <HoverCardContent title="Frost Ward">…</HoverCardContent>
//   </HoverCard>
//
// For many targets, one card moved between them: `useHoverCard()` and `<HoverCard v-bind="card.props">`.
import { PopoverAnchor, PopoverRoot } from "reka-ui"
import { provide } from "vue"
import { hoverCardKey } from "./context"
import { useHoverCard, type UseHoverCard } from "./use-hover-card"

const props = withDefaults(defineProps<{
  /** From `useHoverCard()`, for one card shared by many targets. Without it, the card is for its HoverCardTrigger. */
  controller?: UseHoverCard<unknown>
  /** The wait before it opens on hover, in ms. */
  openDelay?: number
  /** How long it stays after the pointer leaves, in ms. */
  closeDelay?: number
  /** A click on the trigger pins the card, with a close button. Not on buttons and links: a click there does what it does. */
  pinnable?: boolean
}>(), { openDelay: 400, closeDelay: 200, pinnable: false })

// Read when they are needed, so a changed prop counts.
const controller = props.controller ?? useHoverCard({
  get openDelay() { return props.openDelay },
  get closeDelay() { return props.closeDelay },
  get pinnable() { return props.pinnable },
})
provide(hoverCardKey, controller)
</script>

<template>
  <PopoverRoot :open="controller.open" :modal="false" @update:open="open => { if (!open) controller.close() }">
    <PopoverAnchor v-if="controller.target" as="template" :reference="controller.target" />
    <slot :content="controller.content" :pinned="controller.pinned" :close="controller.close" />
  </PopoverRoot>
</template>
