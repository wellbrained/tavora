<script setup lang="ts">
import { Crop, Minus, Plus, Save } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Slider } from "@tavora/official-ui/components/ui/slider";
import { Dialog, DialogButton, DialogContent, DialogFooter, DialogHeader } from "@tavora/official-ui/components/ui/dialog";
import { bindDrag, type DragDelta } from "@tavora/official-ui/lib/bind-drag";
import { t } from "../i18n";

// Crops a picked image to a square. The whole image stays still and fitted;
// the user moves the crop frame over it and sizes it with the slider, the
// mouse wheel or the handle on its edge. Used for the profile picture; meant
// for workspace icons too.
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

/** The on-screen area the image is fitted into, in CSS pixels. */
const VIEW = 280;
/** The smallest frame, as a share of the image's short side. */
const MIN_SHARE = 0.25;

const image = ref<HTMLImageElement | null>(null);
/** The crop frame in area pixels: its top-left corner and side length. */
const frame = ref({ x: 0, y: 0, side: 0 });
const saving = ref(false);

const open = computed(() => props.src !== null);

/** Where the fitted image sits in the area, and its scale from natural pixels. */
const fit = computed(() => {
  const img = image.value;
  if (!img) return { left: 0, top: 0, width: 0, height: 0, scale: 1 };
  const scale = Math.min(VIEW / img.naturalWidth, VIEW / img.naturalHeight);
  const width = img.naturalWidth * scale;
  const height = img.naturalHeight * scale;
  return { left: (VIEW - width) / 2, top: (VIEW - height) / 2, width, height, scale };
});
const maxSide = computed(() => Math.min(fit.value.width, fit.value.height));
const minSide = computed(() => maxSide.value * MIN_SHARE);
/** The frame size as a share of the largest possible, for the slider. */
const share = computed(() => (maxSide.value ? frame.value.side / maxSide.value : 1));

watch(
  () => props.src,
  (src) => {
    image.value = null;
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      if (props.src !== src) return;
      image.value = img;
      // Start with the largest frame, centred.
      const side = maxSide.value;
      frame.value = { x: fit.value.left + (fit.value.width - side) / 2, y: fit.value.top + (fit.value.height - side) / 2, side };
    };
    img.src = src;
  },
  { immediate: true },
);

/** Places the frame, keeping it whole and on the image. */
function place(x: number, y: number, side: number) {
  const s = Math.min(maxSide.value, Math.max(minSide.value, side));
  const { left, top, width, height } = fit.value;
  frame.value = {
    side: s,
    x: Math.min(left + width - s, Math.max(left, x)),
    y: Math.min(top + height - s, Math.max(top, y)),
  };
}

/** Resizes around the frame's centre. */
function resize(side: number) {
  const { x, y, side: old } = frame.value;
  const s = Math.min(maxSide.value, Math.max(minSide.value, side));
  place(x + (old - s) / 2, y + (old - s) / 2, s);
}

// A drag of the frame or of its handle. Escape (instead of closing the dialog), or a pointer the system takes away
// (pointercancel), puts the frame back where it was when the drag started.
const drag = bindDrag();
// The dialog closing mid-drag (Cancel by keyboard, the picture taken away) ends the drag too.
watch(open, (isOpen) => {
  if (!isOpen) drag.cancel();
});

/** `follow` runs once a drag still going on is put back: it reads the frame and gives what each move does. */
function dragFrame(event: PointerEvent, follow: () => (event: PointerEvent, delta: DragDelta) => void) {
  drag.start(
    event,
    () => {
      const before = { ...frame.value };
      return { move: follow(), cancel: () => (frame.value = before) };
    },
    { capture: event.currentTarget as HTMLElement },
  );
}

function onMoveStart(event: PointerEvent) {
  if (event.button !== 0 || !image.value) return;
  dragFrame(event, () => {
    const { x, y } = frame.value;
    // The wheel may size the frame while it moves.
    return (_, delta) => place(x + delta.x, y + delta.y, frame.value.side);
  });
}

function onResizeStart(event: PointerEvent) {
  if (event.button !== 0 || !image.value) return;
  event.stopPropagation();
  const area = (event.currentTarget as HTMLElement).closest("[data-crop-area]")!.getBoundingClientRect();
  dragFrame(event, () => {
    const { x, y, side } = frame.value;
    const centre = { x: x + side / 2, y: y + side / 2 };
    return (next) => {
      // The handle sits on the circle's edge (or the square's corner), so the
      // pointer's distance from the centre is the radius (or half the side).
      const dx = next.clientX - area.left - centre.x;
      const dy = next.clientY - area.top - centre.y;
      resize(2 * (props.round ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy))));
    };
  });
}

