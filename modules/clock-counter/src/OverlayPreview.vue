<script setup lang="ts">
// The overlay of an item as it is drawn for OBS and over the game, in the settings: the same view (overlay-view.ts) that the overlay
// page uses. A text that grows with its box is shown at its natural size (it shrinks to fit, never grows); a fixed box is the
// preview itself, so a long text scrolls, shrinks or is cut off as it will on stream. A running clock goes on ticking. Put it
// in a SettingsPreview.
import { computed, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue";
import type { OverlayState } from "./items";
import { mountOverlayView, type OverlayView } from "./overlay-view";

const props = defineProps<{ state: OverlayState }>();
const host = useTemplateRef<HTMLElement>("host");
let view: OverlayView | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let observer: ResizeObserver | undefined;

const draw = () => view?.draw(props.state);
const ticking = computed(() => props.state.kind === "clock" && props.state.clock.since !== null);

onMounted(() => {
  const element = host.value!;
  view = mountOverlayView(element, { padding: 0, scaleBy: "down" });
  draw();
  observer = new ResizeObserver(() => view?.fit());
  observer.observe(element);
  // The fonts may still be loading; a wider one would run off the preview.
  void document.fonts.ready.then(() => view?.fit());
});

watch(() => props.state, draw, { deep: true });
watch(
  ticking,
  (on) => {
    clearInterval(timer);
    if (on) timer = setInterval(draw, 250);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearInterval(timer);
  observer?.disconnect();
});
</script>

<template>
  <div ref="host" class="h-full w-full" data-testid="overlay-preview" />
</template>
