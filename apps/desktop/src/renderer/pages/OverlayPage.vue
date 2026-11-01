<script setup lang="ts">
// The Overlay page (docs/features/overlay-setups.md): the setup dropdown and toolbar above, the canvas on the left (the
// game window's shape with a soft square grid and the game's picture dimmed under it), the Sources and the Settings of the
// selected item on the right. The live pages and the layer that takes the mouse are separate native views over the canvas
// (main/overlay-canvas.ts); this page only tells the main process where the canvas is.
import { Image as ImageIcon, Layers, Redo2, Trash2, Undo2 } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { GRID_SETTINGS, type GridSetting } from "../../shared/layout-math";
import { state } from "../host";
import { t } from "../i18n";
import HeaderTools from "../components/workspace/HeaderTools.vue";
import OverlayCopied from "../components/layout/OverlayCopied.vue";
import OverlayCopy from "../components/layout/OverlayCopy.vue";
import OverlaySettings from "../components/layout/OverlaySettings.vue";
import OverlaySources from "../components/layout/OverlaySources.vue";
import { send, stills, useLayoutKeys, view } from "../components/layout/layout-state";
import { withShortcut } from "../shortcuts";

useLayoutKeys();

/** Where the game's picture is served from (main/layout-pictures.ts; the folder is one of the host UI's image folders). */
const PICTURE_ORIGIN = "tavora-host://app/";

const area = ref<HTMLElement>();
const canvas = ref<HTMLElement>();
const room = ref({ width: 0, height: 0 });

/** The canvas fits the room it has, whole, in the game window's shape. */
const size = computed(() => {
  const current = view.value;
  if (!current || room.value.width <= 0 || room.value.height <= 0) return { width: 0, height: 0, scale: 1 };
  const scale = Math.min(room.value.width / current.canvas.width, room.value.height / current.canvas.height);
  return { width: Math.max(1, Math.floor(current.canvas.width * scale)), height: Math.max(1, Math.floor(current.canvas.height * scale)), scale };
});

const gridStyle = computed(() => {
  const current = view.value;
  const cell = current ? current.cell * size.value.scale : 0;
  if (!current || cell < 4) return {};
  const line = "color-mix(in srgb, var(--foreground) 9%, transparent)";
  return {
    backgroundImage: `linear-gradient(to right, ${line} 1px, transparent 1px), linear-gradient(to bottom, ${line} 1px, transparent 1px)`,
    backgroundSize: `${cell}px ${cell}px`,
  };
});

// Tell the main process where the canvas is, so the live pages and the layer sit exactly on it.
let sent = "";
function report() {
  const box = canvas.value?.getBoundingClientRect();
  const bounds = box && box.width > 0 && box.height > 0 ? { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) } : null;
  const text = JSON.stringify(bounds);
  if (text === sent) return;
  sent = text;
  send({ type: "bounds", bounds });
}

let observer: ResizeObserver | undefined;
let covering: MutationObserver | undefined;
let covered = false;
function measure() {
  const box = area.value;
  if (box) room.value = { width: Math.max(0, box.clientWidth - 32), height: Math.max(0, box.clientHeight - 32) };
}

/**
 * While a list, a menu or a dialog is open over the page, the live pages step aside: they would be drawn over it. The main
 * process first sends still pictures of them (layout-state.ts), so nothing on the canvas changes.
 */
function lookForCover() {
  const now = document.querySelector("[data-reka-popper-content-wrapper], [role=dialog], [role=listbox], [role=menu]") !== null;
  if (now === covered) return;
  covered = now;
  send({ type: "cover", covered: now });
}

const stillStyle = (bounds: { x: number; y: number; width: number; height: number }) => ({ left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });

