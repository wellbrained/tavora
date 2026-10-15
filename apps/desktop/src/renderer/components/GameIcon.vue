<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GameView } from "../../shared/host-api";
import { gameBadgeLook } from "../game-badge";
import { backdropOf, iconTone, toneOf, type IconTone } from "../icon-tone";

const props = withDefaults(defineProps<{ game: GameView; size?: number }>(), { size: 48 });

// Tone and pattern come from the id, so a game keeps its look when renamed.
const look = computed(() => gameBadgeLook(props.game.id));
// An image the player picked always wins; then the game's own icon (from the installed game or Steam); then the badge.
const steamIcon = computed(() => (props.game.icon.kind === "monogram" ? props.game.steamIcon : null));
// An icon that cannot be shown falls back to the badge instead of a broken image.
const iconFailed = ref(false);
watch(steamIcon, () => (iconFailed.value = false));
// How the game's own icon sits in the tile depends on the picture, see icon-tone.ts.
const tone = ref<IconTone>("onDark");
watch(
  steamIcon,
  (url) => {
    tone.value = url ? (toneOf(url) ?? "onDark") : "onDark";
  },
  { immediate: true },
);
function onIconLoad(event: Event) {
  const url = steamIcon.value;
  if (url) tone.value = iconTone(url, event.target as HTMLImageElement);
}
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
      <!-- The game's own icon, unchanged. A picture with no see-through parts fills the tile, so no tile colour or ring shows around it;
           one with see-through parts sits on a plain light or dark backdrop that contrasts with it. -->
      <img
        v-if="tone === 'opaque'"
        class="size-full object-cover"
        :src="steamIcon"
        alt=""
        draggable="false"
        @load="onIconLoad"
        @error="iconFailed = true"
      />
      <span v-else class="flex size-full items-center justify-center" :style="{ backgroundImage: backdropOf(tone) }">
        <img class="object-contain" style="width: 84%; height: 84%" :src="steamIcon" alt="" draggable="false" @load="onIconLoad" @error="iconFailed = true" />
      </span>
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
