<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GameView } from "../../shared/host-api";
import { gameBadgeLook } from "../game-badge";

const props = withDefaults(defineProps<{ game: GameView; size?: number }>(), { size: 48 });

// Tone and pattern come from the id, so a game keeps its look when renamed.
const look = computed(() => gameBadgeLook(props.game.id));
// An image the player picked always wins; then the game's own Steam icon; then the badge.
const steamIcon = computed(() => (props.game.icon.kind === "monogram" ? props.game.steamIcon : null));
// An icon that cannot be shown falls back to the badge instead of a broken image.
const iconFailed = ref(false);
watch(steamIcon, () => (iconFailed.value = false));
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
    <template v-else-if="steamIcon && !iconFailed">
      <!-- Steam's own icon, unchanged, on a tile in the game's tone: it is small and often transparent. -->
      <span
        class="flex size-full items-center justify-center"
        :style="{ backgroundColor: look.color, backgroundImage: 'linear-gradient(160deg, rgb(255 255 255 / 0.10), rgb(0 0 0 / 0.18))' }"
      >
        <img
          class="object-contain"
          :style="{ width: '88%', height: '88%', filter: 'saturate(0.95) contrast(1.02) drop-shadow(0 1px 1px rgb(0 0 0 / 0.35))' }"
          :src="steamIcon"
          alt=""
          draggable="false"
          @error="iconFailed = true"
        />
      </span>
      <!-- Tavora's border ring on top. -->
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
