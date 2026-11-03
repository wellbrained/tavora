<script setup lang="ts">
// A fixed box (like OBS's bounding box with a Scroll filter): the text keeps its size and alignment and is never made bigger.
// A text too long scrolls (with a pause and soft edges), shrinks, or is cut off. The boxes stand on a dark plate because
// overlays are drawn over a game; the plate and the text take the theme's tokens.
import { OverlayText } from "@tavora/official-ui/components/ui/overlay-text";

const LONG = "Now playing: The very long song name of the album version";
const ROWS = [
  { label: "Short text keeps its size, sits left", text: "12 Deaths", overflow: "scroll", align: "left" },
  { label: "Fits: no scrolling", text: "Boss in 4:59", overflow: "scroll", align: "center" },
  { label: "Too long → Scroll: pause, run through, loop", text: LONG, overflow: "scroll", align: "left" },
  { label: "Too long → Shrink", text: LONG, overflow: "shrink", align: "left" },
  { label: "Too long → Cut off", text: LONG, overflow: "clip", align: "left" },
] as const;
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="row in ROWS" :key="row.label" class="flex flex-col gap-1">
      <span class="text-muted-foreground text-xs">{{ row.label }}</span>
      <OverlayText mode="fixed" :overflow="row.overflow" :align="row.align" :padding="8" class="bg-foreground text-background h-12 w-full max-w-80 rounded-md">
        <div class="font-semibold" style="font-size: calc(20px * var(--overlay-text-scale))">{{ row.text }}</div>
      </OverlayText>
    </div>
  </div>
</template>