onMounted(() => {
  observer = new ResizeObserver(() => {
    measure();
    requestAnimationFrame(report);
  });
  // The area is drawn once the first view has arrived, so it is watched from then on.
  watch(
    area,
    (box) => {
      observer?.disconnect();
      if (!box) return;
      observer?.observe(box);
      measure();
    },
    { immediate: true, flush: "post" },
  );
  covering = new MutationObserver(() => requestAnimationFrame(lookForCover));
  covering.observe(document.body, { childList: true });
  addEventListener("resize", report);
  void nextTick(() => requestAnimationFrame(lookForCover));
});
onBeforeUnmount(() => {
  observer?.disconnect();
  covering?.disconnect();
  removeEventListener("resize", report);
  // Whatever was open over the page goes with it.
  if (covered) send({ type: "cover", covered: false });
  send({ type: "bounds", bounds: null });
});
// The canvas moves when its size does, and the first view brings it.
watch([size, () => view.value?.gameId], () => requestAnimationFrame(report), { flush: "post" });

const isGame = computed(() => !!view.value && view.value.gameId !== "$everywhere" && view.value.gameId !== "$all");
const setup = computed({
  get: () => view.value?.gameId ?? "",
  set: (value: string) => send({ type: "game", gameId: value }),
});
const setupOptions = computed(() => (view.value?.games ?? []).map((item) => ({ value: item.id, label: item.name })));
const setupName = computed(() => view.value?.games.find((item) => item.id === view.value?.gameId)?.name ?? "");
const selected = computed(() => view.value?.items.filter((item) => view.value?.selected.includes(item.id)) ?? []);
const grid = computed({
  get: () => view.value?.grid ?? "normal",
  set: (value: GridSetting) => send({ type: "grid", grid: value }),
});
const gridOptions = computed(() => GRID_SETTINGS.map((value) => ({ value, label: t(`overlays.layout.grid.${value}`) })));
const pictureHint = computed(() => (view.value?.canTakePicture ? null : view.value?.pictureHint === "switch" ? t("overlays.layout.switchToGame") : t("overlays.layout.noGame")));
const previewOptions = computed(() => (view.value?.preview.options ?? []).map((item) => ({ value: item.id, label: item.label })));
const previewChoice = computed({
  get: () => view.value?.preview.choice ?? "default",
  set: (choice: string) => send({ type: "preview", choice }),
});
const picture = computed(() => (view.value?.picture ? `${PICTURE_ORIGIN}${view.value.picture}` : null));
</script>

