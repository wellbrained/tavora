<script setup lang="ts">
// Mount once per panel. Shows the toasts from useToast() as a stack of pills where the user wants
// them (Settings > Appearance): the newest in front, older ones peeking out behind. Pointing at
// or focusing the stack spreads it out and stops every timer. Two hidden live regions read each
// new toast out, errors as alerts.
import { computed, reactive, ref } from "vue";
import "./toast.css";
import ToastItem from "./ToastItem.vue";
import { toastPosition, toasts, type ToastPosition } from "./toast";

/** A fixed place, for a page that must not follow the setting (the host window). */
const props = defineProps<{ position?: ToastPosition }>();

const position = computed(() => props.position ?? toastPosition.value);
const fromTop = computed(() => position.value === "top-center");

const GAP = 8;
/** How far each older toast peeks out, and how much smaller it gets. */
const PEEK = 10;
const SHRINK = 0.06;

const sizes = reactive(new Map<number, { width: number; height: number }>());
const expanded = ref(false);
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
  const front = toasts.value.length ? sizes.get(toasts.value.at(-1)!.id) : undefined;
  const newestFirst = [...toasts.value].reverse().map((item, depth) => {
    const transform = expanded.value ? `translateY(${sign * offset}px)` : `translateY(${sign * depth * PEEK}px) scale(${1 - depth * SHRINK})`;
    offset += (sizes.get(item.id)?.height ?? 44) + GAP;
    // Collapsed, the ones behind take the front one's size and hide what they say, so the stack reads as layers.
    const behind = !expanded.value && depth > 0 ? front : undefined;
    return { item, depth, behind, style: { transform, zIndex: 10 - depth, opacity: expanded.value || depth === 0 ? 1 : 1 - depth * 0.3 } };
  });
  return newestFirst.reverse();
});

const newestNormal = computed(() => toasts.value.findLast((item) => item.variant !== "error"));
const newestError = computed(() => toasts.value.findLast((item) => item.variant === "error"));
const spoken = (item: { title: string; description?: string } | undefined) => (item ? [item.title, item.description].filter(Boolean).join(". ") : "");

function forget(id: number) {
  sizes.delete(id);
  if (!toasts.value.length) expanded.value = false;
}
</script>

<template>
  <div data-slot="toaster" :data-position="position" class="tavora-toaster">
    <TransitionGroup name="tavora-toast" @after-leave="(el: Element) => forget(Number((el as HTMLElement).dataset.id))">
      <!-- The slot comes and goes; the layer inside it moves within the stack. Kept apart so the
           list transition never touches the layer's transform. -->
      <div v-for="{ item, depth, behind, style } in placed" :key="item.id" :data-id="item.id" class="tavora-toast-slot" :style="{ zIndex: style.zIndex }" :inert="!expanded && depth > 0">
        <div class="tavora-toast-layer" :style="{ transform: style.transform, opacity: style.opacity }" @pointerenter="open" @pointerleave="close" @focusin="open" @focusout="close">
          <ToastItem :item="item" :paused="expanded" :behind="behind" @size="(value) => sizes.set(item.id, value)" />
        </div>
      </div>
    </TransitionGroup>
    <div class="sr-only" role="status" aria-live="polite">{{ spoken(newestNormal) }}</div>
    <div class="sr-only" role="alert">{{ spoken(newestError) }}</div>
  </div>
</template>
