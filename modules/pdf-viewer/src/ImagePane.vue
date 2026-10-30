<script setup lang="ts">
// One open picture in the kit's zoom pane: fits at first, wheel (with Ctrl) zooms, drag pans, and a double-click
// switches between fitting it and 100 %. The zoom is remembered per file.
import { ZoomPane } from "@tavora/official-ui/components/ui/zoom-pane";
import { Notice } from "@tavora/official-ui/components/ui/notice";
import { nextTick, ref, watch } from "vue";
import type { FileView } from "./files";
import { t } from "./i18n";

const props = defineProps<{ url: string; name: string; view: FileView }>();
const emit = defineEmits<{ view: [view: Partial<FileView>] }>();

const box = ref<HTMLElement | null>(null);
const pane = ref<InstanceType<typeof ZoomPane> | null>(null);
const failed = ref(false);
const natural = ref({ width: 0, height: 0 });
/** The zoom that shows the whole picture, once known. */
let fitZoom = 1;
let ready = false;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const centred = (zoom: number) => ({
  zoom,
  x: ((box.value?.clientWidth ?? 0) - natural.value.width * zoom) / 2,
  y: ((box.value?.clientHeight ?? 0) - natural.value.height * zoom) / 2,
});

async function loaded(event: Event) {
  const image = event.target as HTMLImageElement;
  natural.value = { width: image.naturalWidth, height: image.naturalHeight };
  // The pane measures itself after the picture is in; wait for that, then find the fitting zoom and put back the saved one.
  await frame();
  await frame();
  const zoomPane = pane.value;
  if (!zoomPane) return;
  zoomPane.fit();
  await nextTick();
  fitZoom = zoomPane.zoom;
  if (props.view.fit === null) zoomPane.setView(centred(props.view.zoom));
  await nextTick();
  ready = true;
}

watch(
  () => pane.value?.zoom,
  (zoom) => {
    if (!ready || zoom === undefined) return;
    emit("view", { zoom, fit: Math.abs(zoom - fitZoom) < 0.002 ? "page" : null });
  },
);

function toggle() {
  const zoomPane = pane.value;
  if (!zoomPane || natural.value.width === 0) return;
  if (Math.abs(zoomPane.zoom - 1) < 0.002) zoomPane.fit();
  else zoomPane.setView(centred(1));
}
</script>

<template>
  <Notice v-if="failed" variant="error" class="m-3" data-testid="image-error">{{ t("image.failed") }}</Notice>
  <div v-else ref="box" class="h-full min-h-0 p-2" @dblclick="toggle">
    <ZoomPane ref="pane" class="h-full" :label="name" :min-zoom="0.05" :max-zoom="8" :fit-floor="0.05" data-testid="image-pane">
      <img :src="url" :alt="name" class="block max-w-none select-none" draggable="false" data-testid="image-view" @load="loaded" @error="failed = true" />
    </ZoomPane>
  </div>
</template>
