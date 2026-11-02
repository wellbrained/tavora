<script setup lang="ts">
// A tooltip for a thing that has no element to hover (a node on a canvas): you pass the box it is drawn in, in the pane's
// own pixels, and the kit tooltip opens beside it (never at the pointer, never on the box). `useZoomTip` waits like a
// title hint does; the tip closes when the pane pans or zooms, so it never hangs where the thing no longer is.
import { type Size, useZoomTip, ZoomPane, ZoomTip, type ZoomView } from "@tavora/official-ui/components/ui/zoom-pane";
import { onBeforeUnmount, ref, watch } from "vue";

defineProps<{ disabled?: boolean }>();

const NAMES = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame", "Copper Ore", "Copper Ingot"];
const NODE = { width: 120, height: 60 };
const nodes = Array.from({ length: 32 }, (_, id) => ({ id, name: NAMES[id % NAMES.length]!, x: 40 + (id % 8) * 200, y: 40 + Math.floor(id / 8) * 120 }));
const WORLD: Size = { width: 1680, height: 520 };

const canvas = ref<HTMLCanvasElement | null>(null);
const view = ref<ZoomView>({ x: 0, y: 0, zoom: 1 });
const size = ref<Size>({ width: 0, height: 0 });
const hovered = ref<number | null>(null);
const { tip, show, hide } = useZoomTip();
onBeforeUnmount(hide);

function onViewChange(next: ZoomView, paneSize: Size) {
  view.value = next;
  size.value = paneSize;
  hovered.value = null;
}

function draw() {
  const element = canvas.value;
  if (!element || !size.value.width) return;
  const ratio = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  element.width = Math.round(size.value.width * ratio);
  element.height = Math.round(size.value.height * ratio);
  const context = element.getContext("2d")!;
  const style = getComputedStyle(element);
  const { x, y, zoom } = view.value;
  context.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * x, ratio * y);
  context.font = "14px sans-serif";
  context.textBaseline = "middle";
  for (const node of nodes) {
    const lit = node.id === hovered.value;
    context.fillStyle = style.getPropertyValue("--card").trim();
    context.strokeStyle = style.getPropertyValue(lit ? "--primary" : "--border").trim();
    context.lineWidth = (lit ? 2 : 1) / zoom;
    context.beginPath();
    context.roundRect(node.x, node.y, NODE.width, NODE.height, 8);
    context.fill();
    context.stroke();
    context.fillStyle = style.getPropertyValue("--foreground").trim();
    context.fillText(node.name, node.x + 10, node.y + NODE.height / 2, NODE.width - 20);
  }
}
watch([view, size, hovered], draw, { flush: "post" });

/** The pointer is in the pane's pixels, the nodes in world pixels. */
function nodeAt(event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const wx = (event.clientX - box.left - view.value.x) / view.value.zoom;
  const wy = (event.clientY - box.top - view.value.y) / view.value.zoom;
  return nodes.find((node) => wx >= node.x && wx <= node.x + NODE.width && wy >= node.y && wy <= node.y + NODE.height);
}
function onMove(event: PointerEvent) {
  if (event.buttons) return;
  const node = nodeAt(event);
  if (!node) return onLeave();
  if (hovered.value === node.id) return;
  hovered.value = node.id;
  // The box where the node is drawn now, in the pane's pixels.
  const { x, y, zoom } = view.value;
  show({ left: x + node.x * zoom, top: y + node.y * zoom, width: NODE.width * zoom, height: NODE.height * zoom }, { title: node.name, description: "60 / min" });
}
function onLeave() {
  hovered.value = null;
  hide();
}
</script>

<template>
  <ZoomPane class="h-64" view-only :world="WORLD" :min-zoom="0.1" :max-zoom="4" wheel="zoom" label="Canvas line with tooltips" @view-change="onViewChange">
    <canvas ref="canvas" class="size-full" @pointermove="onMove" @pointerleave="onLeave" />
    <ZoomTip v-bind="tip" side="top" @dismiss="hide" />
  </ZoomPane>
</template>
