<script setup lang="ts">
// The card at the top of the in-game layer (main/game-layer-card.ts): Tavora's mark and "Overlay", the kit's segmented
// control for Use | Arrange, and the kit's button to close the layer, with the layer key on it. Drawn in the theme the
// main process sends, in the user's interface font. It tells the main process how big the card is (the window is only
// that big, plus room for the shadow and the tooltips) and whether the pointer is over it (only then does the window
// take the mouse), and asks for a mode or Close. The layer's mode is on the root as `data-status`.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { Separator } from "@tavora/official-ui/components/ui/separator";
import { setUiLanguage } from "@tavora/official-ui/components/ui/text";
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import type { LayerCardState, LayerMode, TavoraLayerCardApi } from "../../shared/layer-card";

const api: TavoraLayerCardApi = window.tavoraLayerCard;
const state = ref<LayerCardState>();
/** The mode picked here shows at once; the main process's answer follows. */
const mode = ref<LayerMode>("use");
const card = useTemplateRef<HTMLElement>("card");

function show(next: LayerCardState): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(next.colors)) root.style.setProperty(`--${name}`, value);
  root.style.setProperty("--radius", `${next.radius}px`);
  root.style.setProperty("--tavora-font-sans", next.font);
  root.style.setProperty("color-scheme", next.scheme);
  root.classList.toggle("dark", next.scheme === "dark");
  root.lang = next.language;
  setUiLanguage(next.language);
  mode.value = next.mode;
  state.value = next;
}

function pick(next: LayerMode): void {
  if (next === mode.value) return;
  mode.value = next;
  api.setMode(next);
}

const options = computed(() => {
  const texts = state.value?.texts;
  if (!texts) return [];
  return [
    { value: "use" as const, label: texts.use, tooltip: texts.useHint, testid: "layer-mode-use" },
    { value: "arrange" as const, label: texts.arrange, tooltip: texts.arrangeHint, testid: "layer-mode-arrange" },
  ];
});

let last = "";
/** The card's size, once per change. */
const measure = new ResizeObserver(() => {
  const box = card.value?.getBoundingClientRect();
  if (!box || box.width < 1 || box.height < 1) return;
  const key = `${Math.ceil(box.width)}x${Math.ceil(box.height)}`;
  if (key === last) return;
  last = key;
  api.extent({ width: box.width, height: box.height });
});

// The card is drawn once there is something to show; from then on its size is watched.
watch(card, (element) => {
  measure.disconnect();
  if (element) measure.observe(element);
});

onMounted(() => {
  api.onState(show);
  api.ready();
});
onBeforeUnmount(() => measure.disconnect());
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-0 flex justify-center pt-2">
    <div
      v-if="state"
      ref="card"
      class="bg-card text-card-foreground pointer-events-auto flex w-max items-center gap-2 rounded-lg border p-1 pl-2.5 font-sans shadow-md"
      role="group"
      :aria-label="state.texts.label"
      :data-status="mode"
      data-testid="layer-card"
      @pointerenter="api.hover(true)"
      @pointerleave="api.hover(false)"
    >
      <img class="size-5 flex-none" src="/brand/emblem-tight-96.png" srcset="/brand/emblem-tight-96.png 1x, /brand/emblem-tight-192.png 2x" alt="" draggable="false" />
      <span class="pr-1 text-sm font-medium whitespace-nowrap">{{ state.texts.title }}</span>
      <SegmentedControl :model-value="mode" :label="state.texts.mode" :options="options" @update:model-value="pick" />
      <Separator orientation="vertical" class="mx-0.5 data-[orientation=vertical]:h-5" />
      <Button variant="ghost" size="sm" :aria-label="state.texts.close" :title="state.texts.closeHint" data-testid="layer-close" @click="api.close()">
        <X />
        <span v-if="state.keys.length" class="flex items-center gap-1" aria-hidden="true">
          <Kbd v-for="key in state.keys" :key="key">{{ key }}</Kbd>
        </span>
      </Button>
    </div>
  </div>
</template>
