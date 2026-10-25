<script setup lang="ts">
// Excalidraw's style palette (stroke, background, width, …) gets a handle: drag it anywhere on the board, or fold it
// away to just its handle. Excalidraw builds the palette itself and shows it only while something is selected or
// drawn, so excalidrawDom.ts puts the handle into it each time it appears; this fills it, and where the palette sits is
// kept for the panel. Excalidraw's own options stay Excalidraw's: they are what select, style and undo its elements.
import { ChevronDown, ChevronRight, GripVertical } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { onBeforeUnmount, shallowRef, watch } from "vue";
import { paletteHome, placePalette, watchPalette, type PaletteParts } from "./excalidrawDom";
import { t } from "./i18n";
import { clampPlace, DEFAULT_PALETTE, type PalettePlace } from "./palette";

const props = defineProps<{
  /** The element Excalidraw is shown in. */
  board: HTMLElement | null;
  place: PalettePlace;
}>();
const emit = defineEmits<{ place: [place: PalettePlace] }>();

/** The palette Excalidraw shows right now, and the places put into it. */
const parts = shallowRef<PaletteParts | null>(null);
/** Where the palette is while it is being dragged; stored when it is let go of. */
let live = props.place;
let drag: { pointer: number; startX: number; startY: number; from: PalettePlace; moved: boolean } | null = null;

// Finds the palette whenever Excalidraw shows it.
watch(
  () => props.board,
  (board, _, onCleanup) => {
    if (!board) return;
    const stop = watchPalette(board, () => t("palette.color"), (found) => (parts.value = found));
    onCleanup(() => {
      stop();
      parts.value = null;
    });
  },
  { immediate: true, flush: "post" },
);

// Moves the palette to its place, kept on the board, also when the panel is resized.
watch(
  [() => props.board, parts, () => props.place],
  ([board, found, place], _, onCleanup) => {
    live = place;
    if (!board || !found) return;
    const apply = () => placePalette(found.palette, board, live);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(board);
    onCleanup(() => observer.disconnect());
  },
  { flush: "post" },
);

onBeforeUnmount(() => (drag = null));

function down(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, from: live, moved: false };
}

function move(event: PointerEvent) {
  const gesture = drag;
  const found = parts.value;
  if (!gesture || gesture.pointer !== event.pointerId || !props.board || !found) return;
  gesture.moved = true;
  const kept = clampPlace(gesture.from.x + event.clientX - gesture.startX, gesture.from.y + event.clientY - gesture.startY, paletteHome(found.palette), props.board.getBoundingClientRect());
  // Only on the page while dragging; stored when the palette is let go of.
  live = { ...live, ...kept };
  found.palette.style.transform = `translate(${kept.x}px, ${kept.y}px)`;
}

function up(event: PointerEvent) {
  const gesture = drag;
  if (!gesture || gesture.pointer !== event.pointerId) return;
  drag = null;
  if (gesture.moved) emit("place", live);
}

function fold() {
  emit("place", { ...live, collapsed: !live.collapsed });
}

function toggleMore() {
  emit("place", { ...live, more: !live.more });
}

function putBack(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest("button")) emit("place", DEFAULT_PALETTE);
}
</script>

<template>
  <template v-if="parts">
    <Teleport :to="parts.handle">
      <div class="palette-grip" :title="t('palette.move')" data-testid="palette-handle" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @dblclick="putBack">
        <GripVertical class="size-3.5 flex-none opacity-50" aria-hidden="true" />
        <span class="flex-1 font-semibold">{{ t("palette.title") }}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          :aria-label="t(place.collapsed ? 'palette.expand' : 'palette.collapse')"
          :title="t(place.collapsed ? 'palette.expand' : 'palette.collapse')"
          :aria-expanded="!place.collapsed"
          data-testid="palette-toggle"
          @click="fold"
        >
          <component :is="place.collapsed ? ChevronRight : ChevronDown" :stroke-width="1.5" />
        </Button>
      </div>
    </Teleport>
    <Teleport :to="parts.more">
      <Button type="button" variant="ghost" size="xs" class="w-full justify-between rounded-none" :aria-expanded="place.more" data-testid="palette-more" @click="toggleMore">
        <span>{{ t(place.more ? "palette.less" : "palette.more") }}</span>
        <component :is="place.more ? ChevronDown : ChevronRight" :stroke-width="1.5" aria-hidden="true" />
      </Button>
    </Teleport>
  </template>
</template>
