<script setup lang="ts">
// In the workspace header, while overlays are on in Settings (and on Windows): Start / Stop for everything over the game. The way
// to the Overlay page is in the rail (RailOverlayButton.vue). Start is green. Stop is red while something shows over a game, and plain with a blue dot while the overlays wait for one. The tooltip says which.
import { Play, Square } from "@lucide/vue";
import { computed } from "vue";
import { Button } from "@tavora/official-ui/components/ui/button";
import { act, state } from "../../host";
import { t } from "../../i18n";

const overlays = computed(() => state.value!.gameOverlays);
const look = computed(() => (overlays.value.hidden ? "stopped" : overlays.value.showing ? "live" : "ready"));
const tint = {
  stopped: "bg-success/15 text-success hover:bg-success/25 hover:text-success",
  live: "bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive",
  ready: "",
};
const tip = { stopped: "overlays.button.startTip", live: "overlays.button.liveTip", ready: "overlays.button.readyTip" } as const;
</script>

<template>
  <Button
    v-if="overlays.supported && overlays.enabled"
    variant="secondary"
    :class="['h-9 min-w-[4.5rem] px-3 text-sm [&_svg]:size-5', tint[look]]"
    :title="t(tip[look])"
    :data-state="look"
    data-testid="overlay-live"
    @click="act({ type: 'set-game-overlays-hidden', hidden: !overlays.hidden })"
  >
    <component :is="overlays.hidden ? Play : Square" class="fill-current" :stroke-width="1.5" />
    {{ t(overlays.hidden ? "overlays.button.start" : "overlays.button.stop") }}
    <span v-if="look === 'ready'" class="bg-info ml-0.5 size-2 flex-none rounded-full" aria-hidden="true" />
    <span v-else-if="look === 'live'" class="bg-destructive ml-0.5 size-2 flex-none animate-pulse rounded-full motion-reduce:animate-none" aria-hidden="true" />
  </Button>
</template>
