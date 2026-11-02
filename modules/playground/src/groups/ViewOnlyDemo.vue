<script setup lang="ts">
// View-only mode: a canvas that draws itself. ZoomPane takes every input and keeps the view, but moves nothing; the
// canvas draws with the view it is told. With `tips` the nodes have a tooltip beside their box (useZoomTip + ZoomTip),
// though a canvas node has no element to hover.
import { Focus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { type Size, useZoomTip, ZoomPane, ZoomTip, type ZoomView } from "@tavora/official-ui/components/ui/zoom-pane";
import { onBeforeUnmount, ref, watch } from "vue";

const props = defineProps<{ off: boolean; tips?: boolean; persistKey?: string }>();

const NAMES = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame", "Copper Ore", "Copper Ingot"];
const NODE = { width: 120, height: 60 };
/** Eight nodes by four rows, in world pixels (the units the view's x, y and zoom use). */
const nodes = Array.from({ length: 32 }, (_, index) => ({ id: index, name: NAMES[index % NAMES.length]!, x: 40 + (index % 8) * 200, y: 40 + Math.floor(index / 8) * 120 }));
const WORLD: Size = { width: 1680, height: 520 };

const canvas = ref<HTMLCanvasElement | null>(null);
const pane = ref<InstanceType<typeof ZoomPane> | null>(null);
const view = ref<ZoomView>({ x: 0, y: 0, zoom: 1 });
const size = ref<Size>({ width: 0, height: 0 });
const hovered = ref<number | null>(null);
const { tip, show, hide } = useZoomTip();

function onViewChange(next: ZoomView, paneSize: Size) {
  view.value = next;
  size.value = paneSize;
  // The tip belongs to where a node was: the view moved, so it goes.
  hide();
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
  const read = (name: string) => style.getPropertyValue(name).trim();
  const { x, y, zoom } = view.value;
  context.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * x, ratio * y);
  context.font = "14px sans-serif";
  context.textBaseline = "middle";
  for (const node of nodes) {
    const lit = node.id === hovered.value;
    context.fillStyle = read("--card");
    context.strokeStyle = lit ? read("--primary") : read("--border");
    context.lineWidth = (lit ? 2 : 1) / zoom;
    context.beginPath();
    context.roundRect(node.x, node.y, NODE.width, NODE.height, 8);
    context.fill();
    context.stroke();
    context.fillStyle = read("--foreground");
    context.fillText(node.name, node.x + 10, node.y + NODE.height / 2, NODE.width - 20);
  }
}
watch([view, size, hovered], draw, { flush: "post" });
onBeforeUnmount(hide);

/** The node under the pointer: the pointer is in the pane's pixels, the nodes in world pixels. */
function nodeAt(event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const wx = (event.clientX - box.left - view.value.x) / view.value.zoom;
  const wy = (event.clientY - box.top - view.value.y) / view.value.zoom;
  return nodes.find((node) => wx >= node.x && wx <= node.x + NODE.width && wy >= node.y && wy <= node.y + NODE.height);
}
function onMove(event: PointerEvent) {
  if (!props.tips || event.buttons) return;
  const node = nodeAt(event);
  if (!node) {
    hovered.value = null;
    hide();
    return;
  }
  if (hovered.value === node.id) return;
  hovered.value = node.id;
  // The box on the screen, in the pane's pixels: where the node is drawn now.
  const { x, y, zoom } = view.value;
  show({ left: x + node.x * zoom, top: y + node.y * zoom, width: NODE.width * zoom, height: NODE.height * zoom }, { title: node.name, description: "60 / min" });
}
function onLeave() {
  hovered.value = null;
  hide();
}
</script>

<template>
  <ZoomPane
    ref="pane"
    class="h-64"
    view-only
    :world="WORLD"
    :min-zoom="0.1"
    :max-zoom="4"
    wheel="zoom"
    :persist-key="persistKey"
    whole-label="Show the whole line"
    label="Canvas line"
    @view-change="onViewChange"
  >
    <canvas ref="canvas" class="size-full" @pointermove="onMove" @pointerleave="onLeave" />
    <ZoomTip v-bind="tip" side="top" @dismiss="hide" />
    <template #extras>
      <Button variant="ghost" size="icon-sm" title="Show the first row" aria-label="Show the first row" :disabled="off" @click="pane?.showArea({ x: 0, y: 0, width: WORLD.width, height: 200 })">
        <Focus />
      </Button>
    </template>
  </ZoomPane>
  <p class="text-muted-foreground text-xs tabular-nums">
    The pane sends the view: x {{ Math.round(view.x) }}, y {{ Math.round(view.y) }}, zoom {{ view.zoom.toFixed(2) }} ({{ pane?.percent }}%).
  </p>
</template>
