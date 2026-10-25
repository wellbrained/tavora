<script setup lang="ts">
// A card for CPU or the graphics card: label and name on top, the usage big and centred, the graph, and one small
// line with the peak on the left and a detail on the right. Plain text, so a snapshot touches only what changed.
import UsageGraph from "./UsageGraph.vue";

defineProps<{
  title: string;
  name: string;
  /** The number, already written ("42"); empty before the first numbers. */
  usage: string;
  /** Already written ("72"), in degrees Celsius; empty until Tavora reports it (it sits centred next to the %). */
  temperature?: string;
  /** Hover text for the dash shown while there is no temperature. */
  temperatureHint?: string;
  /** Already written ("max 90 %"); empty when not shown. */
  peak: string;
  /** Already written ("VRAM 9.4 / 9.8 GB"). */
  detail: string;
  /** Shown on hover. */
  hint: string;
  values: number[];
  graphLabel: string;
  testid: string;
}>();
</script>

<template>
  <section class="bg-card text-card-foreground flex flex-col gap-1.5 rounded-lg border p-2.5" :data-testid="testid" :title="hint || undefined" :tabindex="hint ? 0 : undefined">
    <header class="flex items-baseline gap-2">
      <span class="text-muted-foreground flex-none text-[0.6875rem] font-medium tracking-wide uppercase">{{ title }}</span>
      <span class="min-w-0 flex-1 truncate text-xs">{{ name }}</span>
    </header>
    <!-- The usage and the temperature are one pair, centred together; until Tavora reports one, a muted dash holds its place so the usage does not move later. -->
    <div class="flex items-baseline justify-center gap-3 whitespace-nowrap" data-testid="usage">
      <span class="text-[2.125rem] leading-none font-semibold tabular-nums">{{ usage }}<span v-if="usage" class="text-muted-foreground ml-0.5 text-base font-normal">%</span></span>
      <span v-if="temperature" class="text-[2.125rem] leading-none font-semibold tabular-nums" data-testid="temperature">{{ temperature }}<span class="text-muted-foreground ml-0.5 text-base font-normal">°C</span></span>
      <span v-else class="text-muted-foreground text-[2.125rem] leading-none font-semibold tabular-nums" :title="temperatureHint" :tabindex="temperatureHint ? 0 : undefined" data-testid="temperature-none">–<span class="ml-0.5 text-base font-normal">°C</span></span>
    </div>
    <UsageGraph :values="values" :label="graphLabel" />
    <footer class="text-muted-foreground flex items-baseline justify-between gap-2 text-xs tabular-nums">
      <span data-testid="peak">{{ peak }}</span>
      <span class="truncate" data-testid="detail">{{ detail }}</span>
    </footer>
  </section>
</template>
