<script setup lang="ts">
// At the bottom of the rail while a game of the library runs on this PC (Settings > General, "When a game
// starts"): a controller that pulses slowly. It names the game on hover, and a click switches to it. Hidden
// while that game is the one open, since there is nothing to switch to.
import { Gamepad2 } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { act, state } from "../host";
import { t } from "../i18n";
import RailFooterTile from "./RailFooterTile.vue";
import RailTooltip from "./RailTooltip.vue";

defineProps<{ expanded: boolean }>();

const game = computed(() => {
  const id = state.value!.runningGameId;
  return id ? (state.value!.library.games[id] ?? null) : null;
});
const label = computed(() => (game.value ? t("rail.running", { name: game.value.name }) : ""));
</script>

<template>
  <RailTooltip v-if="game" :text="label" :hint="t('rail.runningSwitch')" :disabled="expanded">
    <button
      type="button"
      :class="cn('running-in mx-2 flex items-center gap-3 rounded-lg p-1 text-left', expanded && 'hover:bg-accent')"
      data-rail-item
      data-testid="rail-running"
      :aria-label="`${label}. ${t('rail.runningSwitch')}`"
      @click="act({ type: 'open-game', gameId: game.id })"
    >
      <RailFooterTile dot="success" class="running-tile text-success">
        <Gamepad2 class="running-glyph size-5" :stroke-width="1.5" />
      </RailFooterTile>
      <span v-if="expanded" class="flex min-w-0 flex-col leading-tight">
        <span class="truncate text-sm font-semibold">{{ game.name }}</span>
        <span class="text-success truncate text-xs">{{ t("rail.runningHint") }}</span>
      </span>
    </button>
  </RailTooltip>
</template>

<style scoped>
/* Slides in when the game starts. */
.running-in {
  animation: running-in 300ms ease-out;
}
@keyframes running-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
:deep(.running-tile) {
  background: color-mix(in oklab, var(--success) 16%, var(--card));
  animation: running-ring 2.4s ease-in-out infinite;
}
button:hover :deep(.running-tile) {
  background: color-mix(in oklab, var(--success) 30%, var(--card));
}
:deep(.running-glyph) {
  animation: running-glyph 2.4s ease-in-out infinite;
}
/* A slow breath that never gets loud: the ring and glow rise only a little. */
@keyframes running-ring {
  0%,
  100% {
    box-shadow:
      0 0 0 2px var(--rail),
      0 0 0 3px color-mix(in oklab, var(--success) 50%, transparent),
      0 0 6px 0 color-mix(in oklab, var(--success) 12%, transparent);
  }
  50% {
    box-shadow:
      0 0 0 2px var(--rail),
      0 0 0 3.5px color-mix(in oklab, var(--success) 80%, transparent),
      0 0 12px 2px color-mix(in oklab, var(--success) 25%, transparent);
  }
}
@keyframes running-glyph {
  0%,
  100% {
    opacity: 0.75;
    transform: scale(0.95);
  }
  50% {
    opacity: 0.92;
    transform: scale(1.02);
  }
}
@media (prefers-reduced-motion: reduce) {
  .running-in,
  :deep(.running-tile),
  :deep(.running-glyph) {
    animation: none;
  }
}
</style>
