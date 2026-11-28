<script setup lang="ts">
// How the page's settings look, over a backdrop the user can switch: a game-like scene, light or
// dark. Overlay pages start on the game scene, panel pages on dark; the choice is remembered.
// The switch is the kit's segmented control (one Tab stop, arrow keys move).
import { useLocalStorage } from "@vueuse/core";
import { computed } from "vue";
import { cn } from "../../../lib/utils";
import { SegmentedControl } from "../segmented-control";
import { uiText } from "../text";

type Backdrop = "game" | "light" | "dark";

// `align="start"` is for a preview taller than the usual box or one that changes height: the box grows with it and the
// preview starts under the backdrop switch.
const props = withDefaults(defineProps<{ label: string; kind?: "overlay" | "panel"; align?: "center" | "start" }>(), { kind: "overlay", align: "center" });
const backdrop = useLocalStorage<Backdrop>(`tavora-settings-backdrop-${props.kind}`, props.kind === "overlay" ? "game" : "dark");
const options = computed(() => [
  { value: "game" as const, label: uiText.value.backdropGame },
  { value: "light" as const, label: uiText.value.backdropLight },
  { value: "dark" as const, label: uiText.value.backdropDark },
]);
// The scenes stand for what an overlay sits on (a game, a light or a dark page), so they keep their colours in every theme.
const scenes: Record<Backdrop, string> = {
  game: "bg-[radial-gradient(circle_at_80%_20%,#f3e3b0_0,transparent_45%),linear-gradient(135deg,#24321f_0%,#5d7046_35%,#b9a777_65%,#43566a_100%)]",
  light: "bg-[#ece8e0]", // rules-allow: color a backdrop a preview is judged against
  dark: "bg-[#0d0c0b]", // rules-allow: color a backdrop a preview is judged against
};
</script>

<template>
  <div :class="cn('relative mt-4 flex h-36 items-center justify-center overflow-hidden rounded-lg border p-3', props.align === 'start' && 'h-auto min-h-36 items-start pt-10', scenes[backdrop])" data-slot="settings-preview" :data-backdrop="backdrop">
    <div role="img" :aria-label="label" class="contents"><slot /></div>
    <SegmentedControl v-model="backdrop" size="sm" class="absolute top-2 right-2" :label="uiText.backdrop" :options="options.map((option) => ({ ...option, testid: `settings-backdrop-${option.value}` }))" />
  </div>
</template>
