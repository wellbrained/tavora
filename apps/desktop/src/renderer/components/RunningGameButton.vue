<script setup lang="ts">
// While a game of the library runs on this PC (Settings > General, "When a game starts"): a layer behind the profile
// card that peeks out above it, like the notification behind the front one, and switches to the game. The profile
// card says which game it is. It slides back while that game is open, since there is nothing to switch to, and moves
// the items above it up and down as it comes and goes.
import { ArrowRight } from "@lucide/vue";
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
// runningGameId already leaves out the game of the workspace open now, so the layer slides back there.
const shown = computed(() => game.value !== null);
</script>

<template>
  <!-- The 28 px that show above the profile card; the rest of the layer sits under it. -->
  <div :class="cn('running-peek relative', shown ? 'h-7' : 'h-0')" :inert="!shown">
    <RailTooltip :text="t('rail.switchToGame')" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'running-layer group/run absolute top-0 flex h-10 items-start rounded-lg border pt-[5px] text-xs font-medium',
            // Narrower than what it sits behind: the profile card when expanded, the avatar tile when compact.
            expanded ? 'inset-x-4 justify-between px-2.5' : 'inset-x-[18px] justify-center',
            !shown && 'translate-y-3 opacity-0',
          )
        "
        data-rail-item
        data-testid="rail-running"
        :aria-label="t('rail.switchToGame')"
        @click="game && act({ type: 'open-workspace', workspaceId: game.id })"
      >
        <span class="relative flex h-[18px] items-center gap-2">
          <span class="running-dot" aria-hidden="true" />
          <span v-if="expanded" class="text-foreground/90 truncate">{{ t("rail.switchToGame") }}</span>
        </span>
        <ArrowRight
          v-if="expanded"
          class="text-foreground/90 relative mt-px size-4 flex-none transition-transform duration-200 group-hover/run:translate-x-0.5"
          :stroke-width="2"
        />
      </button>
    </RailTooltip>
  </div>
</template>

<style scoped>
/* Slow and smooth, so the items above it drift up rather than jump. */
.running-peek {
  transition: height 500ms cubic-bezier(0.22, 1, 0.36, 1);
}
.running-layer {
  transition:
    transform 500ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 300ms ease-out;
}
.running-dot {
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 9999px;
  background: var(--success);
  animation: running-dot 2.4s ease-in-out infinite;
}
/* A slow breath: a soft ring grows out of the dot and fades. */
@keyframes running-dot {
  0% {
    box-shadow: 0 0 0 0 color-mix(in oklab, var(--success) 55%, transparent);
  }
  70%,
  100% {
    box-shadow: 0 0 0 6px color-mix(in oklab, var(--success) 0%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .running-peek,
  .running-layer {
    transition: none;
  }
  .running-dot {
    animation: none;
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--success) 25%, transparent);
  }
}
</style>
