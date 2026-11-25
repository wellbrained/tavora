<script setup lang="ts">
// The thing a HoverCard is for: hovering it, or reaching it with the keyboard, opens the card. With `as-child` it is
// your own element; something that can't take the focus by itself (a name, a picture) gets `focusable`.
import { Primitive, type PrimitiveProps } from "reka-ui"
import { computed } from "vue"
import { injectHoverCard } from "./context"

const props = withDefaults(defineProps<PrimitiveProps & {
  /** Lets the keyboard reach a trigger that can't take the focus by itself, so its card opens by keyboard too. */
  focusable?: boolean
}>(), { as: "span" })

const controller = injectHoverCard("HoverCardTrigger")
const bound = computed(() => controller.on(true, { focusable: props.focusable }))
</script>

<template>
  <Primitive data-slot="hover-card-trigger" :as="as" :as-child="asChild" v-bind="bound">
    <slot />
  </Primitive>
</template>
