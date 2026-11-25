<script setup lang="ts">
// The kit's layers inside a pane (elevation.css), lowest first. The numbers are read from the tokens themselves.
// Below them, a small pane that uses all four: a sticky header, a lifted row, a toolbar over the content and a tip.
import { onMounted, ref } from "vue";
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

const LAYERS: { token: string; use: TextKey }[] = [
  { token: "--layer-lift", use: "demo.layers.lift" },
  { token: "--layer-sticky", use: "demo.layers.sticky" },
  { token: "--layer-overlay", use: "demo.layers.overlay" },
  { token: "--layer-floating", use: "demo.layers.floating" },
];
const values = ref<Record<string, string>>({});
onMounted(() => {
  const style = getComputedStyle(document.documentElement);
  values.value = Object.fromEntries(LAYERS.map((row) => [row.token, style.getPropertyValue(row.token).trim()]));
});
const ROWS = Array.from({ length: 8 }, (_, i) => i + 1);
</script>

<template>
  <div class="flex flex-col gap-4">
    <dl class="m-0 grid grid-cols-[max-content_max-content_1fr] items-baseline gap-x-4 gap-y-1.5 text-sm">
      <template v-for="row in LAYERS" :key="row.token">
        <dt><code class="font-mono text-xs">z-({{ row.token }})</code></dt>
        <dd class="text-muted-foreground m-0 font-mono text-xs tabular-nums" :data-token="row.token">{{ values[row.token] }}</dd>
        <dd class="text-muted-foreground m-0 text-xs">{{ t(row.use) }}</dd>
      </template>
    </dl>
    <div class="relative h-48 max-w-sm overflow-hidden rounded-lg border">
      <div class="h-full overflow-y-auto">
        <h4 class="bg-background sticky top-0 z-(--layer-sticky) m-0 border-b px-3 py-2 text-sm font-semibold">{{ t("demo.layers.header") }}</h4>
        <ul class="m-0 flex list-none flex-col gap-1 p-2">
          <li
            v-for="n in ROWS"
            :key="n"
            class="bg-card rounded-md border px-3 py-1.5 text-sm"
            :class="n === 2 && 'tavora-floating relative z-(--layer-lift) translate-x-1 shadow-elevation-3'"
          >
            {{ n === 2 ? t("demo.layers.dragged") : t("demo.layers.row", { n }) }}
          </li>
        </ul>
      </div>
      <div class="tavora-floating absolute right-2 bottom-2 z-(--layer-overlay) rounded-md px-2 py-1 text-xs shadow-elevation-1">{{ t("demo.layers.toolbar") }}</div>
      <div class="tavora-floating absolute top-1 right-2 z-(--layer-floating) max-w-40 px-2.5 py-1.5 text-xs">{{ t("demo.layers.tip") }}</div>
    </div>
  </div>
</template>
