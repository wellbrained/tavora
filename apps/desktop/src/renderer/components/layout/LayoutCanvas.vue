<script setup lang="ts">
// The layer over the Overlay layout's canvas: a transparent page that takes the mouse (the live pages below it can't) and
// draws what the user works with: each item's outline, the selection with its eight handles, the key of a toggle
// item, and the guide lines while something snaps. Dragging works in canvas units (the game window at 1080 high); the
// main process moves the live pages and keeps the result. Holding Alt places freely. A double-click opens the item's settings. The selected item gets a small
// toolbar (what the user pinned in the frame menu) at its top right, above it, or below it where there is no room above. A right-click or the menu key opens the frame menu next to the frame.
// Several can be selected: Ctrl (Cmd on a Mac) or Shift and a click adds or takes one away, and a box drawn on the empty
// canvas selects every frame it touches. They move together (drag or the arrow keys) and share one toolbar (Hide, Reset
// position, Reset size, Remove) over the box around them.
import { Lock } from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@tavora/official-ui/components/ui/context-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@tavora/official-ui/components/ui/popover";
import { Kbd } from "@tavora/official-ui/components/ui/kbd";
import { cn } from "@tavora/official-ui/lib/utils";
import { hotkeyKeys } from "../../../shared/hotkey-keys";
import { boundsOf, snapMove, snapResize, touches, type Edges, type Guide } from "../../../shared/layout-math";
import type { LayoutItemView } from "../../../shared/layout-view";
import type { Rect } from "../../../shared/overlay-anchor";
import { state } from "../../host";
import { t } from "../../i18n";
import { isGroupAction } from "../../../shared/layout-toolbar";
import FrameMenu from "./FrameMenu.vue";
import FrameToolbar from "./FrameToolbar.vue";
import ToolbarCustomize from "./ToolbarCustomize.vue";
import { selectedItems, send, useLayoutKeys, view } from "./layout-state";

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
  addEventListener("keydown", menuKey);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  removeEventListener("blur", abort);
  removeEventListener("keydown", menuKey);
});

/** Screen pixels per canvas unit. */
const scale = computed(() => (view.value ? width.value / view.value.canvas.width : 1));
const mac = navigator.platform.startsWith("Mac");

interface Drag {
  /** The frame grabbed; with `edges`, the one resized. */
  id: string;
  /** Every frame that moves (the grabbed one and the others selected with it). */
  ids: string[];
  edges: Edges | null;
  start: { x: number; y: number };
  origins: Record<string, Rect>;
  pointer: number;
  /** A click on one of several selected frames that didn't move selects only it. */
  only: string | null;
  moved: boolean;
}
const drag = ref<Drag | null>(null);
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
/** The selected frames, and while a box is drawn, the ones it will select. */
const chosen = computed(() => new Set(band.value ? band.value.ids : (view.value?.selected ?? [])));
/** Exactly one frame is selected: it has handles to resize and the full toolbar. */
const single = computed(() => (chosen.value.size === 1 ? (view.value?.selection ?? null) : null));
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

/** Ctrl or Cmd, or Shift: a click adds to the selection or takes away from it. */
const adds = (event: PointerEvent | MouseEvent) => event.shiftKey || (mac ? event.metaKey : event.ctrlKey);

function begin(event: PointerEvent, item: LayoutItemView, edges: Edges | null) {
  if (event.button !== 0) return;
  event.stopPropagation();
  root.value?.focus();
  const selected = view.value?.selected ?? [];
  let ids: string[];
  let only: string | null = null;
  if (edges) ids = [item.id];
  else if (adds(event)) {
    // Taken away: nothing to drag. Added: it moves with the others at once.
    if (selected.includes(item.id)) {
      send({ type: "select", ids: selected.filter((id) => id !== item.id) });
      return;
    }
    ids = [...selected, item.id];
    send({ type: "select", ids });
  } else if (selected.includes(item.id) && selected.length > 1) {
    ids = selected;
    only = item.id;
  } else {
    ids = [item.id];
    if (view.value?.selection !== item.id || selected.length !== 1) send({ type: "select", id: item.id });
  }
  // A locked frame is selected and clicked like any other, but never moves (with others, they move and it stays).
  const moving = shown.value.filter((one) => ids.includes(one.id) && !one.locked);
  drag.value = { id: item.id, ids: moving.map((one) => one.id), edges, start: { x: event.clientX, y: event.clientY }, origins: Object.fromEntries(moving.map((one) => [one.id, rectOf(one)])), pointer: event.pointerId, only, moved: false };
  root.value?.setPointerCapture(event.pointerId);
}

