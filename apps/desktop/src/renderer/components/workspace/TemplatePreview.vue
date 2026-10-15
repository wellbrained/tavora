<script setup lang="ts">
// A layout template drawn small: one outlined box per slot.
import { computed } from "vue";
import { templateRects, type LayoutTemplate } from "../../../shared/layout-templates";

const props = defineProps<{ template: LayoutTemplate }>();

const WIDTH = 48;
const HEIGHT = 32;
const GAP = 2;
const rects = computed(() =>
  templateRects(props.template).map((rect) => ({
    x: rect.x * (WIDTH + GAP),
    y: rect.y * (HEIGHT + GAP),
    width: rect.width * (WIDTH + GAP) - GAP,
    height: rect.height * (HEIGHT + GAP) - GAP,
  })),
);
</script>

<template>
  <svg :viewBox="`-1 -1 ${WIDTH + 2} ${HEIGHT + 2}`" aria-hidden="true">
    <rect
      v-for="(rect, index) in rects"
      :key="index"
      v-bind="rect"
      rx="2"
      fill="currentColor"
      fill-opacity="0.15"
      stroke="currentColor"
      stroke-width="1"
    />
  </svg>
</template>
