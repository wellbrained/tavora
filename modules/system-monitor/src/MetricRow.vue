<script setup lang="ts">
// One compact row for CPU or the graphics card: what it is, how busy it is now, the peak once updates are slow,
// and the graph slot. Plain text only, so a new snapshot touches just the numbers that changed.
import type { History } from "./history";
import UsageGraph from "./UsageGraph.vue";

defineProps<{
  title: string;
  name: string;
  /** Already written, such as "42 %"; empty before the first numbers. */
  usage: string;
  /** Already written, such as "max 92 %"; empty when not shown. */
  peak: string;
  /** More under the name, such as the video memory used. */
  detail: string;
  /** Shown on hover. */
  hint: string;
  history: History;
  testid: string;
}>();
</script>

<template>
  <section class="flex flex-col gap-0.5 px-3 py-1.5" :data-testid="testid" :title="hint || undefined" :tabindex="hint ? 0 : undefined">
    <div class="flex items-baseline gap-2">
      <span class="text-muted-foreground w-14 flex-none text-xs font-medium">{{ title }}</span>
      <span class="min-w-0 flex-1 truncate">{{ name }}</span>
      <span v-if="peak" class="text-muted-foreground flex-none text-xs tabular-nums" data-testid="peak">{{ peak }}</span>
      <span class="w-12 flex-none text-right font-medium tabular-nums" data-testid="usage">{{ usage }}</span>
    </div>
    <p v-if="detail" class="text-muted-foreground pl-16 text-xs tabular-nums" data-testid="detail">{{ detail }}</p>
    <UsageGraph :history="history" />
  </section>
</template>
