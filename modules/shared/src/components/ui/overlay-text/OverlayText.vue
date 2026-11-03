<script setup lang="ts">
// An overlay text in its box, for a page with Vue (overlay-text.ts does the work; a page without Vue uses it directly).
// Size what is in the slot with `calc(<natural px> * var(--overlay-text-scale))`, and give the box its size from outside:
// in "grow" the text is scaled to the box, in "fixed" it keeps its size and scrolls, shrinks or is cut off when too long.
// A new `textKey` (the next song) starts a scroll from the beginning; other changes (a counter ticks) let it run on.
import { onBeforeUnmount, onMounted, onUpdated, useTemplateRef, watch } from "vue";
import { mountOverlayText, type OverlayText, type OverlayTextOptions } from "./overlay-text";
import { OVERLAY_TEXT_DEFAULTS } from "./plan";

const props = withDefaults(defineProps<Partial<OverlayTextOptions> & { textKey?: string }>(), {
  mode: OVERLAY_TEXT_DEFAULTS.mode,
  overflow: OVERLAY_TEXT_DEFAULTS.overflow,
  speed: OVERLAY_TEXT_DEFAULTS.speed,
  pause: OVERLAY_TEXT_DEFAULTS.pause,
  softEdges: OVERLAY_TEXT_DEFAULTS.softEdges,
  align: "center",
  padding: 0,
  gap: 48,
  textKey: "",
});

const root = useTemplateRef<HTMLElement>("root");
const track = useTemplateRef<HTMLElement>("track");
const content = useTemplateRef<HTMLElement>("content");
let text: OverlayText | undefined;

const options = (): OverlayTextOptions => ({ mode: props.mode, overflow: props.overflow, speed: props.speed, pause: props.pause, softEdges: props.softEdges, align: props.align, padding: props.padding, gap: props.gap });

onMounted(() => {
  text = mountOverlayText(root.value!, options(), { track: track.value!, content: content.value! });
  text.fit();
  // A font still loading would measure wrong.
  void document.fonts?.ready.then(() => text?.fit());
});
watch(options, (next) => text?.set(next));
watch(
  () => props.textKey,
  () => text?.changed(true),
);
onUpdated(() => text?.changed());
onBeforeUnmount(() => text?.destroy());
</script>

<template>
  <div ref="root" data-slot="overlay-text">
    <div ref="track" class="tavora-overlay-text-track">
      <div ref="content" class="tavora-overlay-text-content"><slot /></div>
    </div>
  </div>
</template>
