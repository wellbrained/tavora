<script setup lang="ts">
// The layer over the Overlay layout's canvas: a transparent page that takes the mouse (the live pages below it can't) and
// draws what the user works with: each item's outline, the selection with its eight handles, the key of a toggle
// item, and the guide lines while something snaps. Dragging works in canvas units (the game window at 1080 high); the
// main process moves the live pages and keeps the result. Holding Alt places freely. A double-click opens the item's settings. The selected item gets a small
// toolbar (Settings, Hide, Reset position, Reset size, Remove) above it, or below it where there is no room above.
// Ctrl (Cmd on a Mac) or Shift and a click add a frame to the selection or take it out; a box drawn on the empty canvas
// selects the frames it touches. Several selected move together (drag or arrow keys) and share one toolbar.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { cn } from "@/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import { boundsOf, moveTogether, snapMove, snapResize, type Edges, type Guide } from "../../../shared/layout-math";
import type { LayoutItemView } from "../../../shared/layout-view";
import type { Rect } from "../../../shared/overlay-anchor";
import { t } from "../../i18n";
import FrameToolbar from "./FrameToolbar.vue";
import { send, useLayoutKeys, view } from "./layout-state";

useLayoutKeys();

const root = ref<HTMLElement>();
const width = ref(1);
const height = ref(1);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(() => {
    width.value = root.value?.clientWidth || 1;
    height.value = root.value?.clientHeight || 1;
  });
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
  /** The frames moved (the one resized, with `edges`). */
  ids: string[];
  /** The frame grabbed. */
  id: string;
  edges: Edges | null;
  start: { x: number; y: number };
  origins: Record<string, Rect>;
  pointer: number;
  /** A plain press on one of several selected: let go without moving, only that one stays selected. */
  narrow: boolean;
  moved: boolean;
}
const drag = ref<Drag | null>(null);

/** A box drawn on the empty canvas (canvas units), and the selection it adds to (with Ctrl or Shift). */
interface Band {
  start: { x: number; y: number };
  now: { x: number; y: number };
  base: string[];
  pointer: number;
}
const band = ref<Band | null>(null);
/** Where the items are while being dragged, and until the main process has sent the result. */
const local = shallowRef<Record<string, Rect>>({});
const guides = ref<Guide[]>([]);
let frame = 0;
let pending: { id: string; rect: Rect }[] | null = null;

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

const selectedIds = computed(() => view.value?.selected ?? []);
/** What shows as selected: while a box is drawn, what it would select. */
const marked = computed(() => {
  const current = band.value;
  if (!current) return new Set(selectedIds.value);
  return new Set([...current.base, ...hitsOf(current)]);
});
const isMarked = (item: LayoutItemView) => marked.value.has(item.id);
/** The handles show on one selected frame only: several are moved, not resized. */
const single = computed(() => (band.value || selectedIds.value.length !== 1 ? null : selectedIds.value[0]!));

/** A placement message for one frame or several. */
const placement = (items: { id: string; rect: Rect }[]) => (items.length === 1 ? { id: items[0]!.id, rect: items[0]!.rect } : { items });

function begin(event: PointerEvent, item: LayoutItemView, edges: Edges | null) {
  if (event.button !== 0) return;
  event.stopPropagation();
  root.value?.focus();
  const selected = selectedIds.value;
  let ids: string[];
  let narrow = false;
  if (!edges && (event.ctrlKey || event.metaKey || event.shiftKey)) {
    // Ctrl, Cmd or Shift: in or out of the selection. One taken out is not dragged.
    const next = selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id];
    send({ type: "select", ids: next });
    if (!next.includes(item.id)) return;
    ids = next;
  } else if (edges || !selected.includes(item.id)) {
    if (selected.length !== 1 || selected[0] !== item.id) send({ type: "select", id: item.id });
    ids = [item.id];
  } else {
    ids = selected;
    narrow = selected.length > 1;
  }
  const visible = shown.value.filter((one) => ids.includes(one.id));
  drag.value = {
    ids: visible.map((one) => one.id),
    id: item.id,
    edges,
    start: { x: event.clientX, y: event.clientY },
    origins: Object.fromEntries(visible.map((one) => [one.id, rectOf(one)])),
    pointer: event.pointerId,
    narrow,
    moved: false,
  };
  root.value?.setPointerCapture(event.pointerId);
}

