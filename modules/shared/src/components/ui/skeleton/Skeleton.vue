<script setup lang="ts">
// A placeholder for something that loads. Put the REAL template inside, filled with placeholder data, and say when
// it is loading: while it is, every text, icon, picture and button in it turns into a muted bar of the same box
// (skeleton.css), so the placeholder matches the content exactly. Loading that ends within the delay shows nothing;
// longer loading shows the bars with a slow pulse (not with reduced motion), and the content fades in over them.
// Keep the wrapper to the part that loads: the pulse is on the whole wrapper.
import { useSkeleton, SKELETON_DELAY } from "./use-skeleton";
import "./skeleton.css";

const props = withDefaults(defineProps<{ loading: boolean; as?: string; delay?: number }>(), { as: "div", delay: SKELETON_DELAY });
const state = useSkeleton(
  () => props.loading,
  () => props.delay,
);
</script>

<template>
  <component :is="as" data-slot="skeleton" :data-skeleton="state === 'idle' ? undefined : state" :aria-busy="loading || undefined">
    <slot />
  </component>
</template>