function move(event: PointerEvent) {
  if (band.value) return moveBand(event);
  const current = drag.value;
  const now = view.value;
  if (!current || !now || current.ids.length === 0) return;
  const dx = (event.clientX - current.start.x) / scale.value;
  const dy = (event.clientY - current.start.y) / scale.value;
  if (!current.moved && Math.hypot(dx, dy) * scale.value < 3) return;
  current.moved = true;
  const others = shown.value.filter((item) => !current.ids.includes(item.id)).map(rectOf);
  const options = { cell: now.cell, threshold: 8 / scale.value, free: event.altKey };
  let rects: Record<string, Rect>;
  if (current.edges) {
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
    rects = { [current.id]: result.rect };
    guides.value = result.guides;
  } else {
    // The box around the frames snaps (and stays on the canvas); each frame moves by as much, so they keep their places to each other.
    const box = boundsOf(Object.values(current.origins))!;
    const result = snapMove({ ...box, x: box.x + dx, y: box.y + dy }, now.canvas, others, options);
    const shiftX = result.rect.x - box.x;
    const shiftY = result.rect.y - box.y;
    rects = Object.fromEntries(Object.entries(current.origins).map(([id, rect]) => [id, { ...rect, x: rect.x + shiftX, y: rect.y + shiftY }]));
    guides.value = result.guides;
  }
  local.value = { ...local.value, ...rects };
  // The live pages follow, once per frame.
  pending = Object.entries(rects).map(([id, rect]) => ({ id, rect }));
  frame ||= requestAnimationFrame(() => {
    frame = 0;
    if (pending) send({ type: "drag", rects: pending });
  });
}

function end(event: PointerEvent) {
  if (band.value) return endBand(event);
  const current = drag.value;
  if (!current) return;
  drag.value = null;
  guides.value = [];
  cancelAnimationFrame(frame);
  frame = 0;
  pending = null;
  if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
  if (!current.moved) {
    // A click on one of several selected frames: only that one stays selected.
    if (current.only) send({ type: "select", id: current.only });
    return;
  }
  const rects = current.ids.flatMap((id) => (local.value[id] ? [{ id, rect: local.value[id]! }] : []));
  if (rects.length === 1) send({ type: "commit", ...rects[0]! });
  else if (rects.length) send({ type: "commit", rects });
  // The new view normally replaces this at once; if nothing changed there is none, so it is dropped anyway.
  setTimeout(() => {
    if (!drag.value) local.value = {};
  }, 400);
}

/** The pointer was lost (cancelled, the window lost the focus): the drag ends without a drop, and the items stay where they were. */
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

// ── The box drawn on the empty canvas ───────────────────────────────

interface Band {
  /** Where it started and where the pointer is, in canvas units. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** What was selected before, kept with Ctrl, Cmd or Shift. */
  base: string[];
  /** What it selects now: the base and every frame it touches. */
  ids: string[];
  pointer: number;
  moved: boolean;
}
const band = ref<Band | null>(null);

function pointAt(event: PointerEvent): { x: number; y: number } {
  const box = root.value?.getBoundingClientRect();
  return { x: (event.clientX - (box?.left ?? 0)) / scale.value, y: (event.clientY - (box?.top ?? 0)) / scale.value };
}

const bandRect = computed<Rect | null>(() => {
  const current = band.value;
  if (!current) return null;
  return { x: Math.min(current.from.x, current.to.x), y: Math.min(current.from.y, current.to.y), width: Math.abs(current.to.x - current.from.x), height: Math.abs(current.to.y - current.from.y) };
});

function beginBand(event: PointerEvent) {
  root.value?.focus();
  if (event.button !== 0) return;
  const base = adds(event) ? [...(view.value?.selected ?? [])] : [];
  const at = pointAt(event);
  band.value = { from: at, to: at, base, ids: base, pointer: event.pointerId, moved: false };
  root.value?.setPointerCapture(event.pointerId);
}

function moveBand(event: PointerEvent) {
  const current = band.value!;
  const to = pointAt(event);
  const moved = current.moved || Math.hypot(to.x - current.from.x, to.y - current.from.y) * scale.value >= 3;
  const next = { ...current, to, moved };
  const rect = { x: Math.min(next.from.x, to.x), y: Math.min(next.from.y, to.y), width: Math.abs(to.x - next.from.x), height: Math.abs(to.y - next.from.y) };
  const touched = moved ? shown.value.filter((item) => touches(rect, rectOf(item))).map((item) => item.id) : [];
  band.value = { ...next, ids: [...next.base, ...touched.filter((id) => !next.base.includes(id))] };
}

