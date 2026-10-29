<script setup lang="ts">
// One toast: a pill with an icon for its kind, the title, an optional line and button, and a close
// button. It grows and shrinks smoothly when its content changes (loading turning into done), and
// its timer stops while the Toaster has the stack spread out. Shape, icons and timings follow
// notch-toast (MIT, github.com/Devsethi3/notch-toast), drawn in Tavora's colours.
import { X } from "@lucide/vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Button } from "../button";
import { uiText } from "../text";
import { dismissToast, toastDuration, type ToastItem } from "./toast";

const props = defineProps<{
  item: ToastItem;
  paused: boolean;
  /** Behind the front toast in a closed stack: take its size and keep quiet. */
  behind?: { width: number; height: number };
}>();
const emit = defineEmits<{ size: [value: { width: number; height: number }] }>();

const kind = computed(() => props.item.variant ?? "default");

let remaining = 0;
let startedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function stop() {
  clearTimeout(timer);
  timer = undefined;
}
function start() {
  if (timer !== undefined || props.paused || !Number.isFinite(remaining) || remaining <= 0) return;
  startedAt = Date.now();
  timer = setTimeout(() => dismissToast(props.item.id), remaining);
}
function pause() {
  if (timer === undefined) return;
  stop();
  remaining = Math.max(remaining - (Date.now() - startedAt), 1000);
}
/** A new toast, or new content in this one: the full time again. */
function restart() {
  stop();
  remaining = toastDuration(props.item);
  start();
}

watch(() => props.item.revision, restart);
watch(
  () => props.paused,
  (paused) => (paused ? pause() : start()),
);
onMounted(restart);

// The pill takes the size of what is in it, as numbers, so a change of content can animate.
const content = ref<HTMLElement>();
const size = ref<{ width: number; height: number }>();
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    const box = entry!.borderBoxSize[0]!;
    size.value = { width: box.inlineSize, height: box.blockSize };
    emit("size", size.value);
  });
  observer.observe(content.value!);
});
onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
});

function runAction() {
  props.item.action?.onClick();
  dismissToast(props.item.id);
}
</script>

<template>
  <div
    data-slot="toast"
    :data-variant="kind"
    :data-testid="item.testid"
    class="tavora-toast"
    :data-behind="behind ? '' : undefined"
    :style="(behind ?? size) && { width: `${(behind ?? size)!.width}px`, height: `${(behind ?? size)!.height}px` }"
    @keydown.esc.stop="dismissToast(item.id)"
  >
    <div ref="content" class="tavora-toast-content">
      <Transition name="tavora-toast-icon" mode="out-in">
        <span v-if="kind !== 'default'" :key="kind" class="tavora-toast-icon" :data-icon="kind" aria-hidden="true">
          <span v-if="kind === 'loading'" class="tavora-toast-spinner" />
          <svg v-else-if="kind === 'success'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.15">
            <path d="m3.45 8.15 2.75 2.7 6.35-6.2" stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
          </svg>
          <svg v-else-if="kind === 'error'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.25">
            <path d="M3.7 3.7 12.3 12.3" stroke-linecap="round" pathLength="1" />
            <path d="M12.3 3.7 3.7 12.3" stroke-linecap="round" pathLength="1" />
          </svg>
          <svg v-else-if="kind === 'warning'" viewBox="0 0 24 24" fill="none">
            <path fill="currentColor" d="M10.06 2.15a2.24 2.24 0 0 1 3.88 0l8.7 15.07a2.24 2.24 0 0 1-1.94 3.36H3.3a2.24 2.24 0 0 1-1.94-3.36l8.7-15.07Z" />
            <path d="M12 8.2v4.65" class="tavora-toast-glyph" stroke-width="2.35" stroke-linecap="round" />
            <circle cx="12" cy="16.55" r="1.35" class="tavora-toast-dot" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="11.25" fill="currentColor" />
            <path d="M12 7.55v5" class="tavora-toast-glyph" stroke-width="2.45" stroke-linecap="round" />
            <circle cx="12" cy="16.65" r="1.35" class="tavora-toast-dot" />
          </svg>
        </span>
      </Transition>
      <div class="tavora-toast-text">
        <Transition name="tavora-toast-line">
          <p :key="item.title" class="tavora-toast-title">{{ item.title }}</p>
        </Transition>
        <p v-if="item.description" class="tavora-toast-description">{{ item.description }}</p>
      </div>
      <Transition name="tavora-toast-action">
        <Button v-if="item.action" type="button" size="xs" variant="ghost" class="tavora-toast-button" :data-testid="item.actionTestid" @click="runAction">
          {{ item.action.label }}
        </Button>
      </Transition>
      <Button type="button" size="icon-xs" variant="ghost" class="tavora-toast-button tavora-toast-close" :aria-label="uiText.dismiss" aria-keyshortcuts="Escape" @click="dismissToast(item.id)">
        <X :stroke-width="1.75" />
      </Button>
    </div>
  </div>
</template>
