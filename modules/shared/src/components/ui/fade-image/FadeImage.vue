<script setup lang="ts">
// A picture that may arrive late. Its box is there from the start (give it a size or an aspect ratio with `class`) with
// a muted placeholder in it, so nothing shifts; the picture fades in when it has loaded. A picture that fails to load,
// or has no `src`, shows the `fallback` slot instead (an icon, say), or just the muted box.
// The muted box stays behind the picture (a tile); with `:tile="false"` it is only the placeholder, gone once the picture is there,
// so an icon with see-through parts shows what is behind it.
// Attributes other than `class` (alt, data-testid, draggable…) go to the <img>; `class` is the box.
import { computed, onMounted, ref, useAttrs, watch } from "vue";
import type { ClassValue } from "clsx";
import { cn } from "../../../lib/utils";

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ src?: string | null; fit?: "cover" | "contain"; pending?: boolean; tile?: boolean }>(), { src: null, fit: "cover", pending: false, tile: true });

const attrs = useAttrs();
const imgAttrs = computed(() => {
  const { class: _, ...rest } = attrs;
  return rest;
});
const image = ref<HTMLImageElement | null>(null);
const loaded = ref(false);
const failed = ref(false);

watch(
  () => props.src,
  () => {
    loaded.value = false;
    failed.value = false;
  },
);
// A picture that is already in the cache is there before the first paint: it shows at once, with no fade.
onMounted(() => {
  if (image.value?.complete && image.value.naturalWidth > 0) loaded.value = true;
});

/** The picture is on its way (or about to be): the box is muted and empty, with no fallback yet. */
const waiting = computed(() => props.pending || (!!props.src && !loaded.value && !failed.value));
const showFallback = computed(() => !waiting.value && (!props.src || failed.value));
</script>

<template>
  <span :class="cn('relative block overflow-hidden', (tile || !loaded) && 'bg-muted/60', $attrs.class as ClassValue)" data-slot="fade-image">
    <img
      v-if="src && !failed"
      ref="image"
      :key="src"
      :src="src"
      v-bind="imgAttrs"
      :class="cn('absolute inset-0 size-full opacity-0 transition-opacity duration-[var(--duration-panel)] ease-[var(--ease-out-strong)]', fit === 'cover' ? 'object-cover' : 'object-contain', loaded && 'opacity-100')"
      @load="loaded = true"
      @error="failed = true"
    />
    <span v-if="showFallback" class="absolute inset-0 grid place-items-center"><slot name="fallback" /></span>
  </span>
</template>

<style>
/* Reduced motion keeps the fade, short; the global rule would make it a blink. */
@media (prefers-reduced-motion: reduce) {
  [data-slot="fade-image"] > img {
    transition-duration: 100ms !important;
  }
}
</style>
