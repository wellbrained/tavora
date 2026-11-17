<script setup lang="ts">
// The faint edge around a picture: on by default for one that fills its box, off by hand for one inside a frame.
import { FadeImage } from "@tavora/official-ui/components/ui/fade-image";

// A dark picture, so the edge shows against a dark card.
const DARK = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%23181a20'/%3E%3C/svg%3E";
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <FadeImage :src="DARK" class="size-16 rounded-xl" alt="" data-testid="edge-default" />
    <FadeImage :src="DARK" :edge="false" class="size-16 rounded-xl" alt="" data-testid="edge-off" />
    <FadeImage :src="DARK" fit="contain" :edge="true" class="size-16 rounded-xl" alt="" data-testid="edge-on" />
  </div>
</template>
