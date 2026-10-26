<script setup lang="ts">
// The Overlay layout window's shell: the toolbar (the game, the grid, the game picture, undo and redo), the list of
// what is arranged on the left and, on the right, the canvas background: the game window's shape with a soft square
// grid and the game's picture dimmed under it. The live pages and the layer that takes the mouse are separate views
// over the canvas (main/overlay-layout-window.ts); this page only tells the main process where the canvas is.
import { Image as ImageIcon, Redo2, Trash2, Undo2 } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { Picker } from "@tavora/official-ui/components/ui/picker";
import { SegmentedControl } from "@tavora/official-ui/components/ui/segmented-control";
import { TooltipProvider } from "reka-ui";
import { GRID_SETTINGS, type GridSetting } from "../../../shared/layout-math";
import { LAYOUT_ALL_GAMES, type LayoutStills } from "../../../shared/layout-view";
import { api, toast } from "../../host";
import { t } from "../../i18n";
import HotkeyDialog from "../HotkeyDialog.vue";
import LayoutRow from "./LayoutRow.vue";
import { send, useLayoutKeys, view } from "./layout-state";

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
 * process first sends still pictures of them (below), so nothing on the canvas changes.
 */
function lookForCover() {
  const now = document.querySelector("[data-reka-popper-content-wrapper], [role=dialog], [role=listbox], [role=menu]") !== null;
  if (now === covered) return;
  covered = now;
  send({ type: "cover", covered: now });
}

/** Still pictures of the live pages and of the layer, drawn where they are while they step aside for a list or menu. */
const stills = shallowRef<LayoutStills>({ items: [], layer: null });
let stillChanges = 0;
function decoded(url: string): Promise<unknown> {
  const image = new Image();
  image.src = url;
  return image.decode().catch(() => undefined);
}
api.layout.onStills(async (next) => {
  const change = ++stillChanges;
  const urls = [...next.items.map((item) => item.url), ...(next.layer ? [next.layer.url] : [])];
  // Said to be shown only once they are decoded and a frame with them was drawn: the pages step aside after that.
  await Promise.all(urls.map(decoded));
  if (change !== stillChanges) return;
  stills.value = next;
  if (!urls.length) return;
  await nextTick();
  requestAnimationFrame(() => requestAnimationFrame(() => change === stillChanges && api.layout.stillsShown()));
});
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
});
onBeforeUnmount(() => {
  observer?.disconnect();
  covering?.disconnect();
  removeEventListener("resize", report);
});
// The canvas moves when its size does, and the first view brings it.
watch([size, () => view.value?.gameId], () => requestAnimationFrame(report), { flush: "post" });

