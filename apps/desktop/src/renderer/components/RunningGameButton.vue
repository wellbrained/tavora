<script setup lang="ts">
// While a game of the library runs on this PC (Settings > General, "When a game starts"): a layer behind the profile
// card that peeks out above it, like the notification behind the front one, and switches to the game. The profile
// card says which game it is. It slides back while that game is open, since there is nothing to switch to, and moves
// the items above it up and down as it comes and goes. A running game that is not in the library (or only in Trash)
// gets the same layer offering to add it; once added, it opens and the layer is the switch again.
//
// Only transform and opacity move. The row's height changes at once, and what sits above it starts where it was and
// glides to its new place (a FLIP), in step with the layer, instead of animating the height.
import { ArrowRight, Plus } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { cn } from "@tavora/official-ui/lib/utils";
import { useTask } from "@tavora/official-ui/use-task";
import type { UnlistedGame } from "../../shared/host-api";
import { act, state } from "../host";
import { t } from "../i18n";
import { addInputForUnlisted } from "../lib/game-picker";
import RailTooltip from "./RailTooltip.vue";

defineProps<{ expanded: boolean }>();

const game = computed(() => {
  const id = state.value!.runningGameId;
  return id ? (state.value!.library.workspaces[id] ?? null) : null;
});
/** A running game that is not in the library; null while a game of the library runs (the host leaves it out then). */
const unlisted = computed(() => state.value!.unlistedGame);
// runningGameId already leaves out the game of the workspace open now, so the layer slides back there.
const shown = computed(() => game.value !== null || unlisted.value !== null);
/** Adding the game and opening it; a second click meanwhile does nothing. A failure shows its toast (act). */
const adding = useTask();
/** The game added and opened from here, until the layer has slid away: it runs, but it is about to be the open one. */
let opened: string | null = null;
/**
 * What the layer offers. It keeps the last one while it slides away, and while adding, so its words don't change on the
 * way out: the added game runs, and the layer goes as it opens.
 */
const offer = ref<{ kind: "switch" } | { kind: "add"; game: UnlistedGame }>({ kind: "switch" });
watch(
  [game, unlisted, adding.busy],
  () => {
    if (!shown.value) opened = null;
    if (adding.busy.value || (opened !== null && game.value?.id === opened)) return;
    if (game.value) offer.value = { kind: "switch" };
    else if (unlisted.value) offer.value = { kind: "add", game: unlisted.value };
  },
  { immediate: true },
);
const label = computed(() => (offer.value.kind === "add" ? t("rail.addRunningGame", { name: offer.value.game.name }) : t("rail.switchToGame")));
const status = computed(() => (adding.busy.value ? "adding" : offer.value.kind));

function run() {
  const now = offer.value;
  if (now.kind === "add") {
    void adding.run(async () => {
      const added = await act({ type: "add-workspace", ...addInputForUnlisted(now.game) });
      if (!added.ok || !added.id) return;
      opened = added.id;
      // Not opened: the layer becomes the switch to it.
      if (!(await act({ type: "open-workspace", workspaceId: added.id })).ok) opened = null;
    });
  } else if (game.value) {
    void act({ type: "open-workspace", workspaceId: game.value.id });
  }
}

/** How far the row grows and shrinks: the part of the layer that shows above the profile card (h-7). */
const PEEK = 28;
const peek = ref<HTMLElement | null>(null);
watch(
  shown,
  (now) => {
    // The footer rows above this column sit on the row's height; they jump by PEEK when it changes, so they start
    // where they were and glide to where they are now. Not shown for reduced motion.
    const above = peek.value?.parentElement?.previousElementSibling;
    if (!above || !("animate" in above) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const style = getComputedStyle(peek.value!);
    above.animate(
      { transform: [`translateY(${now ? PEEK : -PEEK}px)`, "translateY(0)"] },
      { duration: parseFloat(style.getPropertyValue("--duration-panel")) || 250, easing: style.getPropertyValue("--ease-out-strong").trim() || "ease-out" },
    );
  },
  { flush: "post" },
);
</script>

<template>
  <!-- The 28 px that show above the profile card; the rest of the layer sits under it. -->
  <div ref="peek" :class="cn('running-peek relative', shown ? 'h-7' : 'h-0')" :inert="!shown">
    <RailTooltip :text="label" :disabled="expanded">
      <button
        type="button"
        :class="
          cn(
            'running-layer group/run absolute top-0 flex h-10 items-start rounded-lg border pt-[5px] text-xs font-medium',
            // Narrower than what it sits behind: the profile card when expanded, the avatar tile when compact.
            expanded ? 'inset-x-4 justify-between px-2.5' : 'inset-x-[18px] justify-center',
            !shown && 'translate-y-7 opacity-0',
          )
        "
        data-rail-item
        data-testid="rail-running"
        :data-status="status"
        :aria-label="label"
        :aria-busy="adding.busy.value"
        @click="run"
      >
        <span class="relative flex h-[18px] items-center gap-2">
          <span class="running-dot" aria-hidden="true" />
          <span v-if="expanded" class="text-foreground/90 truncate">{{ label }}</span>
        </span>
        <component
          :is="offer.kind === 'add' ? Plus : ArrowRight"
          v-if="expanded"
          :class="
            cn(
              'text-foreground/90 relative mt-px size-4 flex-none transition-transform duration-(--duration-press) ease-(--ease-out-strong)',
              offer.kind === 'add' ? 'group-hover/run:scale-110' : 'group-hover/run:translate-x-0.5',
            )
          "
          :stroke-width="2"
        />
      </button>
    </RailTooltip>
  </div>
</template>

<style scoped>
/* The layer slides out from behind the card (translate, which is what translate-y-7 sets) and fades. */
.running-layer {
  transition:
    translate var(--duration-panel) var(--ease-out-strong),
    opacity var(--duration-menu) var(--ease-out-strong),
    border-color var(--duration-press),
    box-shadow var(--duration-press);
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
  /* No sliding, only the fade. */
  .running-layer {
    transition: opacity 100ms linear !important;
  }
  .running-dot {
    animation: none;
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--success) 25%, transparent);
  }
}
</style>