/** Where the pointer is on the canvas, in canvas units. */
function canvasPoint(event: PointerEvent): { x: number; y: number } {
  const box = root.value?.getBoundingClientRect();
  return { x: (event.clientX - (box?.left ?? 0)) / scale.value, y: (event.clientY - (box?.top ?? 0)) / scale.value };
}

/** The frames a box touches. */
function hitsOf(current: Band): string[] {
  const left = Math.min(current.start.x, current.now.x);
  const top = Math.min(current.start.y, current.now.y);
  const right = Math.max(current.start.x, current.now.x);
  const bottom = Math.max(current.start.y, current.now.y);
  return shown.value
    .filter((item) => {
      const rect = rectOf(item);
      return rect.x <= right && rect.x + rect.width >= left && rect.y <= bottom && rect.y + rect.height >= top;
    })
    .map((item) => item.id);
}

/** A press on the empty canvas starts a box; with Ctrl, Cmd or Shift it adds to what is selected. */
function beginBand(event: PointerEvent) {
  if (event.button !== 0) return;
  root.value?.focus();
  const point = canvasPoint(event);
  band.value = { start: point, now: point, base: event.ctrlKey || event.metaKey || event.shiftKey ? [...selectedIds.value] : [], pointer: event.pointerId };
  root.value?.setPointerCapture(event.pointerId);
}

const bandStyle = computed(() => {
  const current = band.value;
  if (!current) return null;
  const k = scale.value;
  const left = Math.min(current.start.x, current.now.x);
  const top = Math.min(current.start.y, current.now.y);
  return { left: `${left * k}px`, top: `${top * k}px`, width: `${Math.abs(current.now.x - current.start.x) * k}px`, height: `${Math.abs(current.now.y - current.start.y) * k}px` };
});

function move(event: PointerEvent) {
  if (band.value) {
    band.value = { ...band.value, now: canvasPoint(event) };
    return;
  }
  const current = drag.value;
  const now = view.value;
  if (!current || !now || !current.ids.length) return;
  const dx = (event.clientX - current.start.x) / scale.value;
  const dy = (event.clientY - current.start.y) / scale.value;
  if (!current.moved && Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) < 3) return;
  current.moved = true;
  const others = shown.value.filter((item) => !current.ids.includes(item.id)).map(rectOf);
  const options = { cell: now.cell, threshold: 8 / scale.value, free: event.altKey };
  if (!current.edges) {
    // One frame or several: the box around them snaps, and each keeps its place in it.
    const origins = current.ids.map((id) => current.origins[id]!);
    const box = boundsOf(origins);
    const result = snapMove({ ...box, x: box.x + dx, y: box.y + dy }, now.canvas, others, options);
    const rects = moveTogether(origins, result.rect.x - box.x, result.rect.y - box.y, now.canvas);
    const items = current.ids.map((id, index) => ({ id, rect: rects[index]! }));
    local.value = { ...local.value, ...Object.fromEntries(items.map((item) => [item.id, item.rect])) };
    guides.value = result.guides;
    follow(items);
    return;
  }
  const origin = current.origins[current.id]!;
  const result = snapResize(
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
  );
  local.value = { ...local.value, [current.id]: result.rect };
  guides.value = result.guides;
  follow([{ id: current.id, rect: result.rect }]);
}

/** The live pages follow, once per frame. */
function follow(items: { id: string; rect: Rect }[]) {
  pending = items;
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    if (pending) send({ type: "drag", ...placement(pending) });
  });
}

function end(event: PointerEvent) {
  const box = band.value;
  if (box) {
    band.value = null;
    if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
    // A click without a box lets go of the selection (with Ctrl or Shift it keeps it).
    const drawn = Math.abs(box.now.x - box.start.x) * scale.value >= 3 || Math.abs(box.now.y - box.start.y) * scale.value >= 3;
    const ids = drawn ? [...new Set([...box.base, ...hitsOf(box)])] : box.base;
    send({ type: "select", ids });
    return;
  }
  const current = drag.value;
  if (!current) return;
  drag.value = null;
  guides.value = [];
  cancelAnimationFrame(frame);
  frame = 0;
  pending = null;
  if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
  if (!current.moved) {
    if (current.narrow) send({ type: "select", id: current.id });
    return;
  }
  const items = current.ids.flatMap((id) => (local.value[id] ? [{ id, rect: local.value[id] }] : []));
  if (items.length) send({ type: "commit", ...placement(items) });
  // The new view normally replaces this at once; if nothing changed there is none, so it is dropped anyway.
  setTimeout(() => {
    if (!drag.value) local.value = {};
  }, 400);
}

