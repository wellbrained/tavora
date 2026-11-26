<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import type { BadgeVariants } from "."
import { Primitive } from "reka-ui"
import { cn } from "../../../lib/utils"
import { badgeVariants } from "."

const props = withDefaults(defineProps<PrimitiveProps & {
  variant?: BadgeVariants["variant"]
  /** `sm`: tight padding. */
  size?: "default" | "sm"
  /** Even-width digits, for counts, levels and times. */
  numeric?: boolean
  class?: HTMLAttributes["class"]
}>(), {
  as: "span",
})
</script>

<template>
  <Primitive
    data-slot="badge"
    :as="as"
    :as-child="asChild"
    :class="cn(badgeVariants({ variant, size, numeric }), props.class)"
  >
    <slot />
  </Primitive>
</template>