function onWheel(event: WheelEvent) {
  resize(frame.value.side * Math.exp(-event.deltaY * 0.0015));
}

function onKey(event: KeyboardEvent) {
  const step = event.shiftKey ? 20 : 5;
  const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  const move = moves[event.key];
  if (move) place(frame.value.x + move[0], frame.value.y + move[1], frame.value.side);
  else if (event.key === "+" || event.key === "=") resize(frame.value.side * 1.1);
  else if (event.key === "-") resize(frame.value.side / 1.1);
  else return;
  event.preventDefault();
}

function save() {
  const img = image.value;
  if (!img) return;
  saving.value = true;
  try {
    const { left, top, scale } = fit.value;
    const { x, y, side } = frame.value;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = props.size;
    const context = canvas.getContext("2d")!;
    context.imageSmoothingQuality = "high";
    context.drawImage(img, (x - left) / scale, (y - top) / scale, side / scale, side / scale, 0, 0, props.size, props.size);
    emit("save", canvas.toDataURL("image/png").slice("data:image/png;base64,".length));
  } finally {
    saving.value = false;
  }
}

function onOpenChange(value: boolean) {
  if (!value) emit("cancel");
}
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[360px]" data-testid="crop-dialog">
      <DialogHeader :icon="Crop" :title="title" :description="round ? t('crop.help.round') : t('crop.help.square')" />

      <div
        class="bg-muted focus-visible:ring-ring relative mx-auto touch-none overflow-hidden rounded-lg select-none focus-visible:ring-2 focus-visible:outline-none"
        :style="{ width: `${VIEW}px`, height: `${VIEW}px` }"
        tabindex="0"
        role="img"
        :aria-label="t('crop.area')"
        data-crop-area
        data-testid="crop-area"
        @wheel.prevent="onWheel"
        @keydown="onKey"
      >
        <img
          v-if="image"
          :src="src!"
          alt=""
          draggable="false"
          class="pointer-events-none absolute max-w-none"
          :style="{ left: `${fit.left}px`, top: `${fit.top}px`, width: `${fit.width}px`, height: `${fit.height}px` }"
        />
        <!-- The kept part; everything around it is dimmed. -->
        <div
          v-if="image"
          class="absolute cursor-move border border-white/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]"
          :class="round ? 'rounded-full' : 'rounded-md'"
          :style="{ left: `${frame.x}px`, top: `${frame.y}px`, width: `${frame.side}px`, height: `${frame.side}px` }"
          data-testid="crop-frame"
          @pointerdown="onMoveStart"
        >
          <!-- Resize handle on the lower right, on the circle's edge when round. -->
          <span
            class="bg-primary border-background absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize rounded-full border-2"
            :style="round ? { left: '85.36%', top: '85.36%' } : { left: '100%', top: '100%' }"
            data-testid="crop-handle"
            @pointerdown="onResizeStart"
          />
        </div>
      </div>

      <div class="flex items-center gap-3">
        <Button size="icon-sm" variant="ghost" :aria-label="t('crop.smaller')" :title="t('crop.smaller')" :disabled="share <= MIN_SHARE + 0.001" @click="resize(frame.side / 1.25)">
          <Minus />
        </Button>
        <Slider
          class="min-w-0 flex-1"
          :min="MIN_SHARE"
          :max="1"
          :step="0.005"
          :aria-label="t('crop.size')"
          data-testid="crop-size"
          :model-value="[share]"
          @update:model-value="$event?.[0] !== undefined && resize($event[0] * maxSide)"
        />
        <Button size="icon-sm" variant="ghost" :aria-label="t('crop.larger')" :title="t('crop.larger')" :disabled="share >= 0.999" @click="resize(frame.side * 1.25)">
          <Plus />
        </Button>
      </div>

      <DialogFooter>
        <DialogButton close data-testid="crop-cancel" @click="emit('cancel')">{{ t("common.cancel") }}</DialogButton>
        <DialogButton :icon="Save" :loading="saving" data-testid="crop-save" :disabled="!image || saving" @click="save">{{ t("common.save") }}</DialogButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
