<script setup lang="ts">
// Every theme token with the value it has now. Tavora sets the tokens on <html>, so they are read again whenever that
// changes (a new theme).
import { THEME_TOKENS } from "@tavora/sdk";
import { onBeforeUnmount, onMounted, ref } from "vue";

const values = ref<Record<string, string>>({});
function read() {
  const style = getComputedStyle(document.documentElement);
  values.value = Object.fromEntries(THEME_TOKENS.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]));
}
const watcher = new MutationObserver(() => requestAnimationFrame(read));
onMounted(() => {
  read();
  watcher.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
});
onBeforeUnmount(() => watcher.disconnect());
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
    <div v-for="name in THEME_TOKENS" :key="name" class="flex items-center gap-2 rounded-md border p-1.5">
      <span class="size-7 flex-none rounded-sm border" :style="{ background: `var(--${name})` }" />
      <span class="flex min-w-0 flex-col">
        <span class="truncate font-mono text-xs">{{ name }}</span>
        <span class="text-muted-foreground truncate font-mono text-xs">{{ values[name] }}</span>
      </span>
    </div>
  </div>
</template>
