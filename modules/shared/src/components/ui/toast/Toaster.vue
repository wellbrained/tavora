<script setup lang="ts">
// Mount once per panel. Shows the toasts from useToast() as a stack of pills where the user wants
// them (Settings > Appearance): the newest in front, older ones peeking out behind. Pointing at
// or focusing the stack spreads it out and stops every timer. Two hidden live regions read each
// new toast out, errors as alerts.
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, watchEffect } from "vue";
import "./toast.css";
import ToastItem from "./ToastItem.vue";
import { GAP, PEEK, SHRINK, stackExtent, toastPosition, toasts, type ToastPosition } from "./toast";
import { toastsPaused, trackDocumentVisibility } from "./visibility";

/**
 * `position`: a fixed place, for a page that must not follow the setting. `paused`: every timer stops, for a page that
 * is out of sight (Tavora hidden). The Toaster says its `extent` (see stackExtent) when a page of its own, the host's
 * toast view, has to be as big as the stack.
 */
defineOptions({ inheritAttrs: false });
const props = defineProps<{ position?: ToastPosition; paused?: boolean }>();
const emit = defineEmits<{ extent: [value: { width: number; height: number }] }>();

const position = computed(() => props.position ?? toastPosition.value);
const fromTop = computed(() => position.value === "top-center");

// Tab follows what is drawn: a stack at the bottom of the screen comes last in the page, one at the top comes first, wherever
// the module mounted the Toaster. So it lives in a holder of its own at the end (or start) of the body, and takes Tab there.
// `display: contents` keeps the holder out of the layout. A dialog or menu that shuts the page behind it leaves this holder alone.
const holder = document.createElement("div");
holder.dataset.slot = "toaster-host";
holder.style.display = "contents";
watchEffect(() => (fromTop.value ? document.body.prepend(holder) : document.body.append(holder)));
onBeforeUnmount(() => holder.remove());

// Timers stand still while the page is hidden or its panel is suspended, so a toast is never gone before it was seen.
let stopVisibility: (() => void) | undefined;
onMounted(() => (stopVisibility = trackDocumentVisibility()));
onBeforeUnmount(() => stopVisibility?.());

const sizes = reactive(new Map<number, { width: number; height: number }>());
/**
 * Where a new front toast starts: the size of the one in front until now. It grows or shrinks to its own size from there with
 * the pill's width/height transition (a morph), instead of showing up at its own size and snapping the ones behind to it.
 * Kept per toast until it leaves; a toast on an empty stack, or one that came before the one in front was measured, has none.
 */
const startSizes = new Map<number, { width: number; height: number }>();
watch(
  toasts,
  (list, before) => {
    const known = new Set((before ?? []).map((item) => item.id));
    const inFront = before?.at(-1);
    const from = inFront && sizes.get(inFront.id);
    if (!from) return;
    for (const item of list) if (!known.has(item.id)) startSizes.set(item.id, { ...from });
  },
  // Before the new toast is drawn, so its first frame is already at the old size.
  { flush: "pre" },
);
const expanded = ref(false);

// The room the stack needs spread out, so a view of its own is already big enough when the pointer opens it.
watch(
  () => stackExtent(toasts.value.map((item) => sizes.get(item.id))),
  (value) => emit("extent", value),
  { immediate: true, flush: "post" },
);
let collapseTimer: ReturnType<typeof setTimeout> | undefined;

function open() {
  clearTimeout(collapseTimer);
  expanded.value = true;
}
/** A moment's wait, so moving across the gap between two toasts keeps the stack open. */
function close() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => (expanded.value = false), 120);
}

/** Each toast with where it sits in the stack, counted from the newest. The page keeps them oldest first. */
const placed = computed(() => {
  const sign = fromTop.value ? 1 : -1;
  let offset = 0;
  // The newest one's size; while it is still measuring itself, the size it starts from, so the ones behind move with it.
  const newest = toasts.value.at(-1);
  const front = newest ? (sizes.get(newest.id) ?? startSizes.get(newest.id)) : undefined;
  const newestFirst = [...toasts.value].reverse().map((item, depth) => {
    const transform = expanded.value ? `translateY(${sign * offset}px)` : `translateY(${sign * depth * PEEK}px) scale(${1 - depth * SHRINK})`;
    offset += (sizes.get(item.id)?.height ?? 44) + GAP;
    // Collapsed, the ones behind take the front one's size and hide what they say, so the stack reads as layers.
    const behind = !expanded.value && depth > 0 ? front : undefined;
    return { item, depth, behind, style: { transform, zIndex: 10 - depth, opacity: expanded.value || depth === 0 ? 1 : 1 - depth * 0.3 } };
  });
  return newestFirst.reverse();
});

/** The DOM order is the reading order: oldest first from the bottom edge up, so at the top edge (newest first there) it is reversed. */
const ordered = computed(() => (fromTop.value ? [...placed.value].reverse() : placed.value));

// What the two live regions say. Each toast is read once when it arrives and once more only when its content changes
// (loading turning into done). When a toast leaves, the one behind it is not read again, and the same words twice in a
// row (two to-dos deleted) are still read twice: the region gets a hidden space added or taken away.
const said = reactive({ normal: "", error: "" });
const heard = { normal: { id: 0, revision: -1 }, error: { id: 0, revision: -1 } };
const words = (item: { title: string; description?: string }) => [item.title, item.description].filter(Boolean).join(". ");
watch(
  toasts,
  (list) => {
    for (const kind of ["normal", "error"] as const) {
      const item = list.findLast((candidate) => (candidate.variant === "error") === (kind === "error"));
      const last = heard[kind];
      if (!item || item.id < last.id || (item.id === last.id && item.revision <= last.revision)) continue;
      heard[kind] = { id: item.id, revision: item.revision };
      const text = words(item);
      said[kind] = said[kind] === text ? `${text} ` : text;
    }
  },
  { immediate: true },
);

function forget(id: number) {
  sizes.delete(id);
  startSizes.delete(id);
  if (!toasts.value.length) expanded.value = false;
}
</script>

<template>
  <Teleport :to="holder">
  <div data-slot="toaster" :data-position="position" class="tavora-toaster" v-bind="$attrs">
    <TransitionGroup name="tavora-toast" @before-leave="(el: Element) => el.setAttribute('inert', '')" @after-leave="(el: Element) => forget(Number((el as HTMLElement).dataset.id))">
      <!-- The slot comes and goes; the layer inside it moves within the stack. Kept apart so the
           list transition never touches the layer's transform. -->
      <div v-for="{ item, depth, behind, style } in ordered" :key="item.id" :data-id="item.id" class="tavora-toast-slot" :style="{ zIndex: style.zIndex }" :inert="!expanded && depth > 0">
        <div class="tavora-toast-layer" :style="{ transform: style.transform, opacity: style.opacity }" @pointerenter="open" @pointerleave="close" @focusin="open" @focusout="close">
          <ToastItem :item="item" :paused="expanded || toastsPaused || !!paused" :behind="behind" :from="startSizes.get(item.id)" @size="(value) => sizes.set(item.id, value)" />
        </div>
      </div>
    </TransitionGroup>
    <div class="sr-only" role="status" aria-live="polite" data-testid="toast-status">{{ said.normal }}</div>
    <div class="sr-only" role="alert">{{ said.error }}</div>
  </div>
  </Teleport>
</template>
