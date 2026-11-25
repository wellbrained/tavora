<script setup lang="ts">
// A button of your own in the card that closes it and gives the focus back to its target. A pinned card already
// shows a close X in its corner; this is for a "Done" or "Cancel" of yours.
import { Primitive, type PrimitiveProps } from "reka-ui"
import { injectHoverCard } from "./context"

const props = withDefaults(defineProps<PrimitiveProps>(), { as: "button" })
const controller = injectHoverCard("HoverCardClose")
</script>

<template>
  <Primitive data-slot="hover-card-close" :as="props.as" :as-child="props.asChild" :type="props.as === 'button' && !props.asChild ? 'button' : undefined" @click="controller.close({ returnFocus: true })">
    <slot />
  </Primitive>
</template>
