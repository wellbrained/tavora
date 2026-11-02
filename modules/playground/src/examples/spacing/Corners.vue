<script setup lang="ts">
// The kit's corner steps, all made from the theme's --radius.
import { onBeforeUnmount, onMounted, ref } from "vue";

const radius = ref("");
const read = () => (radius.value = getComputedStyle(document.documentElement).getPropertyValue("--radius").trim());
const watcher = new MutationObserver(() => requestAnimationFrame(read));
onMounted(() => {
  read();
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
});
onBeforeUnmount(() => watcher.disconnect());
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span class="bg-secondary size-10 rounded-sm" title="rounded-sm" />
    <span class="bg-secondary size-10 rounded-md" title="rounded-md" />
    <span class="bg-secondary size-10 rounded-lg" title="rounded-lg" />
    <span class="bg-secondary size-10 rounded-xl" title="rounded-xl" />
    <span class="text-muted-foreground font-mono text-xs">--radius: {{ radius }}</span>
  </div>
</template>
