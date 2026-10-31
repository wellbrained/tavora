<script setup lang="ts">
// A panel shown big in a dialog centred over the workspace area (panel.setDialog): the frame with the module's name and a
// close button is drawn here; its body stays empty and its place is sent to the host, which moves the panel's own page
// into it. The rail and header stay in sight, dimmed and not clickable. The close button puts the panel back, and so
// does a click beside the frame for a dialog opened by a click (not for a welcome a panel just added opened on its own);
// Esc too while the frame, not the page, has the keys.
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { api, panelDialog } from "../host";
import { t } from "../i18n";
import { dialogPlace, type Room } from "../panel-dialog-place";

const body = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;
let roomObserver: ResizeObserver | undefined;

/** The workspace area the frame centres over, while a dialog is open. */
const room = shallowRef<Room | null>(null);
const place = computed(() => dialogPlace(room.value));

function measureRoom(): void {
  const area = document.querySelector<HTMLElement>("[data-workspace-area]");
  const rect = area?.getBoundingClientRect();
  room.value = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
}

function placePage(): void {
  const rect = body.value?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) api.placePanelDialog({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function onResize(): void {
  measureRoom();
  placePage();
}

function stop(): void {
  observer?.disconnect();
  observer = undefined;
  roomObserver?.disconnect();
  roomObserver = undefined;
  removeEventListener("resize", onResize);
}

watch(
  panelDialog,
  async (dialog) => {
    stop();
    if (!dialog) return;
    measureRoom();
    const area = document.querySelector<HTMLElement>("[data-workspace-area]");
    if (area) {
      // The rail opening or closing moves the workspace area without resizing the window.
      roomObserver = new ResizeObserver(measureRoom);
      roomObserver.observe(area);
    }
    addEventListener("resize", onResize);
    await nextTick();
    // The frame zooms in; placed during that, the page would show shrunk and then jump to its full size. It goes in
    // once the frame has settled and follows it from then on.
    const frame = body.value?.parentElement;
    await Promise.allSettled(frame?.getAnimations().map((animation) => animation.finished) ?? []);
    if (!body.value || panelDialog.value !== dialog) return;
    observer = new ResizeObserver(placePage);
    observer.observe(body.value);
    placePage();
  },
  { flush: "post" },
);

// The frame moved with the workspace area (same size, so the body's observer would not see it).
watch(place, () => {
  if (observer) void nextTick(placePage);
});

onBeforeUnmount(stop);

function close(): void {
  panelDialog.value = null;
  api.closePanelDialog();
}

/** A click beside the frame closes only a dialog that a click opened. */
function onPointerDownOutside(event: Event): void {
  if (panelDialog.value && !panelDialog.value.closesOnClickBeside) event.preventDefault();
}
</script>

<template>
  <Dialog :open="panelDialog !== null" @update:open="(open: boolean) => !open && close()">
    <DialogContent
      v-if="panelDialog"
      class="bg-card top-[calc(50%+env(titlebar-area-height,0px)/2)] flex max-h-[calc(100vh-env(titlebar-area-height,0px)-48px)] max-w-[calc(100vw-48px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-48px)]"
      :style="{ width: `${panelDialog.width}px`, height: `${panelDialog.height + 49}px`, ...(place ?? {}) }"
      data-testid="panel-dialog"
      :data-closes-on-click-beside="panelDialog.closesOnClickBeside ? '' : undefined"
      :show-close-button="false"
      :aria-describedby="undefined"
      @pointer-down-outside="onPointerDownOutside"
    >
      <header class="flex h-12 flex-none items-center gap-2.5 border-b pr-2 pl-4">
        <img v-if="panelDialog.icon" :src="panelDialog.icon" alt="" class="size-5 flex-none rounded" />
        <DialogTitle class="min-w-0 flex-1 truncate text-sm font-semibold">{{ panelDialog.title }}</DialogTitle>
        <Button variant="ghost" size="icon-sm" :aria-label="t('common.close')" data-testid="panel-dialog-close" @click="close"><X class="size-4" /></Button>
      </header>
      <div ref="body" class="min-h-0 flex-1" data-testid="panel-dialog-body" />
    </DialogContent>
  </Dialog>
</template>
