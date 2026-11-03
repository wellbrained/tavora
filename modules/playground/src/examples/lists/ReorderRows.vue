<script setup lang="ts">
// A list the user reorders by dragging: the rows slide aside and the dropped one settles. The place comes from `over`, which
// measures the pointer against the layout at the grab, so rows of different heights never swap back and forth under the pointer.
import { GripVertical } from "@lucide/vue";
import { liftedDragImage, useReorderMotion } from "@tavora/official-ui/components/ui/reorder";
import { ref } from "vue";

const rows = ref([
  { id: "countdown", title: "Countdown", note: "" },
  { id: "stopwatch", title: "Stopwatch", note: "Two lines tall, so the rows differ in height." },
  { id: "counter", title: "Counter", note: "" },
  { id: "timer", title: "Plank timer", note: "" },
]);
const listEl = ref<HTMLElement | null>(null);
const reorder = useReorderMotion(listEl);
const dragId = ref<string | null>(null);
const place = ref<{ id: string; after: boolean } | null>(null);

function onDragStart(event: DragEvent, id: string) {
  dragId.value = id;
  reorder.begin(id);
  if (event.currentTarget instanceof HTMLElement) liftedDragImage(event, event.currentTarget);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}
function onDragOver(event: DragEvent) {
  if (!dragId.value) return;
  event.preventDefault();
  place.value = reorder.over(event.clientX, event.clientY);
}
function onDrop(event: DragEvent) {
  event.preventDefault();
  const id = dragId.value;
  const target = place.value;
  dragId.value = null;
  place.value = null;
  if (!id || !target) return reorder.cancel();
  void reorder.drop(() => {
    const rest = rows.value.filter((row) => row.id !== id);
    const moved = rows.value.find((row) => row.id === id)!;
    rest.splice(rest.findIndex((row) => row.id === target.id) + (target.after ? 1 : 0), 0, moved);
    rows.value = rest;
  });
}
function onDragEnd() {
  dragId.value = null;
  place.value = null;
  reorder.cancel();
}
</script>

<template>
  <div ref="listEl" class="flex flex-col gap-2" data-testid="reorder-rows" @dragover="onDragOver" @drop="onDrop">
    <div
      v-for="row in rows"
      :key="row.id"
      :data-reorder-id="row.id"
      :data-testid="`reorder-row-${row.id}`"
      draggable="true"
      class="bg-card flex items-center gap-2 rounded-lg border px-3 py-2"
      @dragstart="onDragStart($event, row.id)"
      @dragend="onDragEnd"
    >
      <GripVertical class="text-muted-foreground size-4 flex-none" :stroke-width="1.5" aria-hidden="true" />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">{{ row.title }}</p>
        <p v-if="row.note" class="text-muted-foreground text-xs">{{ row.note }}</p>
      </div>
    </div>
  </div>
</template>