function endBand(event: PointerEvent) {
  const current = band.value!;
  band.value = null;
  if (root.value?.hasPointerCapture(event.pointerId)) root.value.releasePointerCapture(event.pointerId);
  // A click on the empty canvas lets go of the selection (with Ctrl or Shift, it keeps it).
  // Copies: what is sent can't be the page's own reactive lists.
  send({ type: "select", ids: [...(current.moved ? current.ids : current.base)] });
}

/** A toolbar button's width in screen pixels, with the gap between buttons; a submenu button has its small arrow too. */
const BUTTON = { width: 30, group: 42, padding: 10, height: 38, gap: 12 } as const;

/** Where the toolbar sits: at the top right of the selected frames, above them (below them when there is no room above, else inside their top edge). */
const toolbar = computed(() => {
  if (drag.value || band.value) return null;
  const setting = view.value?.toolbar;
  if (!setting?.show || !setting.pins.length) return null;
  const items = selectedItems(view.value).filter((item) => !item.hiddenOnCanvas);
  const rect = boundsOf(items.map(rectOf));
  if (!rect) return null;
  const k = scale.value;
  const bar = BUTTON.padding + setting.pins.reduce((sum, id) => sum + (isGroupAction(id) ? BUTTON.group : BUTTON.width), 0);
  let side: "top" | "bottom" = "top";
  let y = rect.y * k - BUTTON.height - BUTTON.gap;
  if (y < 0) {
    side = "bottom";
    y = (rect.y + rect.height) * k + BUTTON.gap;
    if (y + BUTTON.height > height.value) y = Math.max(0, Math.min(rect.y * k + BUTTON.gap, height.value - BUTTON.height));
  }
  // Its right edge is the frame's right edge; a frame too close to the left edge pushes it to the canvas's left edge instead.
  const edge = (rect.x + rect.width) * k;
  const style = edge >= bar ? { right: `${Math.max(0, width.value - edge)}px`, top: `${y}px` } : { left: "0px", top: `${y}px` };
  return { items, side, style };
});

// ── The right-click menu ───────────────────────────────────────────

/** The frame the menu was opened on; the menu is for the selected frames when it is one of them, else for it alone. */
const menuId = ref<string | null>(null);
const menuItems = computed(() => {
  const selected = selectedItems(view.value);
  const own = shown.value.filter((item) => item.id === menuId.value);
  return selected.some((item) => item.id === menuId.value) ? selected.filter((item) => !item.hiddenOnCanvas) : own;
});
/** The frames' elements, to open the menu from the keyboard next to a frame. */
const frameEls = new Map<string, HTMLElement>();
const setEl = (id: string, el: unknown) => (el instanceof HTMLElement ? frameEls.set(id, el) : frameEls.delete(id));

/** A right-click selects the frame when it isn't selected already, then the menu opens (the kit's trigger does that, next to the frame). */
function aim(item: LayoutItemView) {
  menuId.value = item.id;
  if (!(view.value?.selected ?? []).includes(item.id)) send({ type: "select", id: item.id });
}

// ── Customize toolbar… ─────────────────────────────────────────────

const customizing = ref(false);
const customAnchor = shallowRef<HTMLElement | null>(null);

/** The popover points at the toolbar, or at the frame when the toolbar is off. */
function customizeAnchor(): HTMLElement | null {
  const bar = view.value?.toolbar.show ? root.value?.querySelector<HTMLElement>('[data-testid="layout-frame-toolbar"]') : null;
  return bar ?? (menuId.value ? (frameEls.get(menuId.value) ?? null) : null);
}

/** Customize toolbar… was picked: the popover opens once the menu has closed and let go of the focus, or it would take it back. */
let customizeNext = false;
function customize() {
  customizeNext = true;
}

/** The menu closed: the keyboard goes back to the layer, or to the popover that was asked for. */
function menuClosed() {
  if (!customizeNext) {
    root.value?.focus();
    return;
  }
  customizeNext = false;
  requestAnimationFrame(() => {
    customAnchor.value = customizeAnchor();
    customizing.value = customAnchor.value !== null;
  });
}

// The toolbar comes and goes while its buttons are ticked: the popover follows whatever is there.
watch(
  () => [view.value?.toolbar.show, view.value?.toolbar.pins.length === 0, toolbar.value === null],
  async () => {
    if (!customizing.value) return;
    await nextTick();
    customAnchor.value = customizeAnchor();
  },
);

