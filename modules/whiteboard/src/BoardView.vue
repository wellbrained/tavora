<script setup lang="ts">
// One board in Excalidraw. Excalidraw is React, so it is mounted into one element here with createRoot (ExcalidrawRoot.tsx)
// and given props; everything else around it is Vue. The page remounts this (key) for every board.
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { TavoraSDK } from "@tavora/sdk";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { BoardData } from "./boards";
import { createBoardSession, type BoardSession, type Controls, type Pictures, type SaveState, type View } from "./boardSession";
import { watchToolbar } from "./excalidrawDom";
import ExcalidrawRoot, { type RootProps } from "./ExcalidrawRoot";
import { language, t } from "./i18n";
import type { LockSpot } from "./locks";
import Palette from "./Palette.vue";
import type { PalettePlace } from "./palette";
import PictureLocks from "./PictureLocks.vue";
import type { ToolbarPlace } from "./toolbar";

const props = defineProps<{
  sdk: TavoraSDK;
  data: BoardData;
  view: View | undefined;
  mode: "light" | "dark";
  saveState: SaveState;
  /** Stores the board. Resolves once it is stored, rejects when it could not be. */
  save: (data: BoardData) => Promise<void>;
  toolbar: ToolbarPlace;
  palette: PalettePlace;
}>();
const emit = defineEmits<{
  view: [view: View];
  state: [state: SaveState];
  /** The size of the board as it would be stored, for the warning. */
  size: [bytes: number];
  /** Whether there are changes that are not stored yet. */
  dirty: [dirty: boolean];
  pictures: [pictures: Pictures];
  /** Whether the board has anything on it. */
  empty: [empty: boolean];
  copyShortcut: [];
  picturesLoaded: [count: number];
  notice: [message: string];
  controls: [controls: Controls | null];
  toolbar: [place: ToolbarPlace];
  palette: [place: PalettePlace];
}>();

/** The element Excalidraw fills. */
const host = ref<HTMLElement | null>(null);
/** Set once the host exists, for the parts that look into Excalidraw's DOM. */
const board = shallowRef<HTMLElement | null>(null);
const spots = shallowRef<LockSpot[]>([]);
let controls: Controls | null = null;
let session: BoardSession | null = null;
let root: Root | null = null;

// An empty board has nothing to come back to, so it opens at 100%. A zoom left from before (up to 3000%) would make
// every stroke drawn next far too thick, with nothing on the board to show why.
const start = props.data.elements.length > 0 ? props.view : undefined;
const initialData: RootProps["initialData"] = {
  elements: props.data.elements as unknown as readonly ExcalidrawElement[],
  appState: {
    viewBackgroundColor: props.data.background,
    ...(start ? { scrollX: start.scrollX, scrollY: start.scrollY, zoom: { value: start.zoom as never } } : {}),
  },
  scrollToContent: !start && props.data.elements.length > 0,
};

function render() {
  if (!root || !session) return;
  root.render(
    createElement(ExcalidrawRoot, {
      initialData,
      langCode: language.value.toLowerCase().startsWith("de") ? "de-DE" : "en",
      theme: props.mode,
      saveState: props.saveState,
      saveText: props.saveState === "idle" ? "" : t(`save.${props.saveState}` as "save.saved"),
      toolbarText: t(props.toolbar === "bottom" ? "toolbar.top" : "toolbar.bottom"),
      onToolbarMove: () => emit("toolbar", props.toolbar === "bottom" ? "top" : "bottom"),
      onApi: session.ready,
      onChange: session.change,
      onScroll: session.scroll,
    }),
  );
}

onMounted(() => {
  session = createBoardSession({
    sdk: props.sdk,
    data: props.data,
    isDark: () => props.mode === "dark",
    save: (data) => props.save(data),
    onState: (state) => emit("state", state),
    onSize: (bytes) => emit("size", bytes),
    onDirty: (dirty) => emit("dirty", dirty),
    onPictures: (pictures) => emit("pictures", pictures),
    onEmpty: (empty) => emit("empty", empty),
    onCopyShortcut: () => emit("copyShortcut"),
    onPicturesLoaded: (count) => emit("picturesLoaded", count),
    onNotice: (message) => emit("notice", message),
    onControls: (value) => {
      controls = value;
      emit("controls", value);
    },
    onSpots: (next) => (spots.value = next),
    onView: (view) => emit("view", view),
  });
  root = createRoot(host.value!);
  board.value = host.value;
  render();
});

onBeforeUnmount(() => {
  // Saves what is left, then lets Excalidraw go.
  session?.dispose();
  root?.unmount();
  root = null;
  session = null;
});

// Props Excalidraw shows follow the page: the theme, the language, the save status and the toolbar menu item.
watch([() => props.mode, () => props.saveState, () => props.toolbar, language], render);

// Moves Excalidraw's toolbar to the bottom when asked.
watch(
  [board, () => props.toolbar],
  ([element, place], _, onCleanup) => {
    if (element) onCleanup(watchToolbar(element, place));
  },
  { flush: "post" },
);

// A palette that moved or folded may now cover a lock, or no longer.
watch(
  () => props.palette,
  () => requestAnimationFrame(() => session?.recheckLocks()),
);

function toggleLock(id: string, locked: boolean) {
  controls?.setPictureLocked(id, locked);
}
</script>

<template>
  <div class="relative size-full">
    <div ref="host" class="size-full" />
    <PictureLocks :spots="spots" @toggle="toggleLock" />
    <Palette :board="board" :place="palette" @place="emit('palette', $event)" />
  </div>
</template>
