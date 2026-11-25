<script setup lang="ts">
// Game motion (motion.css): longer than the interface may be, so only on a game's board or overlay, for rare moments
// or while something plays. Play runs each one once on a tile; the loop runs while it is switched on. With reduced
// motion each lands on its end state at once.
import { Play, RotateCw } from "@lucide/vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { Toggle } from "@tavora/official-ui/components/ui/toggle";
import { computed, onMounted, reactive, ref } from "vue";
import { t } from "../../i18n";
import type { TextKey } from "../../locales";

interface Row {
  id: string;
  token: string;
  ease: string;
  use: TextKey;
}
const ROWS: Row[] = [
  { id: "shake", token: "--duration-play-quick", ease: "--ease-play", use: "demo.game.shake" },
  { id: "flip", token: "--duration-play", ease: "--ease-play", use: "demo.game.flip" },
  { id: "fade", token: "--duration-play-long", ease: "--ease-out-strong", use: "demo.game.fade" },
  { id: "fall", token: "--duration-celebrate", ease: "--ease-fall", use: "demo.game.fall" },
];
// A run counter per row: a new key restarts the animation even while one is running.
const runs = reactive<Record<string, number>>({});
const spinning = ref(false);
const spinLabel = computed(() => t("demo.game.spin"));
const times = ref<Record<string, string>>({});
const inMs = (value: string) => `${Math.round(parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000))} ms`;
onMounted(() => {
  const style = getComputedStyle(document.documentElement);
  times.value = Object.fromEntries(ROWS.map((row) => [row.token, inMs(style.getPropertyValue(row.token))]));
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="row in ROWS" :key="row.id" class="flex flex-wrap items-center gap-x-4 gap-y-2" :data-token="row.token">
      <div class="flex w-52 flex-col">
        <span class="flex items-baseline gap-2">
          <code class="font-mono text-xs">{{ row.token }}</code>
          <span class="text-muted-foreground font-mono text-xs tabular-nums">{{ times[row.token] }}</span>
        </span>
        <span class="text-muted-foreground text-xs">{{ t(row.use) }} · <code class="font-mono">{{ row.ease }}</code></span>
      </div>
      <div class="bg-secondary relative flex h-12 w-32 flex-none items-center justify-center overflow-hidden rounded-md">
        <span
          :key="runs[row.id] ?? 0"
          class="bg-primary text-primary-foreground game-tile flex size-8 items-center justify-center rounded-sm text-sm font-semibold"
          :data-play="runs[row.id] ? row.id : undefined"
          :style="{ animationDuration: `var(${row.token})`, animationTimingFunction: `var(${row.ease})` }"
          data-testid="game-tile"
          >A</span
        >
      </div>
      <Button variant="ghost" size="xs" @click="runs[row.id] = (runs[row.id] ?? 0) + 1"><Play /> {{ t("demo.motion.play") }}</Button>
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2" data-token="--ease-loop">
      <div class="flex w-52 flex-col">
        <code class="font-mono text-xs">--ease-loop</code>
        <span class="text-muted-foreground text-xs">{{ t("demo.game.loop") }}</span>
      </div>
      <div class="bg-secondary relative flex h-12 w-32 flex-none items-center justify-center rounded-md">
        <span class="game-record border-primary size-9 rounded-full border-4 border-dotted" :data-spinning="spinning || undefined" />
      </div>
      <Toggle v-model="spinning" :label="spinLabel"><RotateCw /></Toggle>
    </div>
  </div>
</template>

<style scoped>
.game-tile[data-play="shake"] {
  animation-name: game-shake;
}
.game-tile[data-play="flip"] {
  animation-name: game-flip;
}
.game-tile[data-play="fade"] {
  animation-name: game-fade;
}
.game-tile[data-play="fall"] {
  animation-name: game-fall;
}
.game-record[data-spinning] {
  animation: game-spin calc(var(--duration-play-long) * 2) var(--ease-loop) infinite;
}
@keyframes game-shake {
  20%,
  60% {
    transform: translateX(-6px);
  }
  40%,
  80% {
    transform: translateX(6px);
  }
}
@keyframes game-flip {
  50% {
    transform: rotateX(90deg);
  }
}
@keyframes game-fade {
  from {
    opacity: 0;
  }
}
/* Drops in from above and lands where it belongs, so reduced motion (no time at all) shows it in place. */
@keyframes game-fall {
  from {
    transform: translateY(-48px) rotate(-90deg);
    opacity: 0;
  }
}
@keyframes game-spin {
  to {
    transform: rotate(1turn);
  }
}
</style>
