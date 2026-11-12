<script setup lang="ts">
// A game's tall cover, 2:3 like a store's: its art, which may arrive late (a FadeImage, so nothing moves), else the
// `fallback` slot (the game's tile, say) in the middle of the box. `busy` lays a spinner over it while something happens
// to the game. Decorative: say the game's name next to it. Size it with `class` (it is as wide as its box by default).
import { Loader } from "@lucide/vue"
import type { HTMLAttributes } from "vue"
import { cn } from "../../../lib/utils"
import { FadeImage } from "../fade-image"

const props = withDefaults(
  defineProps<{
    /** The art's address; null for none: the fallback shows. */
    src?: string | null
    /** The art is still being looked for: the box stays muted and empty instead of showing the fallback. */
    pending?: boolean
    /** Something is happening to the game (it is being added): a spinner over the cover. */
    busy?: boolean
    class?: HTMLAttributes["class"]
  }>(),
  { src: null, pending: false, busy: false },
)
</script>

<template>
  <span data-slot="game-cover" :data-busy="busy || undefined" :class="cn('relative block aspect-[2/3] w-full overflow-hidden rounded-md', props.class)" aria-hidden="true">
    <FadeImage class="size-full" :src="src" :pending="pending" alt="" draggable="false">
      <template #fallback><slot name="fallback" /></template>
    </FadeImage>
    <span v-if="busy" class="bg-background/60 absolute inset-0 grid place-items-center">
      <Loader class="size-6 animate-spin motion-reduce:animate-none" :stroke-width="1.75" />
    </span>
  </span>
</template>
