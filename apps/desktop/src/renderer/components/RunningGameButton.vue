<script setup lang="ts">
// While a game of the library runs on this PC (Settings > General, "When a game starts"): a card that peeks out from
// behind the profile card, like a stacked notification, and switches to the game. The profile card says which game
// it is. It slides back while that game is open, since there is nothing to switch to, and pushes the items above it
// up and down as it comes and goes.
import { Gamepad2 } from "@lucide/vue";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { act, state } from "../host";
import { t } from "../i18n";
import RailTooltip from "./RailTooltip.vue";

defineProps<{ expanded: boolean }>();

const game = computed(() => {
  const id = state.value!.runningGameId;
  return id ? (state.value!.library.workspaces[id] ?? null) : null;
});
// runningGameId already leaves out the game of the workspace open now, so the card slides back there.
const shown = computed(() => game.value !== null);
</script>

<template>
  <!-- The 28 px that show above the profile card; the rest of the card sits under it. -->
  <div :class="cn('running-peek relative', shown ? 'h-7' : 'h-0')" :inert="!shown">
    <RailTooltip :text="t('rail.switchToGame')" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'running-card text-success absolute top-0 flex h-10 items-start justify-center gap-1.5 rounded-lg border pt-[5px] text-xs font-semibold',
            // Narrower than what it sits behind: the profile card when expanded, the avatar tile when compact.
            expanded ? 'inset-x-3.5' : 'inset-x-[18px]',
            !shown && 'translate-y-3 opacity-0',
          )
        "
        data-rail-item
        data-testid="rail-running"
        :aria-label="t('rail.switchToGame')"
        @click="game && act({ type: 'open-workspace', workspaceId: game.id })"
      >
        <Gamepad2 class="running-glyph size-4 flex-none" :stroke-width="1.75" />
        <span v-if="expanded" class="truncate">{{ t("rail.switchToGame") }}</span>
      </button>
    </RailTooltip>
  </div>
</template>

<style scoped>
/* Slow and smooth, so the items above it drift up rather than jump. */
.running-peek {
  transition: height 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
.running-card {
  border-color: color-mix(in oklab, var(--success) 35%, var(--border));
  background: color-mix(in oklab, var(--success) 14%, var(--card));
  box-shadow: 0 -2px 12px color-mix(in srgb, black 30%, transparent);
  transition:
    transform 500ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 300ms ease-out,
    background-color 150ms;
}
.running-card:hover {
  background: color-mix(in oklab, var(--success) 24%, var(--card));
}
:deep(.running-glyph) {
  animation: running-glyph 2.4s ease-in-out infinite;
}
/* A slow breath that never gets loud. */
@keyframes running-glyph {
  0%,
  100% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .running-peek,
  .running-card {
    transition: none;
  }
  :deep(.running-glyph) {
    animation: none;
  }
}
</style>
