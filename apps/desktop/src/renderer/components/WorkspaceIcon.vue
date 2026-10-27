<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { WorkspaceView } from "../../shared/host-api";
import { badgeLook } from "../badge";
import { backdropOf } from "../icon-tone";

const props = withDefaults(defineProps<{ workspace: WorkspaceView; size?: number }>(), { size: 48 });

// Tone and pattern come from the id, so a workspace keeps its look when renamed.
const look = computed(() => badgeLook(props.workspace.id));
// An image the user picked always wins; then its game's own icon (from the installed game or Steam); then the badge.
const steamIcon = computed(() => (props.workspace.icon.kind === "monogram" ? props.workspace.steamIcon : null));
// An icon that cannot be shown falls back to the badge instead of a broken image.
const iconFailed = ref(false);
watch(steamIcon, () => (iconFailed.value = false));
// How a game's own icon sits in the tile depends on the picture; the host works it out (shared/icon-tone.ts).
const tone = computed(() => props.workspace.steamIconTone ?? "onDark");
// Small icons (folder collages) show only the first letter.
const text = computed(() => {
  const full = props.workspace.icon.kind === "monogram" ? props.workspace.icon.text : "";
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
    <img v-if="workspace.icon.kind === 'image'" class="size-full object-cover" :src="workspace.icon.url" alt="" draggable="false" />
    <template v-else-if="steamIcon && !iconFailed">
      <!-- The game's own icon, unchanged. A picture with no see-through parts fills the tile, so no tile colour or ring shows around it;
           one with see-through parts sits on a plain light or dark backdrop that contrasts with it. -->
      <img
        v-if="tone === 'opaque'"
        class="size-full object-cover"
        :src="steamIcon"
        alt=""
        draggable="false"
        @error="iconFailed = true"
      />
      <span v-else class="flex size-full items-center justify-center" :style="{ backgroundImage: backdropOf(tone) }">
        <img class="object-contain" style="width: 84%; height: 84%" :src="steamIcon" alt="" draggable="false" @error="iconFailed = true" />
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
