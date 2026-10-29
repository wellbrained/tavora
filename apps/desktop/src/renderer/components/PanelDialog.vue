<script setup lang="ts">
// A panel shown big in a dialog centred on the app (panel.setDialog): the frame with the module's name and a close
// button is drawn here; its body stays empty and its place is sent to the host, which moves the panel's own page into
// it. The close button and a click beside it put the panel back (Esc too while the frame, not the page, has the keys).
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { X } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@tavora/official-ui/components/ui/dialog";
import { api, panelDialog } from "../host";
import { t } from "../i18n";

/** The frame's open animation; the page is placed again once it has settled. */
const SETTLE_MS = 250;

const body = ref<HTMLElement | null>(null);
let observer: ResizeObserver | undefined;
let settle: ReturnType<typeof setTimeout> | undefined;

function place(): void {
  const rect = body.value?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) api.placePanelDialog({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function stop(): void {
  observer?.disconnect();
  observer = undefined;
  clearTimeout(settle);
  removeEventListener("resize", place);
}

watch(
  panelDialog,
  async (dialog) => {
    stop();
    if (!dialog) return;
    await nextTick();
    if (!body.value) return;
    observer = new ResizeObserver(place);
    observer.observe(body.value);
    addEventListener("resize", place);
    settle = setTimeout(place, SETTLE_MS);
  },
  { flush: "post" },
);

onBeforeUnmount(stop);

function close(): void {
  panelDialog.value = null;
  api.closePanelDialog();
}
</script>

<template>
  <Dialog :open="panelDialog !== null" @update:open="(open: boolean) => !open && close()">
    <DialogContent
      v-if="panelDialog"
      class="bg-card top-[calc(50%+env(titlebar-area-height,0px)/2)] flex max-h-[calc(100vh-env(titlebar-area-height,0px)-48px)] max-w-[calc(100vw-48px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-48px)]"
      :style="{ width: `${panelDialog.width}px`, height: `${panelDialog.height + 49}px` }"
      data-testid="panel-dialog"
      :show-close-button="false"
      :aria-describedby="undefined"
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
