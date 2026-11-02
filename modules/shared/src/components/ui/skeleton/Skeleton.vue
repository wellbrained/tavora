<script setup lang="ts">
// A placeholder for something that loads. Put the REAL template inside, filled with placeholder data, and say when
// it is loading: while it is, every text, icon, picture and button in it turns into a muted bar of the same box
// (skeleton.css), so the placeholder matches the content exactly. Loading that ends within the delay shows nothing;
// longer loading shows the bars with a slow pulse (not with reduced motion), and the content fades in over them.
// Keep the wrapper to the part that loads: the pulse is on the whole wrapper, and so is `inert` + `aria-hidden` while it
// waits (the placeholder can't be focused, clicked or read; a screen reader gets a status text kept outside the wrapper).
// What is already known (a toolbar, a title) belongs outside it.
import { computed } from "vue";
import { useSkeleton, SKELETON_DELAY } from "./use-skeleton";
import "./skeleton.css";

const props = withDefaults(defineProps<{ loading: boolean; as?: string; delay?: number }>(), { as: "div", delay: SKELETON_DELAY });
const state = useSkeleton(
  () => props.loading,
  () => props.delay,
);
/** The made-up content is on screen or about to be: nothing in it is real. */
const placeholder = computed(() => state.value === "waiting" || state.value === "on");
</script>

<template>
  <component :is="as" data-slot="skeleton" :data-skeleton="state === 'idle' ? undefined : state" :inert="placeholder ? '' : undefined" :aria-hidden="placeholder ? 'true' : undefined">
    <slot />
  </component>
</template>
