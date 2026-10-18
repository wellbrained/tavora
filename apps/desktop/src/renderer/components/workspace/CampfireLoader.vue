<script setup lang="ts">
// Stands in a module panel while its page loads: Tavora's emblem with embers
// rising from it, and "Loading {name}…" below (the approved Campfire design).
// The embers keep their own room above the emblem; on a small panel the whole
// group shrinks to fit, embers' paths with it.
import { onBeforeUnmount, onMounted, ref } from "vue";
import { t } from "../../i18n";

defineProps<{ name: string }>();

/** The emblem's size when there is room, in px. */
const SIZE = 176;
/** Room kept above the emblem for the embers, at full size. */
const HEADROOM = 95;
const GAP = 26;
/** Height of the label line. */
const LABEL = 20;
/** Space kept clear at the panel's edges. */
const MARGIN = 16;
/** How long an ember takes to rise at speed 1, in seconds. */
const DURATION = 3.6;

// The same embers every time: where each starts, how big it is, how it drifts and how fast it rises. The negative
// delays mean the stream is already under way when the loader appears.
const embers = Array.from({ length: 28 }, (_, i) => {
  const n = (i * 37 + 11) % 101;
  const side = i % 2 ? 1 : -1;
  return {
    "--x": `${39 + ((i * 13) % 24)}%`,
    "--y": `${46 + ((i * 7) % 16)}%`,
    "--spark-size": `${1.3 + ((i * 11) % 23) / 10}px`,
    "--drift": side * (15 + n * 0.7),
    "--lift": -100 - n * 0.95,
    "--speed": 0.75 + ((i * 17) % 50) / 100,
    "--delay": `${-i * 0.391}s`,
  };
});

const root = ref<HTMLElement | null>(null);
/** How far the group is shrunk to fit the panel; 1 when it fits at full size. */
const scale = ref(1);
const sizes = new ResizeObserver(([entry]) => {
  if (!entry) return;
  const { width, height } = entry.contentRect;
  const fit = Math.min(1, (width - 2 * MARGIN) / SIZE, (height - 2 * MARGIN - GAP - LABEL) / (SIZE + HEADROOM));
  scale.value = Math.max(0, fit);
});
onMounted(() => sizes.observe(root.value!));
onBeforeUnmount(() => sizes.disconnect());
</script>

<template>
  <div
    ref="root"
    class="campfire flex size-full flex-col items-center justify-center overflow-hidden"
    :style="{ '--cf-size': `${SIZE * scale}px`, '--cf-scale': scale, '--cf-duration': `${DURATION}s`, paddingTop: `${HEADROOM * scale}px` }"
    role="status"
  >
    <div v-if="scale > 0.2" class="campfire-fire" aria-hidden="true">
      <img class="campfire-logo" src="/brand/emblem-transparent-256.png" srcset="/brand/emblem-transparent-256.png 1x, /brand/emblem-transparent-512.png 2x" alt="" draggable="false" />
      <div class="campfire-embers">
        <i v-for="(ember, index) in embers" :key="index" :style="ember" />
      </div>
    </div>
    <span class="text-muted-foreground text-[13px]">{{ t("panel.loading", { name }) }}</span>
  </div>
</template>

<style scoped>
.campfire {
  gap: 26px;
  pointer-events: none;
  --cf-ember: light-dark(#a66a21, #efb663);
}
.campfire-fire {
  position: relative;
  flex: none;
  width: var(--cf-size);
  height: var(--cf-size);
  isolation: isolate;
}
.campfire-logo {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.campfire-embers {
  position: absolute;
  inset: 0;
}
.campfire-embers i {
  position: absolute;
  left: var(--x, 50%);
  top: var(--y, 52%);
  width: var(--spark-size, 2px);
  height: calc(var(--spark-size, 2px) * 1.5);
  border-radius: 50%;
  background: var(--cf-ember);
  opacity: 0;
  animation: campfire-rise calc(var(--cf-duration) * var(--speed, 1)) linear infinite;
  animation-delay: var(--delay);
  filter: drop-shadow(0 0 2px color-mix(in srgb, var(--cf-ember) 45%, transparent));
  /* Unitless in the setup above; the paths shrink with the emblem on a small panel. */
  --dx: calc(var(--drift) * var(--cf-scale) * 1px);
  --dy: calc(var(--lift) * var(--cf-scale) * 1px);
}
.campfire-embers i:nth-child(3n) {
  background: light-dark(#b95624, #e88b48);
}
.campfire-embers i:nth-child(5n) {
  background: light-dark(#b98731, #ffe1a0);
}
@keyframes campfire-rise {
  0% {
    opacity: 0;
    transform: translate(0, 0) scale(0.7) rotate(0deg);
  }
  10% {
    opacity: 0.9;
  }
  35% {
    opacity: 0.8;
    transform: translate(calc(var(--dx) * -0.15), calc(var(--dy) * 0.33)) scale(1) rotate(35deg);
  }
  65% {
    opacity: 0.55;
    transform: translate(calc(var(--dx) * 0.65), calc(var(--dy) * 0.65)) scale(0.8) rotate(-20deg);
  }
  100% {
    opacity: 0;
    transform: translate(var(--dx), var(--dy)) scale(0.2) rotate(65deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .campfire-embers {
    display: none;
  }
}
</style>