const game = computed({
  get: () => view.value?.gameId ?? "",
  set: (gameId: string) => send({ type: "game", gameId }),
});
const gameOptions = computed(() => (view.value?.games ?? []).map((item) => ({ value: item.id, label: item.name })));
const gameName = computed(() => view.value?.games.find((item) => item.id === view.value?.gameId)?.name ?? "");
const grid = computed({
  get: () => view.value?.grid ?? "normal",
  set: (value: GridSetting) => send({ type: "grid", grid: value }),
});
const gridOptions = computed(() => GRID_SETTINGS.map((value) => ({ value, label: t(`overlays.layout.grid.${value}`) })));
const pictureHint = computed(() => (view.value?.canTakePicture ? null : view.value?.pictureHint === "switch" ? t("overlays.layout.switchToGame") : t("overlays.layout.noGame")));
const picture = computed(() => (view.value?.picture ? `${PICTURE_ORIGIN}${view.value.picture}` : null));
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div v-if="view" class="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
        <label class="flex items-center gap-2 text-sm">
          <span class="text-muted-foreground">{{ t("overlays.layout.game") }}</span>
          <Picker v-model="game" :options="gameOptions" :label="t('overlays.layout.game')" testid="layout-game" />
        </label>
        <div class="flex items-center gap-2 text-sm">
          <span class="text-muted-foreground">{{ t("overlays.layout.grid") }}</span>
          <SegmentedControl v-model="grid" :options="gridOptions" :label="t('overlays.layout.grid')" />
        </div>
        <div class="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" :disabled="!view.canUndo" :aria-label="t('overlays.layout.undo')" :title="t('overlays.layout.undo')" data-testid="layout-undo" @click="send({ type: 'undo' })"><Undo2 :stroke-width="1.5" /></Button>
          <Button variant="ghost" size="icon-sm" :disabled="!view.canRedo" :aria-label="t('overlays.layout.redo')" :title="t('overlays.layout.redo')" data-testid="layout-redo" @click="send({ type: 'redo' })"><Redo2 :stroke-width="1.5" /></Button>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" data-testid="layout-done" :title="t('overlays.layout.live')" @click="send({ type: 'done' })">{{ t('overlays.layout.done') }}</Button>
          <!-- A disabled button shows no hint of its own, so the hint sits on its wrapper. -->
          <span class="inline-flex" :title="pictureHint ?? undefined" data-testid="layout-take-picture-hint">
            <Button variant="secondary" size="sm" :disabled="!view.canTakePicture" :aria-description="pictureHint ?? undefined" data-testid="layout-take-picture" @click="send({ type: 'take-picture' })">{{ t("overlays.layout.takePicture") }}</Button>
          </span>
          <Button variant="secondary" size="sm" data-testid="layout-choose-picture" @click="send({ type: 'choose-picture' })"><ImageIcon :stroke-width="1.5" />{{ t("overlays.layout.choosePicture") }}</Button>
          <Button v-if="view.picture" variant="ghost" size="sm" data-testid="layout-remove-picture" @click="send({ type: 'remove-picture' })"><Trash2 :stroke-width="1.5" />{{ t("overlays.layout.removePicture") }}</Button>
        </div>
      </header>
      <div v-if="view.notice || !view.enabled || toast" class="flex flex-col gap-2 border-b px-4 py-2">
        <Notice v-if="view.notice" variant="warning" data-testid="layout-notice">
          {{ view.notice }}
          <template #action><Button variant="ghost" size="xs" @click="send({ type: 'dismiss-notice' })">{{ t("common.close") }}</Button></template>
        </Notice>
        <Notice v-if="toast" variant="error">{{ toast }}</Notice>
        <Notice v-if="!view.enabled" variant="info" data-testid="layout-off">{{ t("overlays.layout.off") }}</Notice>
      </div>
      <div class="flex min-h-0 flex-1">
        <aside class="flex w-[26rem] flex-none flex-col gap-2 overflow-y-auto border-r p-3" :aria-label="t('overlays.layout.list')">
          <h2 class="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">{{ t("overlays.layout.list") }}</h2>
          <p v-if="!view.items.length" class="text-muted-foreground px-1 py-2 text-sm" data-testid="layout-empty">{{ t("overlays.layout.empty") }}</p>
          <div v-if="view.gameId !== LAYOUT_ALL_GAMES && view.items.some((item) => item.general)" class="flex flex-col gap-2 px-1 py-2">
            <p class="text-muted-foreground text-xs">{{ t(view.customized ? 'overlays.layout.customized' : 'overlays.layout.following') }}</p>
            <Button v-if="!view.customized" variant="secondary" size="sm" data-testid="layout-customize" @click="send({ type: 'customize' })">{{ t('overlays.layout.customize') }}</Button>
            <Button v-if="view.hasOverrides || view.customized" variant="secondary" size="sm" data-testid="layout-follow-all" @click="send({ type: 'follow-all' })">{{ t('overlays.layout.followAgain') }}</Button>
          </div>
          <ul v-if="view.items.length" class="flex flex-col gap-2">
            <LayoutRow v-for="item in view.items" :key="item.id" :item="item" :selected="view.selection === item.id" :game-name="gameName" :per-game="view.gameId !== LAYOUT_ALL_GAMES" />
          </ul>
        </aside>
        <main ref="area" class="relative min-w-0 flex-1 overflow-hidden">
          <div
            ref="canvas"
            class="bg-muted absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm shadow-sm ring-1"
            :style="{ width: `${size.width}px`, height: `${size.height}px`, ...gridStyle }"
            role="img"
            :aria-label="t('overlays.layout.canvas')"
            data-testid="layout-canvas"
          >
            <img v-if="picture" :src="picture" alt="" class="pointer-events-none absolute inset-0 size-full object-fill opacity-40" data-testid="layout-picture" />
          </div>
          <p v-if="!view.seen" class="text-muted-foreground absolute right-4 bottom-1 left-4 truncate text-center text-xs">{{ t("overlays.layout.unseen") }}</p>
        </main>
      </div>
      <div class="pointer-events-none fixed inset-0 z-10" aria-hidden="true" data-testid="layout-stills">
        <img v-for="still in stills.items" :key="still.id" :src="still.url" alt="" class="absolute" :style="stillStyle(still.bounds)" />
        <img v-if="stills.layer" :src="stills.layer.url" alt="" class="absolute" :style="stillStyle(stills.layer.bounds)" />
      </div>
      <HotkeyDialog />
    </div>
  </TooltipProvider>
</template>
