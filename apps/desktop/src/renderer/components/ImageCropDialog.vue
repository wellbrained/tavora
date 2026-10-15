<script setup lang="ts">
import { Minus, Plus } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useFloating } from "../host";

// Crops a picked image to a square: drag to move it, zoom with the slider or
// the mouse wheel. Used for the profile picture; meant for game icons too.
const props = withDefaults(
  defineProps<{
    /** The picked image as a data URL; null keeps the dialog closed. */
    src: string | null;
    title: string;
    /** Round shows the circle the picture will be seen in. */
    round?: boolean;
    /** Width and height of the saved PNG. */
    size?: number;
  }>(),
  { round: false, size: 256 },
);
const emit = defineEmits<{ save: [png: string]; cancel: [] }>();

/** The on-screen crop area, in CSS pixels. */
const VIEW = 280;
const MAX_ZOOM = 4;

const image = ref<HTMLImageElement | null>(null);
const zoom = ref(1);
/** Where the image centre sits, relative to the crop area centre. */
const offset = ref({ x: 0, y: 0 });
const saving = ref(false);

const open = computed(() => props.src !== null);
const track = useFloating();
watch(open, track, { immediate: true });

watch(
  () => props.src,
  (src) => {
    image.value = null;
    zoom.value = 1;
    offset.value = { x: 0, y: 0 };
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (props.src === src) image.value = img;
    };
    img.src = src;
  },
  { immediate: true },
);

/** Scale that makes the image just cover the crop area at zoom 1. */
const baseScale = computed(() => (image.value ? Math.max(VIEW / image.value.naturalWidth, VIEW / image.value.naturalHeight) : 1));
const shown = computed(() => {
  const scale = baseScale.value * zoom.value;
  return { width: (image.value?.naturalWidth ?? 0) * scale, height: (image.value?.naturalHeight ?? 0) * scale };
});

/** Keeps the image covering the whole crop area. */
function clamp(x: number, y: number) {
  const maxX = Math.max(0, (shown.value.width - VIEW) / 2);
  const maxY = Math.max(0, (shown.value.height - VIEW) / 2);
  offset.value = { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) };
}

function setZoom(value: number) {
  const next = Math.min(MAX_ZOOM, Math.max(1, value));
  // Zoom around the centre of the crop area.
  const ratio = next / zoom.value;
  zoom.value = next;
  clamp(offset.value.x * ratio, offset.value.y * ratio);
}

let drag: { pointerId: number; x: number; y: number; from: { x: number; y: number } } | null = null;

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: { ...offset.value } };
}

function onPointerMove(event: PointerEvent) {
  if (drag?.pointerId !== event.pointerId) return;
  clamp(drag.from.x + event.clientX - drag.x, drag.from.y + event.clientY - drag.y);
}

function onPointerUp(event: PointerEvent) {
  if (drag?.pointerId === event.pointerId) drag = null;
}

function onWheel(event: WheelEvent) {
  setZoom(zoom.value * Math.exp(-event.deltaY * 0.0015));
}

function onKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 40 : 10;
  const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  const move = moves[event.key];
  if (move) clamp(offset.value.x + move[0], offset.value.y + move[1]);
  else if (event.key === "+" || event.key === "=") setZoom(zoom.value * 1.1);
  else if (event.key === "-") setZoom(zoom.value / 1.1);
  else return;
  event.preventDefault();
}

function save() {
  const img = image.value;
  if (!img) return;
  saving.value = true;
  const scale = baseScale.value * zoom.value;
  // The crop area in the image's own pixels.
  const left = VIEW / 2 + offset.value.x - shown.value.width / 2;
  const top = VIEW / 2 + offset.value.y - shown.value.height / 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = props.size;
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(img, -left / scale, -top / scale, VIEW / scale, VIEW / scale, 0, 0, props.size, props.size);
  emit("save", canvas.toDataURL("image/png").slice("data:image/png;base64,".length));
  saving.value = false;
}

function onOpenChange(value: boolean) {
  if (!value) emit("cancel");
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="gap-5 sm:max-w-[360px]" data-testid="crop-dialog" :show-close-button="false">
      <div class="flex flex-col gap-1">
        <DialogTitle class="text-lg">{{ title }}</DialogTitle>
        <DialogDescription>Drag to move the picture, scroll or use the slider to zoom.</DialogDescription>
      </div>

      <div
        class="bg-muted focus-visible:ring-ring relative mx-auto cursor-grab touch-none overflow-hidden rounded-lg select-none focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing"
        :style="{ width: `${VIEW}px`, height: `${VIEW}px` }"
        tabindex="0"
        role="img"
        aria-label="Crop area. Arrow keys move the picture, plus and minus zoom."
        data-testid="crop-area"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
        @keydown="onKey"
      >
        <img
          v-if="image"
          :src="src!"
          alt=""
          draggable="false"
          class="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
          :style="{
            width: `${shown.width}px`,
            height: `${shown.height}px`,
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
          }"
        />
        <!-- Dims everything outside the part that is kept. -->
        <div
          class="pointer-events-none absolute inset-0 border border-white/40 shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]"
          :class="round ? 'rounded-full' : 'rounded-lg'"
        />
      </div>

      <div class="flex items-center gap-3">
        <Button size="icon-sm" variant="ghost" aria-label="Zoom out" title="Zoom out" :disabled="zoom <= 1" @click="setZoom(zoom / 1.25)">
          <Minus :stroke-width="1.5" />
        </Button>
        <input
          type="range"
          class="accent-primary min-w-0 flex-1"
          min="1"
          :max="MAX_ZOOM"
          step="0.01"
          aria-label="Zoom"
          data-testid="crop-zoom"
          :value="zoom"
          @input="setZoom(Number(($event.target as HTMLInputElement).value))"
        />
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" title="Zoom in" :disabled="zoom >= MAX_ZOOM" @click="setZoom(zoom * 1.25)">
          <Plus :stroke-width="1.5" />
        </Button>
      </div>

      <div class="flex justify-end gap-2">
        <Button variant="secondary" data-testid="crop-cancel" @click="emit('cancel')">Cancel</Button>
        <Button data-testid="crop-save" :disabled="!image || saving" @click="save">Save</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
