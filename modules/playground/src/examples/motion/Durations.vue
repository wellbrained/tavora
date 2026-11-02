<script setup lang="ts">
// The kit's durations, from motion.css, shortest first. The times shown are read from the tokens themselves. Play
// moves a dot across with that time and the curve the kit uses it with.
import { Play } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { onMounted, reactive, ref } from "vue";
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

const DURATIONS: { token: string; ease: string; use: TextKey }[] = [
  { token: "--duration-pop-out", ease: "--ease-out-strong", use: "demo.motion.popOut" },
  { token: "--duration-tooltip", ease: "--ease-out-strong", use: "demo.motion.tooltip" },
  { token: "--duration-press", ease: "--ease-out-strong", use: "demo.motion.press" },
  { token: "--duration-menu", ease: "--ease-out-strong", use: "demo.motion.menu" },
  { token: "--duration-pop", ease: "--ease-spring", use: "demo.motion.pop" },
  { token: "--duration-panel", ease: "--ease-out-strong", use: "demo.motion.panel" },
  { token: "--duration-move", ease: "--ease-in-out-strong", use: "demo.motion.move" },
];
const moved = reactive<Record<string, boolean>>({});
const times = ref<Record<string, string>>({});
// The browser may hand a time back as ".18s" or "180ms"; show it in ms either way.
const inMs = (value: string) => `${Math.round(parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000))} ms`;
onMounted(() => {
  const style = getComputedStyle(document.documentElement);
  times.value = Object.fromEntries(DURATIONS.map((row) => [row.token, inMs(style.getPropertyValue(row.token))]));
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="row in DURATIONS" :key="row.token" class="flex flex-wrap items-center gap-x-4 gap-y-2" :data-token="row.token">
      <div class="flex w-52 flex-col">
        <span class="flex items-baseline gap-2">
          <code class="font-mono text-xs">{{ row.token }}</code>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">{{ times[row.token] }}</span>
        </span>
        <span class="text-muted-foreground text-xs">{{ t(row.use) }}</span>
      </div>
      <div class="bg-secondary relative h-6 w-32 flex-none rounded-full">
        <span
          class="bg-primary absolute top-1 left-1 size-4 rounded-full transition-[translate]"
          :class="moved[row.token] ? 'translate-x-24' : 'translate-x-0'"
          :style="{ transitionDuration: `var(${row.token})`, transitionTimingFunction: `var(${row.ease})` }"
          data-testid="demo-dot"
        />
      </div>
      <Button variant="ghost" size="xs" @click="moved[row.token] = !moved[row.token]"><Play :stroke-width="1.5" /> {{ t("demo.motion.play") }}</Button>
    </div>
  </div>
</template>
