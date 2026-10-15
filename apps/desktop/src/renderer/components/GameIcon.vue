<script setup lang="ts">
import { computed } from "vue";
import type { GameView } from "../../shared/host-api";
import { gameBadgeLook } from "../game-badge";

const props = withDefaults(defineProps<{ game: GameView; size?: number }>(), { size: 48 });

// Tone and pattern come from the id, so a game keeps its look when renamed.
const look = computed(() => gameBadgeLook(props.game.id));
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
      :style="{
        backgroundColor: look.color,
        backgroundImage: look.image,
        backgroundSize: look.size,
        fontSize: `${fontSize}px`,
      }"
      >{{ text }}</span
    >
  </span>
</template>
