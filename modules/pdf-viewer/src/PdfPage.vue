<script setup lang="ts">
// One page of a PDF. It draws itself (picture and selectable text) only while it is near the visible part, and
// gives the memory back when it is far away. The size it takes up is always known, so the column never jumps.
import { onBeforeUnmount, ref, watch } from "vue";
import type { PDFDocumentProxy } from "./pdf";
import { pdfjs } from "./pdf";
import { buildPageText, segmentsFor, type PageText, type Range } from "./search";

/** The most pixels one page's picture may have, so a big page at a big zoom does not run the memory out. */
const MAX_PIXELS = 16_000_000;

const props = defineProps<{
  pdf: PDFDocumentProxy;
  number: number;
  /** The page's size at zoom 1. */
  width: number;
  height: number;
  zoom: number;
  /** Near the visible part, so worth drawing. */
  near: boolean;
  /** Matches on this page (ranges in its text) and the one the reader is on. */
  ranges: Range[];
  current: Range | null;
}>();

const host = ref<HTMLDivElement | null>(null);
const failed = ref(false);

let token = 0;
let canvas: HTMLCanvasElement | null = null;
let layer: HTMLDivElement | null = null;
let renderTask: { cancel: () => void } | null = null;
let textLayer: { cancel: () => void } | null = null;
let text: PageText | null = null;
let divs: HTMLElement[] = [];
let strings: string[] = [];

function stop() {
  renderTask?.cancel();
  textLayer?.cancel();
  renderTask = null;
  textLayer = null;
}

function clear() {
  token++;
  stop();
  host.value?.replaceChildren();
  canvas = null;
  layer = null;
  text = null;
  divs = [];
  strings = [];
}

async function draw() {
  const mine = ++token;
  stop();
  failed.value = false;
  try {
    const page = await props.pdf.getPage(props.number);
    if (mine !== token || !host.value) return;
    const viewport = page.getViewport({ scale: props.zoom });
    const ratio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (viewport.width * viewport.height))));
    const next = document.createElement("canvas");
    next.width = Math.floor(viewport.width * ratio);
    next.height = Math.floor(viewport.height * ratio);
    next.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
    const task = page.render({ canvas: next, viewport, ...(ratio !== 1 ? { transform: [ratio, 0, 0, ratio, 0, 0] } : {}) });
    renderTask = task;
    const content = await page.getTextContent();
    await task.promise;
    if (mine !== token || !host.value) return;

    const nextLayer = document.createElement("div");
    nextLayer.className = "textLayer";
    nextLayer.style.setProperty("--total-scale-factor", String(props.zoom));
    // The old picture stays until the new one is ready, so zooming does not flash.
    host.value.replaceChildren(next, nextLayer);
    canvas = next;
    layer = nextLayer;
    const textual = content.items.filter((item): item is Extract<typeof item, { str: string }> => "str" in item);
    text = buildPageText(textual);
    strings = textual.map((item) => item.str);
    const rendered = new pdfjs.TextLayer({ textContentSource: content, container: nextLayer, viewport });
    textLayer = rendered;
    await rendered.render();
    if (mine !== token) return;
    divs = rendered.textDivs;
    highlight();
  } catch (error) {
    if ((error as { name?: string })?.name === "RenderingCancelledException" || mine !== token) return;
    failed.value = true;
  }
}

/** Marks the matches in the text layer; text without a match is put back as it was. */
function highlight() {
  if (!layer || !text) return;
  const starts = text.starts;
  divs.forEach((div, index) => {
    const str = strings[index];
    const start = starts[index];
    if (str === undefined || start === undefined) return;
    const segments = segmentsFor(str, start, props.ranges, props.current);
    const marked = segments.some((segment) => segment.mark);
    if (!marked && div.dataset.marked === undefined) return;
    if (!marked) {
      div.textContent = str;
      delete div.dataset.marked;
      return;
    }
    div.dataset.marked = "";
    div.replaceChildren(
      ...segments.map((segment) => {
        if (!segment.mark) return document.createTextNode(segment.text);
        const mark = document.createElement("mark");
        mark.textContent = segment.text;
        if (segment.mark === "current") mark.dataset.current = "";
        return mark;
      }),
    );
  });
}

watch(
  () => [props.near, props.zoom, props.pdf] as const,
  ([near]) => (near ? void draw() : clear()),
  { immediate: true, flush: "post" },
);
watch(() => [props.ranges, props.current] as const, highlight);


defineExpose({ markTop: () => layer?.querySelector<HTMLElement>("mark[data-current]")?.getBoundingClientRect().top ?? null });

onBeforeUnmount(clear);
</script>

<template>
  <div
    class="ring-border relative isolate mx-auto bg-white ring-1"
    :style="{ width: `${width * zoom}px`, height: `${height * zoom}px` }"
    :data-page="number"
    data-testid="pdf-page"
  >
    <!-- bg-white above: the paper of a document page, the same in every theme. -->
    <div ref="host" class="absolute inset-0 overflow-hidden" />
    <p v-if="failed" class="bg-muted text-muted-foreground absolute inset-0 grid place-items-center text-sm tabular-nums">{{ number }}</p>
  </div>
</template>
