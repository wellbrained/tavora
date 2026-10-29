<script setup lang="ts">
// How the page's settings look, over a backdrop the user can switch: a game-like scene, light or
// dark. Overlay pages start on the game scene, panel pages on dark; the choice is remembered.
import { useLocalStorage } from "@vueuse/core";
import { computed } from "vue";
import { cn } from "../../../lib/utils";
import { uiText } from "../text";

type Backdrop = "game" | "light" | "dark";

const props = withDefaults(defineProps<{ label: string; kind?: "overlay" | "panel" }>(), { kind: "overlay" });
const backdrop = useLocalStorage<Backdrop>(`tavora-settings-backdrop-${props.kind}`, props.kind === "overlay" ? "game" : "dark");
const options = computed(() => [
  { value: "game" as const, label: uiText.value.backdropGame },
  { value: "light" as const, label: uiText.value.backdropLight },
  { value: "dark" as const, label: uiText.value.backdropDark },
]);
const scenes: Record<Backdrop, string> = {
  game: "bg-[radial-gradient(circle_at_80%_20%,#f3e3b0_0,transparent_45%),linear-gradient(135deg,#24321f_0%,#5d7046_35%,#b9a777_65%,#43566a_100%)]",
  light: "bg-[#ece8e0]",
  dark: "bg-[#0d0c0b]",
};
</script>

<template>
  <div :class="cn('relative mt-4 flex h-36 items-center justify-center overflow-hidden rounded-lg border p-3', scenes[backdrop])" data-slot="settings-preview" :data-backdrop="backdrop">
    <div role="img" :aria-label="label" class="contents"><slot /></div>
    <div role="radiogroup" :aria-label="uiText.backdrop" class="absolute top-2 right-2 flex gap-0.5 rounded-lg bg-black/60 p-0.5">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="backdrop === option.value"
        :data-testid="`settings-backdrop-${option.value}`"
        :class="cn('rounded-md px-2 py-0.5 text-[11px] text-white/75 outline-none hover:text-white focus-visible:outline-2 focus-visible:outline-white', backdrop === option.value && 'bg-white/15 text-white')"
        @click="backdrop = option.value"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