<template>
  <main class="flex h-full min-w-0 flex-col" data-testid="overlay-page">
    <!-- pl-6 leaves room for the rail's round expand button, which hangs over the rail's edge. -->
    <header class="app-drag flex h-14 flex-none items-center gap-3 pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+0.5rem)] pl-6">
      <span class="bg-secondary flex size-8 flex-none items-center justify-center rounded-lg" aria-hidden="true"><Layers :stroke-width="1.5" class="size-5" /></span>
      <h1 class="max-w-72 min-w-0 truncate text-lg font-semibold">{{ t("overlays.button.open") }}</h1>
      <span class="ml-auto" />
      <HeaderTools on-overlay />
    </header>
    <div v-if="view" class="flex min-h-0 flex-1 gap-2 px-2 pb-2" :class="{ 'flex-row-reverse': state?.gameOverlays.sidebar === 'left' }" data-testid="overlay-body">
      <section class="bg-card flex min-w-0 flex-1 flex-col rounded-lg border">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2">
          <label class="flex items-center gap-2 text-sm">
            <span class="text-muted-foreground">{{ t("overlays.layout.setup") }}</span>
            <Picker v-model="setup" :options="setupOptions" :label="t('overlays.layout.setup')" testid="layout-game" />
          </label>
          <OverlayCopy />
          <div class="flex items-center gap-2 text-sm">
            <span class="text-muted-foreground">{{ t("overlays.layout.grid") }}</span>
            <SegmentedControl v-model="grid" :options="gridOptions" :label="t('overlays.layout.grid')" />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <span class="text-muted-foreground">{{ t("overlays.layout.previewAs") }}</span>
            <Picker v-model="previewChoice" :options="previewOptions" :label="t('overlays.layout.previewAs')" testid="layout-preview" />
          </label>
          <div class="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" :disabled="!view.canUndo" :aria-label="t('overlays.layout.undo')" :title="withShortcut(t('overlays.layout.undo'), 'Z')" data-testid="layout-undo" @click="send({ type: 'undo' })"><Undo2 :stroke-width="1.5" /></Button>
            <Button variant="ghost" size="icon-sm" :disabled="!view.canRedo" :aria-label="t('overlays.layout.redo')" :title="withShortcut(t('overlays.layout.redo'), 'Y')" data-testid="layout-redo" @click="send({ type: 'redo' })"><Redo2 :stroke-width="1.5" /></Button>
          </div>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <!-- Off, it still shows why: a disabled button with a title keeps its hint (see the kit's Button). Everywhere and All games have no one window to take. -->
            <Button v-if="isGame" variant="secondary" size="sm" :disabled="!view.canTakePicture" :title="pictureHint ?? undefined" :aria-description="pictureHint ?? undefined" data-testid="layout-take-picture" @click="send({ type: 'take-picture' })">{{ t("overlays.layout.takePicture") }}</Button>
            <Button variant="secondary" size="sm" data-testid="layout-choose-picture" @click="send({ type: 'choose-picture' })"><ImageIcon :stroke-width="1.5" />{{ t("overlays.layout.choosePicture") }}</Button>
            <Button v-if="view.picture" variant="ghost" size="sm" data-testid="layout-remove-picture" @click="send({ type: 'remove-picture' })"><Trash2 :stroke-width="1.5" />{{ t("overlays.layout.removePicture") }}</Button>
          </div>
        </div>
        <div v-if="view.notice || view.copied || !view.enabled" class="flex flex-col gap-2 border-b px-3 py-2">
          <OverlayCopied />
          <Notice v-if="view.notice" variant="warning" data-testid="layout-notice">
            {{ view.notice }}
            <template #action><Button variant="ghost" size="xs" @click="send({ type: 'dismiss-notice' })">{{ t("common.close") }}</Button></template>
          </Notice>
          <Notice v-if="!view.enabled" variant="info" data-testid="layout-off">{{ t("overlays.layout.off") }}</Notice>
        </div>
        <div ref="area" class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            ref="canvas"
            class="bg-muted absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm shadow-sm ring-1"
            :style="{ width: `${size.width}px`, height: `${size.height}px`, ...gridStyle }"
            role="img"
            :aria-label="t('overlays.layout.canvas')"
            data-testid="layout-canvas"
          >
            <img v-if="picture" :src="picture" alt="" class="pointer-events-none absolute inset-0 size-full object-contain opacity-40" data-testid="layout-picture" />
          </div>
          <p v-if="isGame && !view.seen" class="text-muted-foreground absolute right-4 bottom-1 left-4 truncate text-center text-xs">{{ t("overlays.layout.unseen") }}</p>
          <p v-else-if="!view.picture" class="text-muted-foreground absolute right-4 bottom-1 left-4 truncate text-center text-xs" data-testid="layout-picture-hint">{{ t("overlays.layout.pictureHint") }}</p>
        </div>
      </section>
      <aside class="flex w-[22rem] flex-none flex-col gap-2" :aria-label="setupName">
        <OverlaySources />
        <OverlaySettings :items="selected" />
      </aside>
    </div>
    <div class="pointer-events-none fixed inset-0 z-10" aria-hidden="true" data-testid="layout-stills">
      <img v-for="still in stills.items" :key="still.id" :src="still.url" alt="" class="absolute" :style="stillStyle(still.bounds)" />
      <img v-if="stills.layer" :src="stills.layer.url" alt="" class="absolute" :style="stillStyle(stills.layer.bounds)" />
    </div>
  </main>
</template>
