<script setup lang="ts">
// The three elevation steps (elevation.css) and the floating surface a module draws itself. Over a map: the search
// field and zoom buttons are step 1, the place card is step 2 (tavora-floating), the menu step 3. All of them follow
// the style: pick Hardware or Liquid Glass in the Playground to see them change.
import { Minus, Plus } from "@lucide/vue";
import { computed } from "vue";
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

const mapLabel = computed(() => t("demo.elevation.map"));
const STEPS: { cls: string; use: TextKey }[] = [
  { cls: "shadow-elevation-1", use: "demo.elevation.low" },
  { cls: "shadow-elevation-2", use: "demo.elevation.middle" },
  { cls: "shadow-elevation-3", use: "demo.elevation.high" },
];
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-4">
      <figure v-for="step in STEPS" :key="step.cls" class="flex flex-col gap-2">
        <div class="tavora-floating flex h-20 items-center justify-center text-sm" :class="step.cls" data-testid="elevation-step">{{ t(step.use) }}</div>
        <figcaption class="text-muted-foreground text-xs"><code class="font-mono">tavora-floating {{ step.cls }}</code></figcaption>
      </figure>
    </div>
    <div
      class="bg-secondary relative h-56 overflow-hidden rounded-lg border bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-size-[24px_24px]"
      :aria-label="mapLabel"
      role="img"
    >
      <div class="tavora-floating text-muted-foreground absolute top-2 left-2 flex h-8 w-40 items-center rounded-md px-3 text-sm shadow-elevation-1">{{ t("demo.elevation.search") }}</div>
      <section class="tavora-floating absolute top-12 left-1/3 z-(--layer-floating) flex w-48 flex-col gap-1 p-3 text-sm">
        <h4 class="m-0 text-sm font-semibold">{{ t("demo.elevation.place") }}</h4>
        <p class="text-muted-foreground m-0 flex justify-between"><span>{{ t("demo.elevation.region") }}</span><span class="text-foreground">Revelwood</span></p>
        <p class="text-muted-foreground m-0 flex justify-between"><span>{{ t("demo.elevation.level") }}</span><span class="text-foreground tabular-nums">12</span></p>
      </section>
      <div class="tavora-floating absolute right-2 bottom-2 z-(--layer-overlay) flex gap-0.5 rounded-md p-0.5 shadow-elevation-1">
        <span class="flex size-7 items-center justify-center"><Minus class="size-4" /></span>
        <span class="flex size-7 items-center justify-center"><Plus class="size-4" /></span>
      </div>
    </div>
  </div>
</template>
