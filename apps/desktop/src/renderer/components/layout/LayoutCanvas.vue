<script setup lang="ts">
// The layer over the Overlay layout's canvas: a transparent page that takes the mouse (the live pages below it can't) and
// draws what the user works with: each item's outline, the selection with its eight handles, the key of a toggle
// item, and the guide lines while something snaps. Dragging works in canvas units (the game window at 1080 high); the
// main process moves the live pages and keeps the result. Holding Alt places freely.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { cn } from "@/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import { snapMove, snapResize, type Edges, type Guide } from "../../../shared/layout-math";
import type { LayoutItemView } from "../../../shared/layout-view";
import type { Rect } from "../../../shared/overlay-anchor";
import { t } from "../../i18n";
import { send, useLayoutKeys, view } from "./layout-state";

useLayoutKeys();

const root = ref<HTMLElement>();
const width = ref(1);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => (width.value = root.value?.clientWidth || 1));
  if (root.value) observer.observe(root.value);
  root.value?.focus();
  // A page that was loaded again knows of no drag; the main process may still hold where the last one was.
  send({ type: "drag-end" });
  addEventListener("blur", abort);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  removeEventListener("blur", abort);
});

/** Screen pixels per canvas unit. */
const scale = computed(() => (view.value ? width.value / view.value.canvas.width : 1));
const mac = navigator.platform.startsWith("Mac");

interface Drag {
  id: string;
  edges: Edges | null;
  start: { x: number; y: number };
  origin: Rect;
  pointer: number;
}
const drag = ref<Drag | null>(null);
/** Where the items are while being dragged, and until the main process has sent the result. */
const local = shallowRef<Record<string, Rect>>({});
const guides = ref<Guide[]>([]);
let frame = 0;
let pending: { id: string; rect: Rect } | null = null;

// A new view from the main process carries the result of what was dropped.
watch(view, () => {
  if (!drag.value) local.value = {};
});

const shown = computed(() => (view.value?.items ?? []).filter((item) => !item.hiddenOnCanvas));
const rectOf = (item: LayoutItemView): Rect => local.value[item.id] ?? item.placed;
const styleOf = (item: LayoutItemView) => {
  const rect = rectOf(item);
  const k = scale.value;
  return { left: `${rect.x * k}px`, top: `${rect.y * k}px`, width: `${rect.width * k}px`, height: `${rect.height * k}px` };
};

