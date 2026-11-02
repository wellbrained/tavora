<script setup lang="ts">
// The corner steps, all made from the theme's --radius. The pixels shown are read from the boxes themselves, so they
// follow a theme (or the user's own corner setting).
import { onBeforeUnmount, onMounted, ref } from "vue";

const STEPS = [
  { cls: "rounded-sm", box: "rounded-sm" },
  { cls: "rounded-md", box: "rounded-md" },
  { cls: "rounded-lg", box: "rounded-lg" },
  { cls: "rounded-xl", box: "rounded-xl" },
];

const root = ref<HTMLElement | null>(null);
const pixels = ref<Record<string, string>>({});
function read() {
  const next: Record<string, string> = {};
  for (const el of root.value?.querySelectorAll<HTMLElement>("[data-step]") ?? []) next[el.dataset.step ?? ""] = getComputedStyle(el).borderTopLeftRadius;
  pixels.value = next;
}
const watcher = new MutationObserver(() => requestAnimationFrame(read));
onMounted(() => {
  read();
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
});
onBeforeUnmount(() => watcher.disconnect());
</script>

<template>
  <div ref="root" class="flex flex-wrap gap-x-6 gap-y-3">
    <div v-for="step in STEPS" :key="step.cls" class="flex items-center gap-3">
      <span class="bg-secondary size-12 flex-none border" :class="step.box" :data-step="step.cls" />
      <span class="flex flex-col">
        <span class="font-mono text-xs">{{ step.cls }}</span>
        <span class="text-muted-foreground font-mono text-xs">{{ pixels[step.cls] }}</span>
      </span>
    </div>
  </div>
</template>
