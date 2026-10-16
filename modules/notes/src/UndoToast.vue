<script setup lang="ts">
// A short notice with Undo. It goes away on its own after 10 seconds, which
// stop counting while the pointer or keyboard focus is on it.
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "./i18n";

/** How long the notice stays when left alone. */
const DURATION_MS = 10_000;

defineProps<{ message: string; /** A plain notice: no Undo button. */ plain?: boolean }>();
const emit = defineEmits<{ undo: []; dismiss: [] }>();

let remaining = DURATION_MS;
let startedAt = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const paused = ref(false);

function start() {
  startedAt = Date.now();
  timer = setTimeout(() => emit("dismiss"), remaining);
}

function pause() {
  if (paused.value) return;
  paused.value = true;
  clearTimeout(timer);
  remaining = Math.max(1_000, remaining - (Date.now() - startedAt));
}

function resume() {
  if (!paused.value) return;
  paused.value = false;
  start();
}

onMounted(start);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div
    class="bg-popover text-popover-foreground absolute bottom-3 left-1/2 z-50 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-md border py-1.5 pr-1.5 pl-3 text-sm shadow-lg"
    role="status"
    aria-live="polite"
    data-testid="undo-toast"
    @pointerenter="pause"
    @pointerleave="resume"
    @focusin="pause"
    @focusout="resume"
  >
    <span class="min-w-0 truncate">{{ message }}</span>
    <Button v-if="!plain" size="sm" variant="secondary" class="flex-none" data-testid="undo" @click="emit('undo')">{{ t("undo.undo") }}</Button>
    <Button size="icon-sm" variant="ghost" class="flex-none" :aria-label="t('undo.dismiss')" :title="t('undo.dismiss')" @click="emit('dismiss')">
      <X :stroke-width="1.5" />
    </Button>
  </div>
</template>
