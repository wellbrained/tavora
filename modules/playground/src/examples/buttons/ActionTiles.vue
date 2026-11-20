<script setup lang="ts">
// A row of things to add with one click: the one made for here first (accent edge), then the rest, then a "more" tile.
// Press one to see it install.
import { Globe, Map, NotebookPen, Swords } from "@lucide/vue";
import { ActionTile } from "@tavora/official-ui/components/ui/action-tile";
import type { ProgressButtonStatus } from "@tavora/official-ui/components/ui/progress-button";
import { onBeforeUnmount, ref } from "vue";

const tiles = [
  { id: "builds", label: "Builds", icon: Swords, featured: true },
  { id: "map", label: "World map", icon: Map, featured: true },
  { id: "browser", label: "Browser", icon: Globe, featured: false },
  { id: "notes", label: "Notes", icon: NotebookPen, featured: false },
];
const status = ref<Record<string, ProgressButtonStatus>>({});
const progress = ref<Record<string, number>>({});
const timers = new Set<ReturnType<typeof setTimeout>>();

function add(id: string) {
  status.value = { ...status.value, [id]: "busy" };
  progress.value = { ...progress.value, [id]: 0 };
  const timer = setInterval(() => {
    const now = (progress.value[id] ?? 0) + 9 + Math.round(Math.random() * 14);
    if (now < 100) return (progress.value = { ...progress.value, [id]: now });
    clearInterval(timer);
    status.value = { ...status.value, [id]: "done" };
    timers.add(setTimeout(() => (status.value = { ...status.value, [id]: "idle" }), 1800));
  }, 220);
  timers.add(timer);
}
onBeforeUnmount(() => timers.forEach((timer) => clearInterval(timer)));
</script>

<template>
  <div class="flex flex-wrap gap-2">
    <ActionTile
      v-for="tile in tiles"
      :key="tile.id"
      :label="tile.label"
      :featured="tile.featured"
      :status="status[tile.id] ?? 'idle'"
      :progress="progress[tile.id] ?? null"
      busy-label="Adding…"
      done-label="Added"
      :aria-label="`Add ${tile.label}`"
      @click="add(tile.id)"
    >
      <template #icon><component :is="tile.icon" /></template>
    </ActionTile>
    <ActionTile kind="more" label="+3 more" />
  </div>
</template>
