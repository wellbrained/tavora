<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GameView } from "../../shared/host-api";
import { gameBadgeLook } from "../game-badge";

const props = withDefaults(defineProps<{ game: GameView; size?: number }>(), { size: 48 });

// Tone and pattern come from the id, so a game keeps its look when renamed.
const look = computed(() => gameBadgeLook(props.game.id));
// An image the player picked always wins; then the game's Steam cover; then the badge.
const art = computed(() => (props.game.icon.kind === "monogram" ? props.game.art : null));
// A cover that cannot be shown falls back to the badge instead of a broken image.
const artFailed = ref(false);
watch(art, () => (artFailed.value = false));
// Small icons (folder collages) show only the first letter.
const text = computed(() => {
  const full = props.game.icon.kind === "monogram" ? props.game.icon.text : "";
  return props.size < 32 ? [...full].slice(0, 1).join("") : full;
});
const fontSize = computed(() => Math.max(12, Math.round(props.size * ([...text.value].length > 2 ? 0.3 : 0.38))));
</script>

<template>
  <span
    class="relative inline-flex flex-none overflow-hidden shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size / 4)}px` }"
    aria-hidden="true"
  >
    <img v-if="game.icon.kind === 'image'" class="size-full object-cover" :src="game.icon.url" alt="" draggable="false" />
    <template v-else-if="art && !artFailed">
      <!-- The original cover, cropped square by the browser; the file itself is never changed. -->
      <img
        class="size-full object-cover"
        :src="art"
        alt=""
        draggable="false"
        style="filter: saturate(0.92) contrast(1.03) sepia(0.06)"
        @error="artFailed = true"
      />
      <!-- Tavora's look: a faint tint in the game's own tone, and the border ring on top. -->
      <span class="pointer-events-none absolute inset-0" :style="{ backgroundColor: look.color, mixBlendMode: 'soft-light', opacity: 0.4 }" />
      <span class="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]" :style="{ borderRadius: 'inherit' }" />
    </template>
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