const HANDLES = [
  { edge: "tl", edges: { left: true, top: true }, cursor: "nwse-resize", at: "left-0 top-0 -translate-x-1/2 -translate-y-1/2" },
  { edge: "t", edges: { top: true }, cursor: "ns-resize", at: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2" },
  { edge: "tr", edges: { right: true, top: true }, cursor: "nesw-resize", at: "right-0 top-0 translate-x-1/2 -translate-y-1/2" },
  { edge: "r", edges: { right: true }, cursor: "ew-resize", at: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2" },
  { edge: "br", edges: { right: true, bottom: true }, cursor: "nwse-resize", at: "right-0 bottom-0 translate-x-1/2 translate-y-1/2" },
  { edge: "b", edges: { bottom: true }, cursor: "ns-resize", at: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2" },
  { edge: "bl", edges: { left: true, bottom: true }, cursor: "nesw-resize", at: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2" },
  { edge: "l", edges: { left: true }, cursor: "ew-resize", at: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2" },
] as const satisfies readonly { edge: string; edges: Edges; cursor: string; at: string }[];

function begin(event: PointerEvent, item: LayoutItemView, edges: Edges | null) {
  if (event.button !== 0) return;
  event.stopPropagation();
  root.value?.focus();
  if (view.value?.selection !== item.id) send({ type: "select", id: item.id });
  drag.value = { id: item.id, edges, start: { x: event.clientX, y: event.clientY }, origin: rectOf(item), pointer: event.pointerId };
  root.value?.setPointerCapture(event.pointerId);
}

function move(event: PointerEvent) {
  const current = drag.value;
  const now = view.value;
  if (!current || !now) return;
  const dx = (event.clientX - current.start.x) / scale.value;
  const dy = (event.clientY - current.start.y) / scale.value;
  const others = shown.value.filter((item) => item.id !== current.id).map(rectOf);
  const options = { cell: now.cell, threshold: 8 / scale.value, free: event.altKey };
  const origin = current.origin;
  const result = current.edges
    ? snapResize(
        {
          x: origin.x + (current.edges.left ? dx : 0),
          y: origin.y + (current.edges.top ? dy : 0),
          width: origin.width + (current.edges.right ? dx : 0) - (current.edges.left ? dx : 0),
          height: origin.height + (current.edges.bottom ? dy : 0) - (current.edges.top ? dy : 0),
        },
        current.edges,
        now.canvas,
        others,
        options,
        now.minSize,
      )
    : snapMove({ ...origin, x: origin.x + dx, y: origin.y + dy }, now.canvas, others, options);
  local.value = { ...local.value, [current.id]: result.rect };
  guides.value = result.guides;
  // The live pages follow, once per frame.
  pending = { id: current.id, rect: result.rect };
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    if (pending) send({ type: "drag", ...pending });
  });
}

function end(event: PointerEvent) {
  const current = drag.value;
  if (!current) return;
  drag.value = null;
  guides.value = [];
  cancelAnimationFrame(frame);
  frame = 0;
  pending = null;
  if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
  const rect = local.value[current.id];
  if (rect) send({ type: "commit", id: current.id, rect });
  // The new view normally replaces this at once; if nothing changed there is none, so it is dropped anyway.
  setTimeout(() => {
    if (!drag.value) local.value = {};
  }, 400);
}

/** The pointer was lost (cancelled, the window lost the focus): the drag ends without a drop, and the item stays where it was. */
function abort() {
  const current = drag.value;
  if (!current) return;
  drag.value = null;
  guides.value = [];
  cancelAnimationFrame(frame);
  frame = 0;
  pending = null;
  if (root.value?.hasPointerCapture(current.pointer)) root.value.releasePointerCapture(current.pointer);
  local.value = {};
  send({ type: "drag-end" });
}

function clearSelection() {
  root.value?.focus();
  send({ type: "select", id: null });
}

const keyOf = (item: LayoutItemView) => (item.mode === "toggle" && item.hotkey ? hotkeyKeys(item.hotkey.accelerator, mac) : []);
</script>

<template>
  <div
    ref="root"
    class="canvas-layer relative h-screen w-screen overflow-hidden outline-none select-none"
    tabindex="0"
    @pointerdown.self="clearSelection"
    @pointermove="move"
    @pointerup="end"
    @pointercancel="abort"
    @lostpointercapture="abort"
  >
    <div
      v-for="item in shown"
      :key="item.id"
      :style="styleOf(item)"
      :class="
        cn(
          'absolute box-border cursor-move',
          item.live ? 'border border-dashed border-white/40' : 'bg-card/85 border-border border',
          item.off && !item.live && 'opacity-50',
          view?.selection === item.id && 'border-primary border-2 border-solid',
        )
      "
      :data-testid="`layout-item-${item.id}`"
      @pointerdown="begin($event, item, null)"
    >
      <span v-if="!item.live" class="text-foreground pointer-events-none block truncate px-2 py-1 text-xs font-medium">{{ item.name }}</span>
      <span v-else-if="item.idle" class="text-foreground/80 pointer-events-none flex h-full flex-col items-center justify-center gap-0.5 px-2 text-center text-xs">
        <span class="max-w-full truncate font-medium">{{ item.name }}</span>
        <span class="max-w-full truncate">{{ t("overlays.layout.idle") }}</span>
      </span>
      <span v-if="keyOf(item).length" class="pointer-events-none absolute top-1 right-1 flex items-center gap-0.5" :class="item.off && 'opacity-60'">
        <Kbd v-for="key in keyOf(item)" :key="key">{{ key }}</Kbd>
      </span>
      <template v-if="view?.selection === item.id">
        <span
          v-for="handle in HANDLES"
          :key="handle.edge"
          :class="cn('bg-primary border-background absolute size-3 rounded-sm border', handle.at)"
          :style="{ cursor: handle.cursor }"
          :data-testid="`layout-handle-${handle.edge}`"
          @pointerdown="begin($event, item, handle.edges)"
        />
      </template>
    </div>
    <div
      v-for="(guide, index) in guides"
      :key="`${guide.axis}${index}`"
      class="bg-primary/80 pointer-events-none absolute"
      :style="guide.axis === 'x' ? { left: `${guide.at * scale}px`, top: 0, bottom: 0, width: '1px' } : { top: `${guide.at * scale}px`, left: 0, right: 0, height: '1px' }"
    />
  </div>
</template>

<style>
html:has(.canvas-layer),
html:has(.canvas-layer) body {
  background: transparent !important;
}
</style>
