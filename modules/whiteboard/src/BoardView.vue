<script setup lang="ts">
// One board in Excalidraw. Excalidraw is React, so it is mounted into one element here with createRoot (ExcalidrawRoot.tsx)
// and given props; everything else around it is Vue. The page remounts this (key) for every board. The board session
// (boardSession.ts) holds what the page shows of the board; it is handed up once, not re-sent piece by piece.
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { TavoraSDK } from "@tavora/sdk";
import type { DocumentHandle } from "@tavora/sdk/store";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { BoardData } from "./boards";
import { createBoardSession, type BoardSession, type BoardState, type View } from "./boardSession";
import { watchHints, watchToolbar } from "./excalidrawDom";
import ExcalidrawRoot, { type RootProps } from "./ExcalidrawRoot";
import { language, t } from "./i18n";
import Palette from "./Palette.vue";
import type { PalettePlace } from "./palette";
import PictureLocks from "./PictureLocks.vue";
import type { ToolbarPlace } from "./toolbar";

const props = defineProps<{
  sdk: TavoraSDK;
  /** The board's document, opened by the board library. */
  document: DocumentHandle<BoardData>;
  view: View | undefined;
  mode: "light" | "dark";
  toolbar: ToolbarPlace;
  palette: PalettePlace;
  fitOnOpen?: boolean;
}>();
const emit = defineEmits<{
  /** The board is open: the page reads its `state` and gives it commands. */
  session: [session: BoardSession];
  /** The board is closing. */
  closed: [session: BoardSession];
  toolbar: [place: ToolbarPlace];
  palette: [place: PalettePlace];
}>();

/** The element Excalidraw fills. */
const host = ref<HTMLElement | null>(null);
/** Set once the host exists, for the parts that look into Excalidraw's DOM. */
const board = shallowRef<HTMLElement | null>(null);
const state = shallowRef<BoardState | null>(null);
const hoveredImage = ref<string | null>(null);
let session: BoardSession | null = null;
let stopState: (() => void) | undefined;
let root: Root | null = null;

const data = props.document.data;
// An empty board has nothing to come back to, so it opens at 100%. A zoom left from before (up to 3000%) would make
// every stroke drawn next far too thick, with nothing on the board to show why.
const start = data.elements.length > 0 ? props.view : undefined;
const initialData: RootProps["initialData"] = {
  elements: data.elements as unknown as readonly ExcalidrawElement[],
  appState: {
    viewBackgroundColor: data.background,
    gridModeEnabled: data.grid,
    ...(start ? { scrollX: start.scrollX, scrollY: start.scrollY, zoom: { value: start.zoom as never } } : {}),
  },
  scrollToContent: !start && data.elements.length > 0,
};

function render() {
  if (!root || !session) return;
  const save = session.state.save;
  root.render(
    createElement(ExcalidrawRoot, {
      initialData,
      langCode: language.value.toLowerCase().startsWith("de") ? "de-DE" : "en",
      theme: props.mode,
      saveState: save,
      saveText: save === "idle" ? "" : t(`save.${save}` as "save.saved"),
      toolbarText: t(props.toolbar === "bottom" ? "toolbar.top" : "toolbar.bottom"),
      onToolbarMove: () => emit("toolbar", props.toolbar === "bottom" ? "top" : "bottom"),
      onApi: session.ready,
      onChange: session.change,
      onScroll: session.scroll,
    }),
  );
}

onMounted(() => {
  const opened = createBoardSession({ sdk: props.sdk, document: props.document, isDark: () => props.mode === "dark", fitOnOpen: props.fitOnOpen });
  session = opened;
  state.value = opened.state;
  let saved = opened.state.save;
  stopState = opened.onState((next) => {
    state.value = next;
    // Excalidraw shows the save status; only a change of it asks for a new render.
    if (next.save !== saved) {
      saved = next.save;
      render();
    }
  });
  root = createRoot(host.value!);
  board.value = host.value;
  render();
  emit("session", opened);
});

onBeforeUnmount(() => {
  // Saves what is left, then lets Excalidraw go.
  const closing = session;
  stopState?.();
  if (closing) {
    emit("closed", closing);
    void closing.dispose();
  }
  root?.unmount();
  root = null;
  session = null;
});

// Props Excalidraw shows follow the page: the theme, the language and the toolbar menu item.
watch([() => props.mode, () => props.toolbar, language], render);

// Moves Excalidraw's toolbar to the bottom when asked.
watch(
  [board, () => props.toolbar],
  ([element, place], _, onCleanup) => {
    if (element) onCleanup(watchToolbar(element, place));
  },
  { flush: "post" },
);

// Excalidraw's hint for moving the canvas, in Tavora's words.
watch(
  [board, language],
  ([element], _, onCleanup) => {
    if (element) onCleanup(watchHints(element, () => t("hint.panning")));
  },
  { flush: "post" },
);

// A palette that moved or folded may now cover a lock, or no longer.
watch(
  () => props.palette,
  () => requestAnimationFrame(() => session?.recheckLocks()),
);

function toggleLock(id: string, locked: boolean) {
  session?.setPictureLocked(id, locked);
}

function pointerMove(event: PointerEvent) {
  hoveredImage.value = session?.imageAt(event.clientX, event.clientY) ?? null;
}
</script>

<template>
  <div class="relative size-full" @pointermove="pointerMove" @pointerleave="hoveredImage = null">
    <div ref="host" class="size-full" />
    <PictureLocks :spots="state?.spots ?? []" :active-id="hoveredImage" @toggle="toggleLock" />
    <Palette :board="board" :place="palette" @place="emit('palette', $event)" />
  </div>
</template>
