<script setup lang="ts">
// View-only: a canvas draws itself. The pane takes every input and keeps the view (with the controls, the glide and the
// memory) but moves nothing; the canvas draws with the view the pane sends. `world` is the size of what is drawn, in the
// units the view's x, y and zoom use, so Whole map and the limits know it.
import { Focus } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { type Size, ZoomPane, type ZoomView } from "@tavora/official-ui/components/ui/zoom-pane";
import { ref, watch } from "vue";

defineProps<{ disabled?: boolean }>();

const NAMES = ["Iron Ore", "Iron Ingot", "Iron Rod", "Screw", "Reinforced Plate", "Modular Frame", "Copper Ore", "Copper Ingot"];
const NODE = { width: 120, height: 60 };
const nodes = Array.from({ length: 32 }, (_, index) => ({ name: NAMES[index % NAMES.length]!, x: 40 + (index % 8) * 200, y: 40 + Math.floor(index / 8) * 120 }));
const WORLD: Size = { width: 1680, height: 520 };

const canvas = ref<HTMLCanvasElement | null>(null);
const pane = ref<InstanceType<typeof ZoomPane> | null>(null);
const view = ref<ZoomView>({ x: 0, y: 0, zoom: 1 });
const size = ref<Size>({ width: 0, height: 0 });
function onViewChange(next: ZoomView, paneSize: Size) {
  view.value = next;
  size.value = paneSize;
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
  context.lineWidth = 1 / zoom;
  for (const node of nodes) {
    context.fillStyle = style.getPropertyValue("--card").trim();
    context.strokeStyle = style.getPropertyValue("--border").trim();
    context.beginPath();
    context.roundRect(node.x, node.y, NODE.width, NODE.height, 8);
    context.fill();
    context.stroke();
    context.fillStyle = style.getPropertyValue("--foreground").trim();
    context.fillText(node.name, node.x + 10, node.y + NODE.height / 2, NODE.width - 20);
  }
}
watch([view, size], draw, { flush: "post" });
</script>

<template>
  <div class="flex flex-col gap-2">
    <ZoomPane ref="pane" class="h-64" view-only :world="WORLD" :min-zoom="0.1" :max-zoom="4" wheel="zoom" whole-label="Show the whole line" label="Canvas line" @view-change="onViewChange">
      <canvas ref="canvas" class="size-full" />
      <template #extras>
        <Button variant="ghost" size="icon-sm" title="Show the first row" aria-label="Show the first row" :disabled="disabled" @click="pane?.showArea({ x: 0, y: 0, width: WORLD.width, height: 200 })">
          <Focus />
        </Button>
      </template>
    </ZoomPane>
    <p class="text-muted-foreground text-xs tabular-nums">The pane sends the view: x {{ Math.round(view.x) }}, y {{ Math.round(view.y) }}, zoom {{ view.zoom.toFixed(2) }} ({{ pane?.percent }}%).</p>
  </div>
</template>