/** The pointer was lost (cancelled, the window lost the focus): the drag ends without a drop, and the item stays where it was. */
function abort() {
  if (band.value) {
    band.value = null;
    return;
  }
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

/** A double-click on the selected item opens its settings (the pointer is captured by the layer, so the click lands here). */
function openSettingsAt(event: MouseEvent) {
  const item = shown.value.find((candidate) => candidate.id === single.value);
  const box = root.value?.getBoundingClientRect();
  if (!item || !box) return;
  const rect = rectOf(item);
  const x = (event.clientX - box.left) / scale.value;
  const y = (event.clientY - box.top) / scale.value;
  if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) send({ type: "settings", id: item.id });
}

/** The toolbar's size in screen pixels (three small buttons in a padded frame) and its gap to the item, past the handles. */
const BAR = { width: 176, height: 38, gap: 12 } as const;

/**
 * Where the toolbar of the selected frames sits: above them, below them when there is no room above, else inside their
 * top edge. It acts on every frame selected, the ones hidden on the canvas too.
 */
const toolbar = computed(() => {
  const items = (view.value?.items ?? []).filter((candidate) => selectedIds.value.includes(candidate.id));
  const visible = items.filter((candidate) => !candidate.hiddenOnCanvas);
  if (!visible.length || drag.value || band.value) return null;
  const rect = boundsOf(visible.map(rectOf));
  const k = scale.value;
  let side: "top" | "bottom" = "top";
  let y = rect.y * k - BAR.height - BAR.gap;
  if (y < 0) {
    side = "bottom";
    y = (rect.y + rect.height) * k + BAR.gap;
    if (y + BAR.height > height.value) y = Math.max(0, Math.min(rect.y * k + BAR.gap, height.value - BAR.height));
  }
  const x = Math.max(0, Math.min(rect.x * k, width.value - BAR.width));
  return { items, side, style: { left: `${x}px`, top: `${y}px` } };
});

const keyOf = (item: LayoutItemView) => (item.mode === "toggle" && item.hotkey ? hotkeyKeys(item.hotkey.accelerator, mac) : []);
</script>

<template>
  <div
    ref="root"
    class="canvas-layer relative h-screen w-screen overflow-hidden outline-none select-none"
    tabindex="0"
    @pointerdown.self="beginBand"
    @pointermove="move"
    @pointerup="end"
    @dblclick="openSettingsAt"
    @pointercancel="abort"
    @lostpointercapture="abort"
  >
    <!-- An empty canvas says what to do instead of staying blank. -->
    <p
      v-if="view && !view.items.length"
      class="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm"
      data-testid="layout-canvas-empty"
    >
      {{ t(view.sidebar === "left" ? "overlays.layout.emptyCanvas.left" : "overlays.layout.emptyCanvas.right") }}
    </p>
    <div
      v-for="item in shown"
      :key="item.id"
      :style="styleOf(item)"
      :class="
        cn(
          'absolute box-border cursor-move',
          item.live ? 'border border-dashed border-white/40' : 'bg-card/85 border-border border',
          item.off && !item.live && 'opacity-50',
          isMarked(item) && 'border-primary border-2 border-solid',
        )
      "
      :data-testid="`layout-item-${item.id}`"
      :data-selected="isMarked(item) || undefined"
      @pointerdown="begin($event, item, null)"
    >
      <span v-if="!item.live" class="text-foreground pointer-events-none block truncate px-2 py-1 text-xs font-medium">{{ item.name }}</span>
      <span v-else-if="item.idle" class="text-foreground/80 pointer-events-none flex h-full flex-col items-center justify-center gap-0.5 px-2 text-center text-xs">
        <span class="max-w-full truncate font-medium">{{ item.name }}</span>
        <span class="max-w-full truncate">{{ t(item.idle === "stopped" ? "overlays.layout.idle" : "overlays.layout.empty") }}</span>
      </span>
      <span v-if="keyOf(item).length" class="pointer-events-none absolute top-1 right-1 flex items-center gap-0.5" :class="item.off && 'opacity-60'">
        <Kbd v-for="key in keyOf(item)" :key="key">{{ key }}</Kbd>
      </span>
      <template v-if="single === item.id">
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
    <FrameToolbar v-if="toolbar" :items="toolbar.items" :side="toolbar.side" :style="toolbar.style" @done="root?.focus()" />
    <div v-if="bandStyle" class="border-primary bg-primary/10 pointer-events-none absolute rounded-sm border" :style="bandStyle" data-testid="layout-band" />
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
