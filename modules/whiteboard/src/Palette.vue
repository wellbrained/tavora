<script setup lang="ts">
// Excalidraw's style palette (stroke, background, width, …) gets a handle: drag it anywhere on the board, or fold it
// away to just its handle. Excalidraw builds the palette itself and shows it only while something is selected or
// drawn, so excalidrawDom.ts puts the handle into it each time it appears; this fills it, and where the palette sits is
// kept for the panel. Excalidraw's own options stay Excalidraw's: they are what select, style and undo its elements.
import { ChevronDown, ChevronRight, GripVertical, RotateCcw } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { bindDrag } from "@tavora/official-ui/lib/bind-drag";
import { shallowRef, watch } from "vue";
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
const drag = bindDrag();

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

function down(event: PointerEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
  event.preventDefault();
  drag.start(
    event,
    () => {
      const from = live;
      return {
        move: (_, delta) => {
          const found = parts.value;
          if (!props.board || !found) return;
          const kept = clampPlace(from.x + delta.x, from.y + delta.y, paletteHome(found.palette), props.board.getBoundingClientRect());
          // Only on the page while dragging; stored when the palette is let go of.
          live = { ...live, ...kept };
          found.palette.style.transform = `translate(${kept.x}px, ${kept.y}px)`;
        },
        drop: () => emit("place", live),
        // Escape, or the system took the pointer away: back to where it was and nothing is stored.
        cancel: () => {
          live = from;
          if (parts.value && props.board) placePalette(parts.value.palette, props.board, live);
        },
      };
    },
    { capture: event.currentTarget as Element },
  );
}

function fold() {
  emit("place", { ...live, collapsed: !live.collapsed });
}

function toggleMore() {
  emit("place", { ...live, more: !live.more });
}

/** Back to where Excalidraw puts it, folded and opened as it is. */
function putBack(event: MouseEvent) {
  // A double-click on the Fold button folds twice; it doesn't move the palette.
  if (event.type === "dblclick" && (event.target as HTMLElement).closest("button")) return;
  emit("place", { ...live, x: DEFAULT_PALETTE.x, y: DEFAULT_PALETTE.y });
}
</script>

<template>
  <template v-if="parts">
    <Teleport :to="parts.handle">
      <div class="palette-grip" :title="t('palette.move')" data-testid="palette-handle" @pointerdown="down" @dblclick="putBack">
        <GripVertical class="size-3.5 flex-none opacity-50" aria-hidden="true" />
        <span class="flex-1 font-semibold">{{ t("palette.title") }}</span>
        <Button v-if="place.x || place.y" type="button" variant="ghost" size="icon-xs" :aria-label="t('palette.reset')" :title="t('palette.reset')" data-testid="palette-reset" @click="putBack">
          <RotateCcw />
        </Button>
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
          <component :is="place.collapsed ? ChevronRight : ChevronDown" />
        </Button>
      </div>
    </Teleport>
    <Teleport :to="parts.more">
      <Button type="button" variant="ghost" size="xs" class="w-full justify-between rounded-none" :aria-expanded="place.more" data-testid="palette-more" @click="toggleMore">
        <span>{{ t(place.more ? "palette.less" : "palette.more") }}</span>
        <component :is="place.more ? ChevronDown : ChevronRight" aria-hidden="true" />
      </Button>
    </Teleport>
  </template>
</template>