/** The menu key and Shift+F10 open the menu for the selected frames, next to the first of them. */
function menuKey(event: KeyboardEvent) {
  if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
  if (!root.value || (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable], [role=menu], [role=dialog]"))) return;
  const first = selectedItems(view.value).find((item) => !item.hiddenOnCanvas);
  const el = first ? frameEls.get(first.id) : undefined;
  if (!first || !el) return;
  event.preventDefault();
  el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
}

/** The empty canvas names the side the Sources list is on (Settings > Overlays puts it left or right). */
const emptyHint = computed(() => t(state.value?.gameOverlays.sidebar === "left" ? "overlays.layout.addHint.left" : "overlays.layout.addHint.right"));

/** The frames being moved lift a little (scale only: they sit over a running game, so no shadow or blur) and settle when let go. */
const lifted = computed(() => new Set(drag.value?.moved && !drag.value.edges ? drag.value.ids : []));

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
    <!-- An empty setup says where to find something to add instead of staying blank. -->
    <p
      v-if="view && !view.items.length"
      class="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm"
      data-testid="layout-canvas-empty"
    >
      {{ emptyHint }}
    </p>
    <ContextMenu v-for="item in shown" :key="item.id">
      <ContextMenuTrigger as-child>
        <div
          :ref="(el) => setEl(item.id, el)"
          :style="{ ...styleOf(item), zIndex: item.z }"
          :class="
            cn(
              'absolute box-border transition-[scale] duration-(--duration-reorder) ease-(--ease-out-strong)',
              item.locked ? 'cursor-default' : 'cursor-move',
              lifted.has(item.id) && 'motion-safe:scale-[1.03]',
              item.live ? 'border border-dashed border-white/40' : 'bg-card/85 border-border border',
              item.off && !item.live && 'opacity-50',
              chosen.has(item.id) && 'border-primary border-2 border-solid',
            )
          "
          :data-testid="`layout-item-${item.id}`"
          :data-selected="chosen.has(item.id) || undefined"
          :data-locked="item.locked || undefined"
          @pointerdown="begin($event, item, null)"
          @contextmenu="aim(item)"
        >
          <span v-if="!item.live" class="text-foreground pointer-events-none block truncate px-2 py-1 text-xs font-medium">{{ item.name }}</span>
          <span v-else-if="item.idle" class="text-foreground/80 pointer-events-none flex h-full flex-col items-center justify-center gap-0.5 px-2 text-center text-xs">
            <span class="max-w-full truncate font-medium">{{ item.name }}</span>
            <span class="max-w-full truncate">{{ t(item.idle === "stopped" ? "overlays.layout.idle" : "overlays.layout.empty") }}</span>
          </span>
          <span v-if="keyOf(item).length" class="pointer-events-none absolute top-1 right-1 flex items-center gap-0.5" :class="item.off && 'opacity-60'">
            <Kbd v-for="key in keyOf(item)" :key="key">{{ key }}</Kbd>
          </span>
          <!-- The lock of the whiteboard's pictures: shown while the frame is locked, and the way to free it. -->
          <Button
            v-if="item.locked"
            type="button"
            variant="ghost"
            size="icon-xs"
            class="absolute right-1 bottom-1 size-6 bg-black/65 text-white hover:bg-black/80 hover:text-white"
            :aria-label="t('overlays.layout.unlock')"
            :title="t('overlays.layout.unlock')"
            data-testid="layout-frame-lock-badge"
            @pointerdown.stop
            @click="send({ type: 'lock', id: item.id, locked: false })"
          >
            <Lock :stroke-width="2" />
          </Button>
          <template v-if="single === item.id && !item.locked">
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
      </ContextMenuTrigger>
      <FrameMenu v-if="menuId === item.id" :items="menuItems" @closed="menuClosed" @customize="customize" />
    </ContextMenu>
    <FrameToolbar v-if="toolbar" :items="toolbar.items" :side="toolbar.side" :style="toolbar.style" @done="root?.focus()" />
    <Popover v-model:open="customizing">
      <PopoverAnchor v-if="customAnchor" :reference="customAnchor" />
      <PopoverContent :side="toolbar && view?.toolbar.show ? toolbar.side : 'right'" align="end" class="max-h-(--reka-popover-content-available-height) w-64 overflow-y-auto" data-testid="layout-customize" @close-auto-focus="(event: Event) => (event.preventDefault(), root?.focus())">
        <ToolbarCustomize :items="menuItems" />
      </PopoverContent>
    </Popover>
    <div
      v-if="bandRect && band?.moved"
      class="border-primary bg-primary/10 pointer-events-none absolute rounded-sm border"
      :style="{ left: `${bandRect.x * scale}px`, top: `${bandRect.y * scale}px`, width: `${bandRect.width * scale}px`, height: `${bandRect.height * scale}px` }"
      data-testid="layout-band"
    />
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
