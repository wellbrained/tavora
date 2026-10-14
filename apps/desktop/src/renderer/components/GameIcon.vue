<script setup lang="ts">
import { computed } from "vue";
import type { GameView } from "../../shared/host-api";

const props = withDefaults(defineProps<{ game: GameView; size?: number }>(), { size: 48 });

// Muted, warm tones that keep ivory text readable. Picked by id so a game
// keeps its colour when renamed.
const TONES = ["#6b4f2a", "#5a3d36", "#3f4a3a", "#3b4656", "#5b4a63", "#4d4a3c", "#64422a", "#37504f"];

const tone = computed(() => {
  let hash = 0;
  for (const char of props.game.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
});
// Small icons (folder collages) show only the first letter.
const text = computed(() => {
  const full = props.game.icon.kind === "monogram" ? props.game.icon.text : "";
  return props.size < 32 ? [...full].slice(0, 1).join("") : full;
});
const fontSize = computed(() => Math.max(12, Math.round(props.size * ([...text.value].length > 2 ? 0.3 : 0.38))));
</script>

<template>
  <span
    class="inline-flex flex-none overflow-hidden shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size / 4)}px` }"
    aria-hidden="true"
  >
    <img v-if="game.icon.kind === 'image'" class="size-full object-cover" :src="game.icon.url" alt="" draggable="false" />
    <span
      v-else
      class="text-foreground flex size-full items-center justify-center font-semibold tracking-wide"
      :style="{ background: tone, fontSize: `${fontSize}px` }"
      >{{ text }}</span
    >
  </span>
</template>
